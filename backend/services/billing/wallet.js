// Wallet operations — reserve, commit, refund, credit.
//
// Every mutation is idempotent on (userId, idempotencyKey). Balance changes are
// transactional against the UsageLedger; the CreditWallet doc is a cache and
// is always mutated in the same session as its ledger row. See ledger.js for
// reconciliation helpers.
//
// Requires MongoDB replica set (Atlas provides one by default).

const mongoose = require("mongoose");
const { CreditWallet, UsageLedger } = require("../../models");

class InsufficientFundsError extends Error {
  constructor(walletType, requested, available) {
    super(`Insufficient ${walletType} minutes: requested ${requested}, available ${available}`);
    this.name       = "InsufficientFundsError";
    this.code       = "INSUFFICIENT_FUNDS";
    this.walletType = walletType;
    this.requested  = requested;
    this.available  = available;
  }
}

const balField = t => (t === "normal" ? "normalMinutesBalance" : "premiumMinutesBalance");

async function getOrCreateWallet(userId) {
  return CreditWallet.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId, normalMinutesBalance: 0, premiumMinutesBalance: 0 } },
    { upsert: true, new: true }
  );
}

async function getBalance(userId) {
  const w = await getOrCreateWallet(userId);
  return {
    normalMinutesBalance:  w.normalMinutesBalance,
    premiumMinutesBalance: w.premiumMinutesBalance,
  };
}

async function _findByKey(userId, key) {
  return UsageLedger.findOne({ userId, idempotencyKey: key });
}

// Reserve N minutes. Balance drops immediately (so concurrent reservations
// can't over-spend). Ledger row is written with status='pending'.
async function reserve({ userId, walletType, minutes, idempotencyKey, recordingId, note }) {
  if (!["normal", "premium"].includes(walletType)) throw new Error("invalid walletType");
  if (!(minutes > 0)) throw new Error("minutes must be positive");
  if (!idempotencyKey) throw new Error("idempotencyKey required");

  const existing = await _findByKey(userId, idempotencyKey);
  if (existing) return { ledgerId: existing._id, alreadyExists: true, status: existing.status };

  const bal = balField(walletType);
  const session = await mongoose.startSession();
  let ledger;
  try {
    await session.withTransaction(async () => {
      await CreditWallet.updateOne(
        { userId },
        { $setOnInsert: { userId, normalMinutesBalance: 0, premiumMinutesBalance: 0 } },
        { upsert: true, session }
      );
      const dec = await CreditWallet.findOneAndUpdate(
        { userId, [bal]: { $gte: minutes } },
        { $inc: { [bal]: -minutes }, $set: { updatedAt: new Date() } },
        { new: true, session }
      );
      if (!dec) {
        const w = await CreditWallet.findOne({ userId }, null, { session });
        throw new InsufficientFundsError(walletType, minutes, w ? w[bal] : 0);
      }
      const [row] = await UsageLedger.create([{
        userId,
        recordingId:     recordingId || null,
        walletType,
        sourceType:      "reservation",
        transactionType: "reservation",
        minutes:         -minutes,
        status:          "pending",
        idempotencyKey,
        note:            note || "",
      }], { session });
      ledger = row;
    });
  } finally {
    await session.endSession();
  }
  return { ledgerId: ledger._id, alreadyExists: false, status: "pending" };
}

// Confirm a reservation. Ledger row flips pending → committed. Balance unchanged.
// Also flips the linked ProcessingJob (if present) — caller handles that.
async function commit({ userId, idempotencyKey }) {
  const row = await _findByKey(userId, idempotencyKey);
  if (!row) throw new Error(`No reservation with key ${idempotencyKey}`);
  if (row.status === "committed") return { alreadyCommitted: true, ledgerId: row._id };
  if (row.status === "cancelled") throw new Error("Reservation was already refunded");
  row.status = "committed";
  await row.save();
  return { committed: true, ledgerId: row._id };
}

// Refund a reservation. Appends a positive ledger row, flips original to cancelled,
// increments the wallet.
async function refund({ userId, reservationIdempotencyKey, refundIdempotencyKey, note }) {
  const orig = await _findByKey(userId, reservationIdempotencyKey);
  if (!orig) throw new Error(`No reservation with key ${reservationIdempotencyKey}`);
  if (orig.status === "cancelled") return { alreadyRefunded: true };

  const existingRefund = await _findByKey(userId, refundIdempotencyKey);
  if (existingRefund) return { alreadyRefunded: true, ledgerId: existingRefund._id };

  const bal     = balField(orig.walletType);
  const minutes = -orig.minutes;                 // orig was negative; refund is positive

  const session = await mongoose.startSession();
  let refundRow;
  try {
    await session.withTransaction(async () => {
      await CreditWallet.updateOne(
        { userId },
        { $inc: { [bal]: minutes }, $set: { updatedAt: new Date() } },
        { session }
      );
      const [row] = await UsageLedger.create([{
        userId,
        recordingId:     orig.recordingId,
        walletType:      orig.walletType,
        sourceType:      "refund",
        transactionType: "refund",
        minutes,
        status:          "committed",
        idempotencyKey:  refundIdempotencyKey,
        note:            note || `Refund of reservation ${reservationIdempotencyKey}`,
      }], { session });
      refundRow = row;
      orig.status = "cancelled";
      await orig.save({ session });
    });
  } finally {
    await session.endSession();
  }
  return { refunded: true, ledgerId: refundRow._id };
}

// Add credit (trial_grant, weekly_grant, admin_adjustment). Idempotent.
async function credit({
  userId, walletType, minutes, idempotencyKey, sourceType,
  subscriptionId, billingPeriodStart, billingPeriodEnd, note,
}) {
  if (!(minutes > 0)) throw new Error("minutes must be positive");
  if (!idempotencyKey) throw new Error("idempotencyKey required");

  const existing = await _findByKey(userId, idempotencyKey);
  if (existing) return { alreadyExists: true, ledgerId: existing._id };

  const bal = balField(walletType);
  const sourceToTxn = {
    trial_grant:       "trial_grant",
    weekly_grant:      "weekly_grant",
    admin_adjustment:  "admin_adjustment",
  };
  const transactionType = sourceToTxn[sourceType] || "admin_adjustment";
  const ledgerSource = {
    trial_grant:      "trial",
    weekly_grant:     "weekly_plan",
    admin_adjustment: "admin_grant",
  }[sourceType] || "admin_grant";

  const session = await mongoose.startSession();
  let row;
  try {
    await session.withTransaction(async () => {
      await CreditWallet.updateOne(
        { userId },
        {
          $inc:          { [bal]: minutes },
          $set:          { updatedAt: new Date() },
          $setOnInsert:  { userId },
        },
        { upsert: true, session }
      );
      const [doc] = await UsageLedger.create([{
        userId,
        walletType,
        sourceType:         ledgerSource,
        transactionType,
        minutes,
        status:             "committed",
        idempotencyKey,
        billingPeriodStart: billingPeriodStart || null,
        billingPeriodEnd:   billingPeriodEnd   || null,
        subscriptionId:     subscriptionId     || null,
        note:               note || "",
      }], { session });
      row = doc;
    });
  } finally {
    await session.endSession();
  }
  return { credited: true, ledgerId: row._id };
}

// Expire remaining balance at end of a billing period. Writes a negative
// "expiration" ledger entry that zeros the wallet down to zero (or to the
// balance carried in from other sources, if we ever add rollover).
async function expireBalance({ userId, walletType, minutes, idempotencyKey, note }) {
  if (!(minutes > 0)) return { skipped: true };
  const existing = await _findByKey(userId, idempotencyKey);
  if (existing) return { alreadyExists: true, ledgerId: existing._id };

  const bal = balField(walletType);
  const session = await mongoose.startSession();
  let row;
  try {
    await session.withTransaction(async () => {
      await CreditWallet.updateOne(
        { userId },
        { $inc: { [bal]: -minutes }, $set: { updatedAt: new Date() } },
        { session }
      );
      const [doc] = await UsageLedger.create([{
        userId,
        walletType,
        sourceType:      "weekly_plan",
        transactionType: "expiration",
        minutes:         -minutes,
        status:          "committed",
        idempotencyKey,
        note:            note || "Weekly plan expiration",
      }], { session });
      row = doc;
    });
  } finally {
    await session.endSession();
  }
  return { expired: true, ledgerId: row._id };
}

module.exports = {
  InsufficientFundsError,
  getBalance,
  getOrCreateWallet,
  reserve,
  commit,
  refund,
  credit,
  expireBalance,
};
