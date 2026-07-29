const mongoose = require("mongoose");

const SpeakerSchema = new mongoose.Schema({
  id:           String,
  label:        String,
  totalMs:      Number,
  segmentCount: Number,
}, { _id: false });

const QualityWarningSchema = new mongoose.Schema({
  type:     String,
  message:  String,
  evidence: mongoose.Schema.Types.Mixed,
}, { _id: false });

const CostSummarySchema = new mongoose.Schema({
  estimatedInr: { type: Number, default: 0 },
  actualInr:    { type: Number, default: 0 },
  byOperation:  { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const RecordingSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
  filename:    String,
  fileUrl:     String,

  // Legacy fields — kept populated for backwards compatibility with existing frontend.
  // transcript mirrors cleanedTranscript on write; summary/tags/actionItems are
  // extracted from reportData for the current-generation UI.
  transcript:  String,
  title:       String,
  summary:     String,
  tags:        [String],
  actionItems: [String],
  duration:    Number,

  // New processing pipeline fields.
  processingMode:   { type: String, enum: ["normal", "premium", "control", null], default: null },
  processingStatus: {
    type: String,
    enum: ["pending", "reserved", "processing", "completed", "failed", "blocked_by_quota"],
    default: "pending",
    index: true,
  },
  blockedReason:    { type: String, default: null },

  rawTranscript:     { type: String, default: "" },   // NEVER overwrite after write
  cleanedTranscript: { type: String, default: "" },

  language:          { type: String, default: null },
  detectedLanguages: { type: [String], default: [] },
  speakers:          { type: [SpeakerSchema], default: [] },

  reportType:        { type: String, enum: ["normal", "premium", null], default: null },
  reportData:        { type: mongoose.Schema.Types.Mixed, default: null },

  visuals:           [{ type: mongoose.Schema.Types.ObjectId, ref: "ReportVisual" }],

  normalMinutesConsumed:  { type: Number, default: 0 },
  premiumMinutesConsumed: { type: Number, default: 0 },

  processingJobId: { type: mongoose.Schema.Types.ObjectId, ref: "ProcessingJob", default: null },
  costSummary:     { type: CostSummarySchema, default: () => ({}) },
  qualityWarnings: { type: [QualityWarningSchema], default: [] },

  createdAt:  { type: Date, default: Date.now },
});

RecordingSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Recording", RecordingSchema);
