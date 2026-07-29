const mongoose = require("mongoose");

// Materialised cache of ledger balances. Source of truth is UsageLedger;
// this doc is updated atomically in the same transaction as ledger writes.
const CreditWalletSchema = new mongoose.Schema({
  userId:                 { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, required: true },
  normalMinutesBalance:   { type: Number, default: 0 },
  premiumMinutesBalance:  { type: Number, default: 0 },
  updatedAt:              { type: Date, default: Date.now },
});

module.exports = mongoose.model("CreditWallet", CreditWalletSchema);
