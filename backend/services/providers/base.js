// Common provider interface + shared helpers.
//
// Every provider (STT or report or visual-spec) returns a `metrics` object
// that maps 1:1 to a ModelRun row. The orchestrator persists these.
//
// Provider signatures:
//   transcribe({ audioPath, recordingId, pipelineTag, audioSeconds }) → TranscribeResult
//   report    ({ rawTranscript, cleanedTranscript, speakers, segments,
//                pipelineTag, recordingId, audioSeconds }) → ReportResult

function newMetrics(provider, model, pipelineTag) {
  return {
    provider,
    model,
    pipelineTag,
    audioSeconds:        0,
    inputTokens:         0,
    outputTokens:        0,
    gpuExecutionSeconds: 0,
    providerCost:        0,
    providerCurrency:    "USD",
    estimatedCostInr:    0,
    visualCount:         0,
    latencyMs:           0,
    success:             true,
    errorCode:           null,
    metadata:            {},
    _startedAt:          Date.now(),
  };
}

function finalizeMetrics(m) {
  m.latencyMs = Date.now() - m._startedAt;
  delete m._startedAt;
  return m;
}

function markError(m, err, code = null) {
  m.success   = false;
  m.errorCode = code || (err && err.code) || "unknown";
  m.metadata  = { ...(m.metadata || {}), error: err ? String(err.message || err) : "unknown" };
  return finalizeMetrics(m);
}

module.exports = { newMetrics, finalizeMetrics, markError };
