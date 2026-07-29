const mongoose = require("mongoose");

const ProcessingJobSchema = new mongoose.Schema({
  recordingId:             { type: mongoose.Schema.Types.ObjectId, ref: "Recording", required: true },
  userId:                  { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  mode:                    { type: String, enum: ["normal", "premium", "control"], required: true },
  status:                  {
    type: String,
    enum: ["reserved", "processing", "completed", "failed", "refunded"],
    default: "reserved",
  },
  reservedNormalMinutes:   { type: Number, default: 0 },
  reservedPremiumMinutes:  { type: Number, default: 0 },
  attempts:                { type: Number, default: 0 },
  lastError:               { type: String, default: null },
  idempotencyKey:          { type: String, required: true, unique: true },
  startedAt:               { type: Date, default: null },
  completedAt:             { type: Date, default: null },
  createdAt:               { type: Date, default: Date.now },
});

// Only one active job per recording. Partial index — MongoDB 3.2+.
ProcessingJobSchema.index(
  { recordingId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["reserved", "processing"] } } }
);
ProcessingJobSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model("ProcessingJob", ProcessingJobSchema);
