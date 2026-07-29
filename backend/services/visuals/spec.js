// Visual spec validation. Fails fast on obvious violations of the factuality
// contract (evidence, node count, label length). Full syntax validation of
// Mermaid happens at render time (step 10); a broken Mermaid string is
// caught there and demoted to a validationError.

const {
  MAX_NODES, MAX_LABEL_LEN,
} = require("../providers/claudeOpusVisuals");

const ALLOWED_TYPES = new Set([
  "flowchart", "decision_tree", "timeline", "sales_process",
  "responsibility_matrix", "risk_matrix", "objection_map",
  "action_sequence", "roadmap", "before_after", "topic_map",
  "bar_chart", "line_chart", "pie_chart",
]);

const ALLOWED_RENDERERS = new Set(["mermaid", "chartjs", "graphviz", "svg"]);

// Very light Mermaid node counter — matches [Label], (Label), {Label}, ("Label").
// Returns { nodeCount, longestLabel }.
function countMermaidNodes(spec) {
  const src = String(spec || "");
  const matches = src.match(/[\[\(\{]("?[^\]\)\}"\n]{1,300}?)"?[\]\)\}]/g) || [];
  let longest = 0;
  const seen = new Set();
  for (const raw of matches) {
    const inner = raw.slice(1, -1).replace(/^"/, "").replace(/"$/, "").trim();
    if (!inner) continue;
    seen.add(inner);
    if (inner.length > longest) longest = inner.length;
  }
  return { nodeCount: seen.size, longestLabel: longest };
}

// Count nodes for chartjs — sum of data labels + dataset counts.
function countChartLabels(specObj) {
  if (!specObj || typeof specObj !== "object") return { nodeCount: 0, longestLabel: 0 };
  const labels = Array.isArray(specObj.data?.labels) ? specObj.data.labels : [];
  const longest = labels.reduce((m, l) => Math.max(m, String(l || "").length), 0);
  return { nodeCount: labels.length, longestLabel: longest };
}

function validate(visual) {
  const errors = [];
  if (!visual || typeof visual !== "object") return { valid: false, errors: ["not an object"] };
  if (!ALLOWED_TYPES.has(visual.type))         errors.push(`unknown type: ${visual.type}`);
  if (!ALLOWED_RENDERERS.has(visual.renderer)) errors.push(`unknown renderer: ${visual.renderer}`);
  if (!visual.title || typeof visual.title !== "string") errors.push("title missing");
  if (!visual.spec) errors.push("spec missing");
  if (!Array.isArray(visual.evidence)) errors.push("evidence missing");
  else if (visual.evidence.length === 0 && visual.renderer !== "chartjs") {
    errors.push("evidence[] must not be empty for narrative visuals");
  }

  // Node/label limits.
  let counts = { nodeCount: 0, longestLabel: 0 };
  if (visual.renderer === "mermaid" || visual.renderer === "graphviz") {
    counts = countMermaidNodes(visual.spec);
  } else if (visual.renderer === "chartjs") {
    counts = countChartLabels(visual.spec);
  }
  if (counts.nodeCount   > MAX_NODES)     errors.push(`node count ${counts.nodeCount} exceeds max ${MAX_NODES}`);
  if (counts.longestLabel > MAX_LABEL_LEN) errors.push(`label length ${counts.longestLabel} exceeds max ${MAX_LABEL_LEN}`);

  return { valid: errors.length === 0, errors, counts };
}

// Filter + annotate. Returns { valid: [...], invalid: [{ spec, errors }] }.
function filterAndAnnotate(visuals) {
  const valid   = [];
  const invalid = [];
  for (const v of (visuals || [])) {
    const r = validate(v);
    if (r.valid) valid.push({ ...v, validationCounts: r.counts });
    else         invalid.push({ spec: v, errors: r.errors });
  }
  return { valid, invalid };
}

module.exports = { validate, filterAndAnnotate, countMermaidNodes, countChartLabels };
