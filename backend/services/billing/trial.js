// Free-trial activation. Fires on first-ever device contact (heartbeat or /save).
//
// deviceId = SHA-256(apiKey). Deterministic + unique per API key. Regenerating
// the key mints a new device — acceptable for MVP since key regeneration is
// admin-only in the current UI.
//
// TrialGrant.deviceId is unique, so concurrent calls collide harmlessly.
// Wallet credits use deterministic idempotency keys derived from deviceId,
// so the credit side is also safe under a race.

const crypto = require("crypto");
const { TrialGrant } = require("../../models");
const wallet = require("./wallet");

const TRIAL_NORMAL_MINUTES  = Number(process.env.TRIAL_NORMAL_MINUTES)  || 120;
const TRIAL_PREMIUM_MINUTES = Number(process.env.TRIAL_PREMIUM_MINUTES) || 60;
const TRIAL_VALIDITY_DAYS   = Number(process.env.TRIAL_VALIDITY_DAYS)   || 14;

function deviceIdFromApiKey(apiKey) {
  return crypto.createHash("sha256").update(String(apiKey)).digest("hex");
}

async function activateDeviceTrial({ apiKey, userId }) {
  if (!apiKey || !userId) throw new Error("apiKey and userId required");

  const deviceId = deviceIdFromApiKey(apiKey);
  const existing = await TrialGrant.findOne({ deviceId });
  if (existing) return { alreadyActive: true, trialGrant: existing };

  const now       = new Date();
  const expiresAt = new Date(now.getTime() + TRIAL_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

  // Insert first — unique index makes this the race arbiter.
  let grant;
  try {
    grant = await TrialGrant.create({
      deviceId,
      userId,
      normalGranted:  TRIAL_NORMAL_MINUTES,
      premiumGranted: TRIAL_PREMIUM_MINUTES,
      grantedAt:      now,
      expiresAt,
    });
  } catch (err) {
    // Duplicate key means another concurrent call won — treat as already active.
    if (err.code === 11000) {
      const other = await TrialGrant.findOne({ deviceId });
      return { alreadyActive: true, trialGrant: other };
    }
    throw err;
  }

  // Credit both wallets. Idempotency keys are deterministic → safe on retry.
  const normalCredit = await wallet.credit({
    userId,
    walletType:     "normal",
    minutes:        TRIAL_NORMAL_MINUTES,
    idempotencyKey: `trial_normal_${deviceId}`,
    sourceType:     "trial_grant",
    note:           `Free device trial (${TRIAL_VALIDITY_DAYS} days)`,
  });
  const premiumCredit = await wallet.credit({
    userId,
    walletType:     "premium",
    minutes:        TRIAL_PREMIUM_MINUTES,
    idempotencyKey: `trial_premium_${deviceId}`,
    sourceType:     "trial_grant",
    note:           `Free device trial (${TRIAL_VALIDITY_DAYS} days)`,
  });

  return { activated: true, trialGrant: grant, normalCredit, premiumCredit };
}

module.exports = { activateDeviceTrial, deviceIdFromApiKey };
