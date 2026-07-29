// Pipeline orchestrator — the single entry point for turning a Recording into
// a transcribed + reported artefact.
//
// Responsibilities:
//   1. Pick providers for the requested mode.
//   2. Reserve wallet minutes via the billing/wallet service.
//   3. Create a ProcessingJob row.
//   4. Run STT → cleaning → report (→ visuals in later steps).
//   5. Record a ModelRun row for every external call.
//   6. Commit or refund the reservation based on outcome.
//   7. Update the Recording doc with the final state.
//
// Modes:
//   "control" — existing Sarvam sync + Claude Sonnet path. No user-facing UI
//               for this mode; used for benchmarks and as the default until
//               user picks Normal or Premium (step 6 wires the UI).
//   "normal"  — Whisper Turbo (RunPod) + Qwen. Wired in steps 11+.
//   "premium" — Sarvam Batch + Claude Opus + visuals. Wired in steps 7-10.
//
// Wallet mapping:
//   "control" → normal wallet (so the trial isn't drained on the legacy path;
//               revisit when we retire the control pipeline post-benchmark).
//   "normal"  → normal wallet
//   "premium" → premium wallet

const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");
const {
  Recording, ProcessingJob, ModelRun,
} = require("../../models");
const wallet = require("../billing/wallet");

const sarvamSync           = require("../providers/sarvamSync");
const claudeSonnetControl  = require("../providers/claudeSonnetControl");
// Premium + normal providers wired in later steps. Referenced lazily to avoid
// crash-on-load when their env vars aren't set yet.

const billableMinutes = audioSeconds => Math.max(1, Math.ceil(Number(audioSeconds || 0) / 60));

function walletForMode(mode) {
  return mode === "premium" ? "premium" : "normal";
}

function pickProviders(mode) {
  if (mode === "control") {
    return { stt: sarvamSync, report: claudeSonnetControl };
  }
  if (mode === "normal") {
    // Placeholder — see step 11. Fall through to control until RunPod endpoints exist.
    if (!process.env.ML_WORKER_WHISPER_ENDPOINT) {
      return { stt: sarvamSync, report: claudeSonnetControl, _placeholder: true };
    }
    // future: return { stt: whisperRunpod, report: qwenRunpod };
    return { stt: sarvamSync, report: claudeSonnetControl, _placeholder: true };
  }
  if (mode === "premium") {
    // Wired in steps 7-8.
    try {
      return {
        stt:    require("../providers/sarvamBatch"),
        report: require("../providers/claudeOpus"),
      };
    } catch {
      return { stt: sarvamSync, report: claudeSonnetControl, _placeholder: true };
    }
  }
  throw new Error(`Unknown processing mode: ${mode}`);
}

async function recordModelRun(recordingId, processingJobId, operation, metrics) {
  return ModelRun.create({
    recordingId,
    processingJobId,
    operation,
    provider:            metrics.provider,
    model:               metrics.model,
    pipelineTag:         metrics.pipelineTag || null,
    audioSeconds:        metrics.audioSeconds,
    inputTokens:         metrics.inputTokens,
    outputTokens:        metrics.outputTokens,
    gpuExecutionSeconds: metrics.gpuExecutionSeconds,
    providerCost:        metrics.providerCost,
    providerCurrency:    metrics.providerCurrency,
    estimatedCostInr:    metrics.estimatedCostInr,
    visualCount:         metrics.visualCount || 0,
    latencyMs:           metrics.latencyMs,
    success:             metrics.success,
    errorCode:           metrics.errorCode,
    metadata:            metrics.metadata || {},
  });
}

// Enqueue a processing job. Reserves wallet minutes synchronously (so we can
// fail fast on insufficient funds); the actual STT/report run happens on the
// next tick via setImmediate. Caller receives { jobId, reservationKey } and
// should not block on completion.
async function enqueue({ recording, userId, mode, audioPath, audioSeconds }) {
  if (!recording) throw new Error("recording required");
  if (!userId)    throw new Error("userId required");
  if (!mode)      throw new Error("mode required");

  const minutes = billableMinutes(audioSeconds);
  const walletType = walletForMode(mode);
  const reservationKey = `job_${recording._id}_${mode}_${crypto.randomBytes(6).toString("hex")}`;

  // Reserve minutes up front. If insufficient, throw before creating the job.
  await wallet.reserve({
    userId,
    walletType,
    minutes,
    idempotencyKey: reservationKey,
    recordingId:    recording._id,
    note:           `Reservation for ${mode} processing of recording ${recording._id}`,
  });

  const job = await ProcessingJob.create({
    recordingId:            recording._id,
    userId,
    mode,
    status:                 "reserved",
    reservedNormalMinutes:  walletType === "normal"  ? minutes : 0,
    reservedPremiumMinutes: walletType === "premium" ? minutes : 0,
    idempotencyKey:         reservationKey,
  });

  await Recording.updateOne(
    { _id: recording._id },
    { $set: { processingJobId: job._id, processingStatus: "reserved", processingMode: mode } }
  );

  // Fire the actual work asynchronously. The HTTP request that triggered this
  // does not wait for completion.
  setImmediate(() => {
    _run({ jobId: job._id, audioPath, audioSeconds, mode, userId, reservationKey })
      .catch(err => console.error(`❌ Orchestrator run ${job._id}:`, err));
  });

  return { jobId: job._id, reservationKey, minutes };
}

async function _run({ jobId, audioPath, audioSeconds, mode, userId, reservationKey }) {
  const job = await ProcessingJob.findById(jobId);
  if (!job) return;
  job.status    = "processing";
  job.attempts += 1;
  job.startedAt = new Date();
  await job.save();

  await Recording.updateOne(
    { _id: job.recordingId },
    { $set: { processingStatus: "processing" } }
  );

  const providers = pickProviders(mode);
  let sttResult, reportResult;

  // Ensure we have a local file — download from R2 if we were given nothing.
  let localAudio  = audioPath;
  let tempCreated = false;
  try {
    if (!localAudio || !fs.existsSync(localAudio)) {
      // Caller didn't hand us a local file; we need to fetch it from R2.
      // Downloading is the caller's job normally, so this is a safety net.
      const rec = await Recording.findById(job.recordingId);
      if (!rec?.filename) throw new Error("No local audio and no R2 key on recording");
      const tmp = path.join(os.tmpdir(), `${Date.now()}_${path.basename(rec.filename)}`);
      const { downloadFromR2 } = require("../storage/r2");
      await downloadFromR2(rec.filename, tmp);
      localAudio  = tmp;
      tempCreated = true;
    }

    // 1. STT
    sttResult = await providers.stt.transcribe({
      audioPath:    localAudio,
      recordingId:  job.recordingId,
      pipelineTag:  mode,
      audioSeconds,
    });
    await recordModelRun(job.recordingId, job._id, "stt", sttResult.metrics);

    if (!sttResult.metrics.success) throw new Error(`STT failed: ${sttResult.metrics.errorCode}`);

    // 2. Report
    reportResult = await providers.report.report({
      rawTranscript:     sttResult.rawTranscript,
      cleanedTranscript: sttResult.cleanedTranscript,
      speakers:          sttResult.speakers,
      segments:          sttResult.segments,
      pipelineTag:       mode,
      recordingId:       job.recordingId,
      audioSeconds,
    });
    await recordModelRun(job.recordingId, job._id, "report", reportResult.metrics);

    if (!reportResult.metrics.success) throw new Error(`Report failed: ${reportResult.metrics.errorCode}`);

    // 3. Persist to Recording — legacy fields mirrored for existing UI.
    const walletType = walletForMode(mode);
    await Recording.updateOne(
      { _id: job.recordingId },
      {
        $set: {
          rawTranscript:     sttResult.rawTranscript,
          cleanedTranscript: sttResult.cleanedTranscript,
          transcript:        sttResult.cleanedTranscript,   // legacy mirror
          language:          sttResult.language,
          detectedLanguages: sttResult.detectedLanguages,
          speakers:          sttResult.speakers,
          reportType:        mode === "premium" ? "premium" : "normal",
          reportData:        reportResult.reportData,
          title:             reportResult.title || undefined,
          summary:           reportResult.summary || "",
          tags:              reportResult.tags,
          actionItems:       reportResult.actionItems,
          processingStatus:  "completed",
          normalMinutesConsumed:  walletType === "normal"  ? job.reservedNormalMinutes  : 0,
          premiumMinutesConsumed: walletType === "premium" ? job.reservedPremiumMinutes : 0,
          costSummary: {
            estimatedInr: (sttResult.metrics.estimatedCostInr || 0) + (reportResult.metrics.estimatedCostInr || 0),
            actualInr:    0,
            byOperation:  {
              stt:    sttResult.metrics.estimatedCostInr    || 0,
              report: reportResult.metrics.estimatedCostInr || 0,
            },
          },
        },
      }
    );

    // 4. Commit reservation.
    await wallet.commit({ userId, idempotencyKey: reservationKey });

    job.status      = "completed";
    job.completedAt = new Date();
    await job.save();

    console.log(`✅ Orchestrator: ${mode} pipeline complete for recording ${job.recordingId}`);
  } catch (err) {
    console.error(`❌ Orchestrator failure for job ${jobId}:`, err.message);
    job.status      = "failed";
    job.lastError   = err.message.slice(0, 500);
    job.completedAt = new Date();
    await job.save();

    await Recording.updateOne(
      { _id: job.recordingId },
      { $set: { processingStatus: "failed" } }
    );

    // Refund the reservation on permanent failure.
    try {
      await wallet.refund({
        userId,
        reservationIdempotencyKey: reservationKey,
        refundIdempotencyKey:      `refund_${reservationKey}`,
        note:                      `Auto-refund: ${err.message.slice(0, 200)}`,
      });
      job.status = "refunded";
      await job.save();
    } catch (refundErr) {
      console.error(`❌ Refund failed for ${reservationKey}:`, refundErr.message);
    }
  } finally {
    if (tempCreated && localAudio && fs.existsSync(localAudio)) {
      try { fs.unlinkSync(localAudio); } catch (_) { /* ignore */ }
    }
  }
}

module.exports = { enqueue, billableMinutes, pickProviders };
