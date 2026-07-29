const mongoose = require("mongoose");

// One trial per device, ever. deviceId is a hash of the ESP32 API key + salt.
const TrialGrantSchema = new mongoose.Schema({
  deviceId:         { type: String, unique: true, required: true },
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  normalGranted:    { type: Number, required: true },
  premiumGranted:   { type: Number, required: true },
  grantedAt:        { type: Date, default: Date.now },
  expiresAt:        { type: Date, required: true },
  expiredHandledAt: { type: Date, default: null },   // set when the expiration job burns the remainder
});

module.exports = mongoose.model("TrialGrant", TrialGrantSchema);
