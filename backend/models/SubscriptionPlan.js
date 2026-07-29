const mongoose = require("mongoose");

// Immutable-ish price catalogue. Admin edits go through PricingConfiguration
// history; day-to-day the frontend reads from here.
const SubscriptionPlanSchema = new mongoose.Schema({
  code:                    { type: String, unique: true, required: true },   // e.g. "normal_weekly"
  name:                    { type: String, required: true },
  description:             { type: String, default: "" },
  priceInr:                { type: Number, required: true },                 // before GST
  cadence:                 { type: String, enum: ["weekly", "monthly"], default: "weekly" },
  normalMinutesGranted:    { type: Number, default: 0 },
  premiumMinutesGranted:   { type: Number, default: 0 },
  razorpayPlanId:          { type: String, default: null },
  active:                  { type: Boolean, default: true },
  displayOrder:            { type: Number, default: 0 },
  createdAt:               { type: Date, default: Date.now },
  updatedAt:               { type: Date, default: Date.now },
});

module.exports = mongoose.model("SubscriptionPlan", SubscriptionPlanSchema);
