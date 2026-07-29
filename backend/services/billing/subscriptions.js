// Subscription lifecycle — create, cancel, apply webhook events.
//
// The four events we handle:
//   subscription.activated  — first successful charge; grant weekly credits
//   subscription.charged    — every subsequent renewal; grant weekly credits
//   subscription.cancelled  — mark local subscription cancelled
//   subscription.halted     — Razorpay gave up (multiple failed charges)
//
// Weekly grants are idempotent per (event id, wallet type) via the wallet
// service's own idempotency contract.

const {
  SubscriptionPlan, Subscription, PaymentEvent, User,
} = require("../../models");
const razorpay = require("./razorpay");
const wallet   = require("./wallet");

async function createSubscriptionForUser({ user, planCode }) {
  const plan = await SubscriptionPlan.findOne({ code: planCode, active: true });
  if (!plan) throw new Error(`Plan ${planCode} not found or inactive`);
  if (!plan.razorpayPlanId) throw new Error(`Plan ${planCode} has no razorpayPlanId configured`);

  const rzSub = await razorpay.createSubscription({
    razorpayPlanId: plan.razorpayPlanId,
    totalCount:     52,
    notes:          { userId: String(user._id), planCode },
  });

  const sub = await Subscription.create({
    userId:        user._id,
    planId:        plan._id,
    razorpaySubId: rzSub.id,
    status:        "created",
  });

  return { subscription: sub, razorpay: rzSub };
}

async function cancelSubscriptionForUser({ user, subscriptionId }) {
  const sub = await Subscription.findOne({ _id: subscriptionId, userId: user._id });
  if (!sub) throw new Error("Subscription not found");
  if (sub.razorpaySubId) {
    try { await razorpay.cancelSubscription(sub.razorpaySubId, true); }
    catch (err) { console.warn(`⚠️  Razorpay cancel warning: ${err.message}`); }
  }
  sub.cancelAt  = sub.currentPeriodEnd || new Date();
  sub.status    = "cancelled";
  sub.updatedAt = new Date();
  await sub.save();
  return sub;
}

// Apply a verified webhook event to the local state.
// Idempotent: PaymentEvent.razorpayEventId unique index dedupes retries.
async function applyWebhookEvent({ eventId, type, payload }) {
  // Dedupe: try to insert PaymentEvent first.
  let evt;
  try {
    evt = await PaymentEvent.create({
      razorpayEventId: eventId,
      type,
      payload,
    });
  } catch (err) {
    if (err.code === 11000) {
      const existing = await PaymentEvent.findOne({ razorpayEventId: eventId });
      return { alreadyProcessed: true, event: existing };
    }
    throw err;
  }

  try {
    const sub = payload?.payload?.subscription?.entity;
    if (!sub?.id) {
      evt.error = "payload had no subscription.entity.id";
      await evt.save();
      return { event: evt, skipped: true };
    }

    const localSub = await Subscription.findOne({ razorpaySubId: sub.id });
    if (!localSub) {
      evt.error = "no local subscription for razorpay id";
      await evt.save();
      return { event: evt, skipped: true };
    }
    evt.subscriptionId = localSub._id;
    evt.userId         = localSub.userId;

    const plan = await SubscriptionPlan.findById(localSub.planId);
    if (!plan) throw new Error(`Plan ${localSub.planId} missing`);

    // Update sub state + period.
    if (typeof sub.current_start === "number") localSub.currentPeriodStart = new Date(sub.current_start * 1000);
    if (typeof sub.current_end   === "number") localSub.currentPeriodEnd   = new Date(sub.current_end   * 1000);
    if (typeof sub.charge_at     === "number") localSub.nextChargeAt       = new Date(sub.charge_at     * 1000);

    let creditsToGrant = false;

    switch (type) {
      case "subscription.activated":
      case "subscription.charged":
        localSub.status = "active";
        creditsToGrant  = true;
        break;
      case "subscription.pending":
        localSub.status = "paused";
        break;
      case "subscription.halted":
        localSub.status = "halted";
        break;
      case "subscription.cancelled":
        localSub.status = "cancelled";
        break;
      case "subscription.completed":
        localSub.status = "completed";
        break;
      default:
        // ignore other event types silently
        break;
    }

    localSub.updatedAt = new Date();
    await localSub.save();

    const resultingLedgerIds = [];

    if (creditsToGrant) {
      // Grant weekly minutes idempotently per event.
      if (plan.normalMinutesGranted > 0) {
        const r = await wallet.credit({
          userId:             localSub.userId,
          walletType:         "normal",
          minutes:            plan.normalMinutesGranted,
          idempotencyKey:     `weekly_normal_${eventId}`,
          sourceType:         "weekly_grant",
          subscriptionId:     localSub._id,
          billingPeriodStart: localSub.currentPeriodStart,
          billingPeriodEnd:   localSub.currentPeriodEnd,
          note:               `Weekly credit from ${plan.code}`,
        });
        if (r.ledgerId) resultingLedgerIds.push(r.ledgerId);
      }
      if (plan.premiumMinutesGranted > 0) {
        const r = await wallet.credit({
          userId:             localSub.userId,
          walletType:         "premium",
          minutes:            plan.premiumMinutesGranted,
          idempotencyKey:     `weekly_premium_${eventId}`,
          sourceType:         "weekly_grant",
          subscriptionId:     localSub._id,
          billingPeriodStart: localSub.currentPeriodStart,
          billingPeriodEnd:   localSub.currentPeriodEnd,
          note:               `Weekly credit from ${plan.code}`,
        });
        if (r.ledgerId) resultingLedgerIds.push(r.ledgerId);
      }
    }

    evt.resultingLedgerIds = resultingLedgerIds;
    evt.processedAt        = new Date();
    await evt.save();

    return { event: evt, subscription: localSub, creditedLedgerIds: resultingLedgerIds };
  } catch (err) {
    evt.error = err.message.slice(0, 500);
    await evt.save();
    throw err;
  }
}

module.exports = {
  createSubscriptionForUser,
  cancelSubscriptionForUser,
  applyWebhookEvent,
};
