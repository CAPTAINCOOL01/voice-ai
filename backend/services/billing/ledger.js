// Read-side helpers over UsageLedger.
// Wallet mutations live in ./wallet.js; this file is for listings and
// reconciliation checks.

const { UsageLedger, CreditWallet } = require("../../models");

async function listForUser(userId, { limit = 50, before } = {}) {
  const q = { userId };
  if (before) q.createdAt = { $lt: new Date(before) };
  return UsageLedger.find(q)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(1, Number(limit) || 50), 200))
    .lean();
}

// Recompute balances from the ledger. Excludes cancelled entries.
async function recomputeBalance(userId) {
  const agg = await UsageLedger.aggregate([
    { $match: { userId, status: { $ne: "cancelled" } } },
    { $group: { _id: "$walletType", total: { $sum: "$minutes" } } },
  ]);
  const out = { normalMinutesBalance: 0, premiumMinutesBalance: 0 };
  for (const r of agg) {
    if (r._id === "normal")  out.normalMinutesBalance  = r.total;
    if (r._id === "premium") out.premiumMinutesBalance = r.total;
  }
  return out;
}

// Compare cached wallet doc to recomputed value. Returns drift per wallet.
async function checkConsistency(userId) {
  const cached     = await CreditWallet.findOne({ userId }).lean();
  const recomputed = await recomputeBalance(userId);
  return {
    cached: cached
      ? { normalMinutesBalance: cached.normalMinutesBalance, premiumMinutesBalance: cached.premiumMinutesBalance }
      : { normalMinutesBalance: 0, premiumMinutesBalance: 0 },
    recomputed,
    drift: {
      normal:  (cached?.normalMinutesBalance  ?? 0) - recomputed.normalMinutesBalance,
      premium: (cached?.premiumMinutesBalance ?? 0) - recomputed.premiumMinutesBalance,
    },
  };
}

module.exports = { listForUser, recomputeBalance, checkConsistency };
