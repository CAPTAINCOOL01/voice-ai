// Sarvam sync STT provider — thin wrapper around the existing
// api.sarvam.ai/speech-to-text endpoint. Model: saarika:v2.5.
//
// Used today for the "control" pipeline (existing behaviour). Premium mode
// uses sarvamBatch.js (saaras:v3 with diarisation).

const fs   = require("fs");
const path = require("path");
const { newMetrics, finalizeMetrics, markError } = require("./base");

const SARVAM_STT_URL   = "https://api.sarvam.ai/speech-to-text";
const SARVAM_STT_MODEL = "saarika:v2.5";
// Rough INR/hour for control pipeline — used for cost estimation only.
const COST_INR_PER_HOUR = 45;

async function transcribe({ audioPath, pipelineTag = "control", audioSeconds = 0 }) {
  const metrics = newMetrics("sarvam", SARVAM_STT_MODEL, pipelineTag);
  metrics.audioSeconds = audioSeconds;

  if (!process.env.SARVAM_API_KEY) {
    return { rawTranscript: "", cleanedTranscript: "", language: null,
             detectedLanguages: [], speakers: [], segments: [],
             metrics: markError(metrics, new Error("SARVAM_API_KEY not set"), "MISSING_API_KEY") };
  }

  try {
    const fileBuffer = fs.readFileSync(audioPath);
    const lower      = audioPath.toLowerCase();
    const mimeType   = lower.endsWith(".mp3") ? "audio/mpeg"
                     : lower.endsWith(".m4a") ? "audio/mp4"
                     : "audio/wav";

    const form = new FormData();
    form.append("file", new Blob([fileBuffer], { type: mimeType }), path.basename(audioPath));
    form.append("model",         SARVAM_STT_MODEL);
    form.append("language_code", "unknown");

    const resp = await fetch(SARVAM_STT_URL, {
      method:  "POST",
      headers: { "api-subscription-key": process.env.SARVAM_API_KEY },
      body:    form,
    });
    if (!resp.ok) {
      const body = await resp.text();
      return {
        rawTranscript: "", cleanedTranscript: "", language: null,
        detectedLanguages: [], speakers: [], segments: [],
        metrics: markError(metrics, new Error(`Sarvam ${resp.status}: ${body.slice(0, 300)}`), `HTTP_${resp.status}`),
      };
    }
    const data = await resp.json();
    const text = data.transcript || "";

    metrics.estimatedCostInr = (audioSeconds / 3600) * COST_INR_PER_HOUR;
    metrics.metadata         = { language: data.language_code || null };
    finalizeMetrics(metrics);

    return {
      rawTranscript:     text,
      cleanedTranscript: text,     // sync API returns single text; cleaning happens downstream if needed
      language:          data.language_code || null,
      detectedLanguages: data.language_code ? [data.language_code] : [],
      speakers:          [],       // no diarisation on sync endpoint
      segments:          [],
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

module.exports = { transcribe, model: SARVAM_STT_MODEL };
