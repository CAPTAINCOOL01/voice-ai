// Single entry point for all Mongoose models. Requiring this file registers
// every schema with mongoose.model(), so downstream code can either destructure
// from here or continue using mongoose.model("Name") lookups.
module.exports = {
  User:                  require("./User"),
  Recording:             require("./Recording"),
  Project:               require("./Project"),
  SubscriptionPlan:      require("./SubscriptionPlan"),
  Subscription:          require("./Subscription"),
  CreditWallet:          require("./CreditWallet"),
  UsageLedger:           require("./UsageLedger"),
  TrialGrant:            require("./TrialGrant"),
  ProcessingJob:         require("./ProcessingJob"),
  ModelRun:              require("./ModelRun"),
  PaymentEvent:          require("./PaymentEvent"),
  ReportVisual:          require("./ReportVisual"),
  CostConfiguration:     require("./CostConfiguration"),
  PricingConfiguration:  require("./PricingConfiguration"),
};
