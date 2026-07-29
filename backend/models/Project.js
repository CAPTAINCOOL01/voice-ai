const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema({
  text:        String,
  done:        { type: Boolean, default: false },
  dueDate:     Date,
  recordingId: String,
  createdAt:   { type: Date, default: Date.now },
});

const ProjectSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  name:        String,
  emoji:       { type: String, default: "📁" },
  color:       { type: String, default: "#f59e0b" },
  description: { type: String, default: "" },
  tasks:       [TaskSchema],
  createdAt:   { type: Date, default: Date.now },
});

module.exports = mongoose.model("Project", ProjectSchema);
