const mongoose = require("mongoose");

const SubscriptionSchema = new mongoose.Schema({
  userId:              { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  planId:              { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionPlan", required: true },
  razorpaySubId:       { type: String, default: null, index: true },
  status:              {
    type: String,
    enum: ["created", "authenticated", "active", "paused", "halted", "cancelled", "completed", "expired"],
    default: "created",
  },
  currentPeriodStart:  { type: Date, default: null },
  currentPeriodEnd:    { type: Date, default: null },
  cancelAt:            { type: Date, default: null },
  nextChargeAt:        { type: Date, default: null },
  createdAt:           { type: Date, default: Date.now },
  updatedAt:           { type: Date, default: Date.now },
});

SubscriptionSchema.index({ userId: 1, status: 1 });
SubscriptionSchema.index({ status: 1, nextChargeAt: 1 });

module.exports = mongoose.model("Subscription", SubscriptionSchema);
