const mongoose = require("mongoose");
const crypto   = require("crypto");

const UserSchema = new mongoose.Schema({
  username:     { type: String, unique: true, required: true },
  name:         { type: String, default: "" },
  email:        { type: String, default: "" },
  passwordHash: { type: String, default: null },
  provider:     { type: String, default: "local" },
  providerId:   { type: String, default: null },
  avatar:       { type: String, default: "" },
  apiKey:       { type: String, default: () => crypto.randomBytes(32).toString("hex") },
  role:         { type: String, enum: ["user", "admin"], default: "user" },
  createdAt:    { type: Date, default: Date.now },
  lastLogin:    { type: Date },
});

module.exports = mongoose.model("User", UserSchema);
