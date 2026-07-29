const mongoose = require("mongoose");

const EvidenceSchema = new mongoose.Schema({
  startMs: Number,
  endMs:   Number,
  speaker: String,
  text:    String,
}, { _id: false });

const ReportVisualSchema = new mongoose.Schema({
  recordingId:      { type: mongoose.Schema.Types.ObjectId, ref: "Recording", required: true, index: true },
  type:             {
    type: String,
    enum: [
      "flowchart", "decision_tree", "timeline", "sales_process", "responsibility_matrix",
      "risk_matrix", "objection_map", "action_sequence", "roadmap",
      "before_after", "topic_map", "bar_chart", "line_chart", "pie_chart",
    ],
    required: true,
  },
  title:            { type: String, required: true },
  reason:           { type: String, default: "" },              // why this visual was generated
  renderer:         { type: String, enum: ["mermaid", "graphviz", "chartjs", "svg"], required: true },
  spec:             { type: mongoose.Schema.Types.Mixed, required: true },   // renderer-specific source
  renderedSvgKey:   { type: String, default: null },            // R2 key for pre-rendered SVG/PNG
  evidence:         [EvidenceSchema],
  validationErrors: [String],
  pipelineTag:      { type: String, enum: ["normal", "premium"], required: true },
  createdAt:        { type: Date, default: Date.now },
});

module.exports = mongoose.model("ReportVisual", ReportVisualSchema);
