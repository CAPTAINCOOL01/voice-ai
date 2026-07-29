const mongoose = require("mongoose");

// Append-only. Never update or delete a row. Sum(minutes where walletType=X)
// grouped by user must equal CreditWallet balances.
const UsageLedgerSchema = new mongoose.Schema({
  userId:              { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  recordingId:         { type: mongoose.Schema.Types.ObjectId, ref: "Recording", default: null },
  walletType:          { type: String, enum: ["normal", "premium"], required: true },
  sourceType:          {
    type: String,
    enum: ["trial", "weekly_plan", "admin_grant", "refund", "reservation", "consumption"],
    required: true,
  },
  transactionType:     {
    type: String,
    enum: [
      "trial_grant",
      "weekly_grant",
      "reservation",
      "consumption",
      "refund",
      "expiration",
      "admin_adjustment",
    ],
    required: true,
  },
  minutes:             { type: Number, required: true },     // signed: credits positive, debits negative
  status:              { type: String, enum: ["pending", "committed", "cancelled"], default: "committed" },
  idempotencyKey:      { type: String, required: true },
  billingPeriodStart:  { type: Date, default: null },
  billingPeriodEnd:    { type: Date, default: null },
  subscriptionId:      { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", default: null },
  note:                { type: String, default: "" },
  createdAt:           { type: Date, default: Date.now },
});

UsageLedgerSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
UsageLedgerSchema.index({ userId: 1, createdAt: -1 });
UsageLedgerSchema.index({ recordingId: 1 });
UsageLedgerSchema.index({ subscriptionId: 1, billingPeriodEnd: 1 });

module.exports = mongoose.model("UsageLedger", UsageLedgerSchema);
