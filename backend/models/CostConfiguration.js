const mongoose = require("mongoose");

// Single-doc pattern. Cached in memory on boot, refreshed on admin edit.
// Env vars supply initial values; DB doc is the runtime source of truth.
const CostConfigurationSchema = new mongoose.Schema({
  key:                        { type: String, unique: true, default: "singleton" },
  normalCostTargetInrPerHour: { type: Number, default: 10 },
  premiumCostTargetInrPerHour:{ type: Number, default: 67 },
  sarvamSttCostInrPerHour:    { type: Number, default: 45 },
  claudeOpusCostInrPerHour:   { type: Number, default: 17 },
  storageCostInrPerHour:      { type: Number, default: 5 },
  gpuCostInrPerSecond:        { type: Number, default: 0 },
  claudeInputCostInrPerMTok:  { type: Number, default: 0 },
  claudeOutputCostInrPerMTok: { type: Number, default: 0 },
  updatedAt:                  { type: Date, default: Date.now },
  updatedBy:                  { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
});

module.exports = mongoose.model("CostConfiguration", CostConfigurationSchema);
