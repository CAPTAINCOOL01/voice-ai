// Razorpay SDK wrapper + webhook signature verification.
//
// Design notes:
//   - The Razorpay client is created lazily so the module can be required even
//     when the keys aren't set (dev / early boot).
//   - Signature verification uses the raw request body — the webhook route in
//     server.js mounts express.raw() specifically for /webhooks/razorpay.
//   - All API calls go through this file so retries + timeouts can be added
//     in one place later.

const crypto = require("crypto");
let _client  = null;

function client() {
  if (_client) return _client;
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET not set");
  }
  const Razorpay = require("razorpay");
  _client = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  return _client;
}

// Timing-safe HMAC compare against X-Razorpay-Signature.
function verifyWebhookSignature(rawBody, signatureHeader) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new Error("RAZORPAY_WEBHOOK_SECRET not set");
  if (!rawBody || !signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signatureHeader), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Create a subscription on Razorpay's side. The `plan_id` field is the
// Razorpay-issued id (SubscriptionPlan.razorpayPlanId in our DB); admins are
// expected to create the plan in Razorpay's dashboard and paste its id.
async function createSubscription({ razorpayPlanId, totalCount, notes }) {
  const c = client();
  return c.subscriptions.create({
    plan_id:     razorpayPlanId,
    total_count: totalCount || 52,      // 52 weeks
    quantity:    1,
    customer_notify: 1,
    notes:       notes || {},
  });
}

async function cancelSubscription(razorpaySubId, cancelAtCycleEnd = true) {
  return client().subscriptions.cancel(razorpaySubId, cancelAtCycleEnd);
}

async function fetchSubscription(razorpaySubId) {
  return client().subscriptions.fetch(razorpaySubId);
}

module.exports = {
  client,
  verifyWebhookSignature,
  createSubscription,
  cancelSubscription,
  fetchSubscription,
};
