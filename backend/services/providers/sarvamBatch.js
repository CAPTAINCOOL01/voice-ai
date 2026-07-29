// Sarvam Batch STT provider — saaras:v3 with diarisation.
//
// The batch pipeline supports long recordings, speaker diarisation, and
// code-mixed Hindi/English handling. Flow:
//   1. Ask Sarvam for a job (returns { job_id, upload_url }).
//   2. Upload the audio to Sarvam via that URL (OR pass an R2 presigned URL —
//      configurable via SARVAM_BATCH_SUPPORTS_URL_INPUT).
//   3. Start the job.
//   4. Poll status until COMPLETED or FAILED.
//   5. Download the transcript JSON.
//
// Endpoint URLs are env-parameterised so they can be adjusted without a
// code change when Sarvam updates their API.
//
// Fallback: on any HTTP failure the caller should route through sarvamSync.
// The orchestrator's pickProviders() handles that at the mode level.

const fs   = require("fs");
const path = require("path");
const { presignGet } = require("../storage/r2");
const { newMetrics, finalizeMetrics, markError } = require("./base");

const BASE_URL       = process.env.SARVAM_BATCH_BASE_URL       || "https://api.sarvam.ai/speech-to-text-translate";
const INIT_PATH      = process.env.SARVAM_BATCH_INIT_PATH      || "/job/init";
const START_PATH     = process.env.SARVAM_BATCH_START_PATH     || "/job";               // POST {job_id}
const STATUS_PATH    = process.env.SARVAM_BATCH_STATUS_PATH    || "/job";               // GET  /:job_id/status
const STT_MODEL      = process.env.PREMIUM_STT_MODEL           || "saaras:v3";
const DIARIZATION    = String(process.env.PREMIUM_STT_DIARIZATION || "true").toLowerCase() === "true";
const POLL_INTERVAL  = Number(process.env.SARVAM_BATCH_POLL_INTERVAL_MS) || 5000;
const POLL_TIMEOUT   = Number(process.env.SARVAM_BATCH_POLL_TIMEOUT_MS)  || 15 * 60 * 1000;   // 15 min
// Rough INR/hour used only for cost estimation; actual cost is captured post-hoc.
const COST_INR_PER_HOUR = 45;

function authHeaders() {
  if (!process.env.SARVAM_API_KEY) throw new Error("SARVAM_API_KEY not set");
  return { "api-subscription-key": process.env.SARVAM_API_KEY };
}

async function _postJson(url, body) {
  const resp = await fetch(url, {
    method:  "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`POST ${url} → ${resp.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function _getJson(url) {
  const resp = await fetch(url, { headers: authHeaders() });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`GET ${url} → ${resp.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function _uploadToSarvamUrl(uploadUrl, audioPath) {
  const buffer = fs.readFileSync(audioPath);
  const resp = await fetch(uploadUrl, {
    method:  "PUT",
    headers: { "Content-Type": "audio/wav" },
    body:    buffer,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`PUT ${uploadUrl} → ${resp.status}: ${text.slice(0, 200)}`);
  }
}

function _mapSegments(payload) {
  // Best-effort mapping. Sarvam's response shape varies; supports both
  // the diarised format (segments[]) and the plain transcript form.
  const segments = [];
  const speakerAgg = new Map();
  const srcSegments =
    payload.segments ||
    payload.diarization ||
    payload.result?.segments ||
    payload.output?.segments ||
    [];

  for (const s of srcSegments) {
    const speaker  = String(s.speaker ?? s.speaker_id ?? s.speakerLabel ?? "").trim() || "Speaker 1";
    const startMs  = Number(s.start_ms ?? s.start ?? s.startMs ?? 0);
    const endMs    = Number(s.end_ms   ?? s.end   ?? s.endMs   ?? startMs);
    const text     = String(s.text ?? s.transcript ?? "").trim();
    segments.push({ startMs, endMs, speaker, text });

    const agg = speakerAgg.get(speaker) || { id: speaker, label: speaker, totalMs: 0, segmentCount: 0 };
    agg.totalMs      += Math.max(0, endMs - startMs);
    agg.segmentCount += 1;
    speakerAgg.set(speaker, agg);
  }

  const rawTranscript = (payload.transcript ?? payload.result?.transcript ?? "").trim() ||
                        segments.map(s => `${s.speaker}: ${s.text}`).join("\n");
  return {
    rawTranscript,
    segments,
    speakers: Array.from(speakerAgg.values()),
  };
}

async function transcribe({ audioPath, r2Key, pipelineTag = "premium", audioSeconds = 0 }) {
  const metrics = newMetrics("sarvam", STT_MODEL, pipelineTag);
  metrics.audioSeconds = audioSeconds;

  if (!process.env.SARVAM_API_KEY) {
    return { rawTranscript: "", cleanedTranscript: "", language: null,
             detectedLanguages: [], speakers: [], segments: [],
             metrics: markError(metrics, new Error("SARVAM_API_KEY not set"), "MISSING_API_KEY") };
  }

  try {
    // 1. Init — Sarvam returns a job id + presigned upload URL (or accepts an audio_url).
    const initBody = {
      with_diarization:    DIARIZATION,
      language_code:       "unknown",
      model:               STT_MODEL,
    };
    // If configured to hand Sarvam an R2 URL directly, skip their upload step.
    if (r2Key && process.env.SARVAM_BATCH_SUPPORTS_URL_INPUT === "true") {
      initBody.audio_url = await presignGet(r2Key, 3600);
    }

    const initResp = await _postJson(`${BASE_URL}${INIT_PATH}`, initBody);
    const jobId    = initResp.job_id || initResp.jobId || initResp.id;
    const uploadUrl = initResp.upload_url || initResp.uploadUrl;

    if (!jobId) throw new Error(`Init returned no job_id: ${JSON.stringify(initResp).slice(0, 200)}`);

    // 2. Upload audio if Sarvam didn't accept a URL.
    if (uploadUrl && audioPath) {
      await _uploadToSarvamUrl(uploadUrl, audioPath);
    }

    // 3. Start.
    try { await _postJson(`${BASE_URL}${START_PATH}`, { job_id: jobId }); }
    catch (e) {
      // Some deployments auto-start on init — swallow "already started" style errors.
      if (!/already|started|running/i.test(e.message)) throw e;
    }

    // 4. Poll.
    const deadline = Date.now() + POLL_TIMEOUT;
    let final = null;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      const statusResp = await _getJson(`${BASE_URL}${STATUS_PATH}/${jobId}/status`);
      const status = String(statusResp.status || statusResp.state || "").toUpperCase();
      if (status === "COMPLETED" || status === "SUCCESS" || status === "SUCCEEDED") {
        final = statusResp.result || statusResp.output || statusResp;
        break;
      }
      if (status === "FAILED" || status === "ERROR") {
        throw new Error(`Sarvam job ${jobId} failed: ${statusResp.error || "unknown"}`);
      }
    }
    if (!final) throw new Error(`Sarvam job ${jobId} timed out after ${POLL_TIMEOUT}ms`);

    // 5. Map response → provider result.
    const mapped = _mapSegments(final);
    metrics.estimatedCostInr = (audioSeconds / 3600) * COST_INR_PER_HOUR;
    metrics.metadata = {
      jobId,
      language: final.language_code || final.detected_language || null,
      speakerCount: mapped.speakers.length,
    };
    finalizeMetrics(metrics);

    return {
      rawTranscript:     mapped.rawTranscript,
      cleanedTranscript: mapped.rawTranscript,   // cleaning pass happens in step 8's factuality helper
      language:          final.language_code || final.detected_language || null,
      detectedLanguages: final.detected_languages || (final.language_code ? [final.language_code] : []),
      speakers:          mapped.speakers,
      segments:          mapped.segments,
      metrics,
    };
  } catch (err) {
    return {
      rawTranscript: "", cleanedTranscript: "", language: null,
      detectedLanguages: [], speakers: [], segments: [],
      metrics: markError(metrics, err),
    };
  }
}

module.exports = { transcribe, model: STT_MODEL };
