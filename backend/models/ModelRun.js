const mongoose = require("mongoose");

// One row per external call (STT, report, per-visual generation).
// Enables per-operation cost + latency tracking and hidden benchmarks.
const ModelRunSchema = new mongoose.Schema({
  recordingId:         { type: mongoose.Schema.Types.ObjectId, ref: "Recording", required: true, index: true },
  processingJobId:     { type: mongoose.Schema.Types.ObjectId, ref: "ProcessingJob", default: null },
  operation:           {
    type: String,
    enum: ["stt", "report", "visual_spec", "visual_render", "pdf", "clean_transcript"],
    required: true,
  },
  provider:            { type: String, required: true },        // "sarvam" | "anthropic" | "runpod" | "openai"
  model:               { type: String, required: true },        // exact model id used
  pipelineTag:         { type: String, enum: ["normal", "premium", "control"], default: null },
  audioSeconds:        { type: Number, default: 0 },
  inputTokens:         { type: Number, default: 0 },
  outputTokens:        { type: Number, default: 0 },
  gpuExecutionSeconds: { type: Number, default: 0 },
  providerCost:        { type: Number, default: 0 },
  providerCurrency:    { type: String, default: "USD" },
  estimatedCostInr:    { type: Number, default: 0 },
  visualCount:         { type: Number, default: 0 },
  latencyMs:           { type: Number, default: 0 },
  success:             { type: Boolean, default: true },
  errorCode:           { type: String, default: null },
  metadata:            { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt:           { type: Date, default: Date.now, index: true },
});

module.exports = mongoose.model("ModelRun", ModelRunSchema);
