const mongoose = require("mongoose");

const PricingConfigurationSchema = new mongoose.Schema({
  key:                       { type: String, unique: true, default: "singleton" },
  targetContributionMargin:  { type: Number, default: 0.25 },
  paymentGatewayRate:        { type: Number, default: 0.02 },
  gstRate:                   { type: Number, default: 0.18 },
  minSellingPriceFloorInr:   { type: Number, default: 49 },
  updatedAt:                 { type: Date, default: Date.now },
  updatedBy:                 { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
});

module.exports = mongoose.model("PricingConfiguration", PricingConfigurationSchema);
