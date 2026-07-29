// Cron: trial + weekly credit expiry.
//
// Trial expiry (once per day, at 03:00 IST):
//   - Find TrialGrant where expiresAt < now AND expiredHandledAt is null.
//   - Compute unused portion of the grant (min(currentBalance, granted)) and
//     write an expiration ledger entry for it.
//   - Mark expiredHandledAt.
//
// Weekly expiry (every hour):
//   - Find Subscription with status=active AND currentPeriodEnd < now.
//   - For each: expire min(currentBalance, planMinutesGranted). This is a
//     bounded approximation (see wallet.js comments); precise per-source
//     accounting is a v2 concern.
//   - Rely on Razorpay renewal webhook to bump currentPeriodStart/End on
//     the next charge; if that doesn't fire, the sub stays past due.

const cron = require("node-cron");
const {
  TrialGrant, Subscription, SubscriptionPlan, CreditWallet,
} = require("../models");
const wallet = require("../services/billing/wallet");

function bal(wdoc, kind) { return kind === "normal" ? wdoc.normalMinutesBalance : wdoc.premiumMinutesBalance; }

async function expireTrialsOnce() {
  const now = new Date();
  const expired = await TrialGrant.find({ expiresAt: { $lt: now }, expiredHandledAt: null });
  let processed = 0;
  for (const t of expired) {
    try {
      const w = await CreditWallet.findOne({ userId: t.userId });
      if (w) {
        const nBurn = Math.max(0, Math.min(bal(w, "normal"),  t.normalGranted));
        const pBurn = Math.max(0, Math.min(bal(w, "premium"), t.premiumGranted));
        if (nBurn > 0) {
          await wallet.expireBalance({
            userId:         t.userId,
            walletType:     "normal",
            minutes:        nBurn,
            idempotencyKey: `trial_expire_normal_${t._id}`,
            note:           "Trial expiration",
          });
        }
        if (pBurn > 0) {
          await wallet.expireBalance({
            userId:         t.userId,
            walletType:     "premium",
            minutes:        pBurn,
            idempotencyKey: `trial_expire_premium_${t._id}`,
            note:           "Trial expiration",
          });
        }
      }
      t.expiredHandledAt = now;
      await t.save();
      processed += 1;
    } catch (err) {
      console.error(`❌ Trial expiry ${t._id}:`, err.message);
    }
  }
  if (processed) console.log(`🕓 Trial expiry: ${processed} grants processed`);
  return { processed };
}

async function expireWeeklyOnce() {
  const now = new Date();
  const due = await Subscription.find({
    status:            "active",
    currentPeriodEnd:  { $lt: now, $ne: null },
  });
  let processed = 0;
  for (const s of due) {
    try {
      const plan = await SubscriptionPlan.findById(s.planId);
      if (!plan) continue;
      const w = await CreditWallet.findOne({ userId: s.userId });
      if (!w) continue;
      // Idempotency key includes period-end so the same subscription can be
      // expired again next week without collision.
      const periodKey = s.currentPeriodEnd.getTime();
      const nBurn = Math.max(0, Math.min(bal(w, "normal"),  plan.normalMinutesGranted));
      const pBurn = Math.max(0, Math.min(bal(w, "premium"), plan.premiumMinutesGranted));
      if (nBurn > 0) {
        await wallet.expireBalance({
          userId:         s.userId,
          walletType:     "normal",
          minutes:        nBurn,
          idempotencyKey: `weekly_expire_normal_${s._id}_${periodKey}`,
          note:           `Weekly expiration ${plan.code}`,
        });
      }
      if (pBurn > 0) {
        await wallet.expireBalance({
          userId:         s.userId,
          walletType:     "premium",
          minutes:        pBurn,
          idempotencyKey: `weekly_expire_premium_${s._id}_${periodKey}`,
          note:           `Weekly expiration ${plan.code}`,
        });
      }
      processed += 1;
    } catch (err) {
      console.error(`❌ Weekly expiry ${s._id}:`, err.message);
    }
  }
  if (processed) console.log(`🕓 Weekly expiry: ${processed} subs processed`);
  return { processed };
}

// Wire cron schedules. Called once from server boot.
function start() {
  // Every day at 03:00 IST — trial expiries.
  cron.schedule("0 3 * * *", () => {
    expireTrialsOnce().catch(err => console.error("cron expireTrials:", err));
  }, { timezone: "Asia/Kolkata" });

  // Every hour on the hour — weekly plan expiries.
  cron.schedule("0 * * * *", () => {
    expireWeeklyOnce().catch(err => console.error("cron expireWeekly:", err));
  }, { timezone: "Asia/Kolkata" });

  console.log("🕓 Credit-expiry cron started (daily 03:00 IST + hourly weekly sweep)");
}

module.exports = { start, expireTrialsOnce, expireWeeklyOnce };
