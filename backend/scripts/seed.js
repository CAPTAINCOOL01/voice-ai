// Idempotent seed for SubscriptionPlan, CostConfiguration, PricingConfiguration.
// Safe to run repeatedly — every write is upsert-by-natural-key.
//
// Usage:  node scripts/seed.js
require("dotenv").config();
const mongoose = require("mongoose");
const {
  SubscriptionPlan,
  CostConfiguration,
  PricingConfiguration,
} = require("../models");

const num = (v, d) => (v === undefined || v === "" ? d : Number(v));

const PLANS = [
  {
    code: "normal_weekly",
    name: "Normal Weekly",
    description: "300 Normal AI Minutes each week. Best for everyday meetings.",
    priceInr: 69,
    cadence: "weekly",
    normalMinutesGranted:  300,
    premiumMinutesGranted: 0,
    displayOrder: 1,
  },
  {
    code: "premium_weekly",
    name: "Premium Weekly",
    description: "180 Premium AI Minutes each week. Best for important meetings.",
    priceInr: 299,
    cadence: "weekly",
    normalMinutesGranted:  0,
    premiumMinutesGranted: 180,
    displayOrder: 2,
  },
  {
    code: "complete_weekly",
    name: "Complete Weekly",
    description: "300 Normal + 180 Premium AI Minutes each week.",
    priceInr: 349,
    cadence: "weekly",
    normalMinutesGranted:  300,
    premiumMinutesGranted: 180,
    displayOrder: 3,
  },
];

async function seedPlans() {
  for (const p of PLANS) {
    await SubscriptionPlan.updateOne(
      { code: p.code },
      { $set: { ...p, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    console.log(`  ✓ plan: ${p.code}`);
  }
}

async function seedCostConfig() {
  await CostConfiguration.updateOne(
    { key: "singleton" },
    {
      $set: {
        normalCostTargetInrPerHour:  num(process.env.NORMAL_COST_TARGET_INR_PER_HOUR, 10),
        premiumCostTargetInrPerHour: num(process.env.PREMIUM_COST_TARGET_INR_PER_HOUR, 67),
        sarvamSttCostInrPerHour:     45,
        claudeOpusCostInrPerHour:    17,
        storageCostInrPerHour:       5,
        updatedAt:                   new Date(),
      },
    },
    { upsert: true }
  );
  console.log("  ✓ cost configuration");
}

async function seedPricingConfig() {
  await PricingConfiguration.updateOne(
    { key: "singleton" },
    {
      $set: {
        targetContributionMargin: num(process.env.TARGET_CONTRIBUTION_MARGIN, 0.25),
        paymentGatewayRate:       num(process.env.PAYMENT_GATEWAY_RATE, 0.02),
        gstRate:                  0.18,
        minSellingPriceFloorInr:  49,
        updatedAt:                new Date(),
      },
    },
    { upsert: true }
  );
  console.log("  ✓ pricing configuration");
}

(async () => {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI not set");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Seeding…");
  await seedPlans();
  await seedCostConfig();
  await seedPricingConfig();
  await mongoose.disconnect();
  console.log("Done.");
})().catch(err => { console.error(err); process.exit(1); });
