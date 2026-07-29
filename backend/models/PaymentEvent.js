const mongoose = require("mongoose");

// Raw Razorpay webhook events, verified + deduplicated by razorpayEventId.
// Payload is stored verbatim for audit; processing derives ledger entries.
const PaymentEventSchema = new mongoose.Schema({
  razorpayEventId:    { type: String, unique: true, required: true },
  type:               { type: String, required: true },       // e.g. "subscription.charged"
  payload:            { type: mongoose.Schema.Types.Mixed, required: true },
  subscriptionId:     { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", default: null },
  userId:             { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  verifiedAt:         { type: Date, default: Date.now },
  processedAt:        { type: Date, default: null },
  resultingLedgerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "UsageLedger" }],
  error:              { type: String, default: null },
});

module.exports = mongoose.model("PaymentEvent", PaymentEventSchema);
