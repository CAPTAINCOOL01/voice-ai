// Visual spec generator — Claude Opus produces structured JSON for each
// visual, rendered locally by services/visuals/render.js (step 10).
//
// We do NOT call an image-generation model. Opus outputs Mermaid /
// Graphviz / Chart.js source, which we render server-side. This avoids
// per-image marginal cost and keeps the visuals evidence-linked.

const Anthropic = require("@anthropic-ai/sdk");
const { newMetrics, finalizeMetrics, markError } = require("./base");

const PREMIUM_MODEL  = process.env.PREMIUM_REPORT_MODEL          || "claude-opus-4-7";
const FALLBACK_MODEL = process.env.PREMIUM_REPORT_FALLBACK_MODEL || "claude-opus-4-6";
const anthropic      = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MAX_PREMIUM_VISUALS = 5;
const MAX_NORMAL_VISUALS  = 1;
const MAX_NODES           = 20;
const MAX_LABEL_LEN       = 100;

const SYSTEM_PROMPT = `You design visual diagrams that summarise meeting content.
Each visual must be genuinely useful — do NOT invent one to fill a quota.

## OUTPUT FORMAT
Output ONLY valid JSON with a single top-level key "visuals" whose value is an array.
No prose, no markdown fences, no commentary.

## VISUAL OBJECT
Each element of "visuals" must have:
{
  "type": one of ["flowchart", "decision_tree", "timeline", "sales_process",
                  "responsibility_matrix", "risk_matrix", "objection_map",
                  "action_sequence", "roadmap", "before_after", "topic_map",
                  "bar_chart", "line_chart", "pie_chart"],
  "title": string (max 60 chars),
  "reason": string — one sentence explaining why the transcript supports this visual,
  "renderer": one of ["mermaid", "chartjs"],
  "spec": string OR object — Mermaid source string, OR a Chart.js config object for chart types,
  "evidence": array of { "startMs", "endMs", "speaker", "text" } — transcript excerpts
              that justify the nodes/edges. Must reference real transcript segments.
}

## HARD LIMITS
  - Max ${MAX_NODES} nodes per visual.
  - Max ${MAX_LABEL_LEN} characters per node/edge label.
  - Do NOT add nodes for content that was not stated or clearly inferred from the transcript.
  - If a visual would need more than ${MAX_NODES} nodes to be honest, split it or skip it.

## MERMAID RULES
  - Prefer flowchart TD for processes, decision trees.
  - Use timeline for time-ordered events.
  - Use gantt for roadmaps if dates are given.
  - Each node label wrapped in [Label] or ("Label"). Escape special chars.
  - No colours, no styling — the renderer handles theming.

## CHARTJS RULES
  - Only for numerical data explicitly mentioned in the transcript
    (bar/line/pie).
  - "spec" is a valid Chart.js config: { type, data: { labels, datasets },
    options: {} }.

## MANDATORY LABEL
Every visual you produce will have "AI-generated visual based on the meeting
transcript." appended at render time. You do not need to include that in
your output.`;

function buildUserPrompt({ report, segments, maxVisuals }) {
  const reportSlim = {
    executive_summary:     report?.executive_summary,
    action_items:          report?.action_items,
    decisions:             report?.decisions,
    commitments:           report?.commitments,
    objections:            report?.objections,
    risks:                 report?.risks,
    unresolved_issues:     report?.unresolved_issues,
    prices_and_quantities: report?.prices_and_quantities,
    deadlines:             report?.deadlines,
  };
  const segmentDump = (segments || []).slice(0, 500).map(s =>
    `[${s.startMs}-${s.endMs} ${s.speaker}] ${s.text}`
  ).join("\n") || "(no segments)";

  return `Produce up to ${maxVisuals} genuinely useful visual specifications for this meeting.
It is fine to return FEWER — quality over quantity. Return an empty array if
nothing in the transcript benefits from a diagram.

Structured report so far:
${JSON.stringify(reportSlim, null, 2)}

Diarised segments (for evidence linking):
${segmentDump}

Return JSON: { "visuals": [ ... ] }`;
}

function extractText(msg) {
  return msg.content.filter(b => b.type === "text").map(b => b.text).join("");
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch (_) { /* fall through */ }
  const first = text.indexOf("{");
  const last  = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("No JSON object found in visuals response");
  return JSON.parse(text.slice(first, last + 1));
}

async function callOnce(model, messages, system) {
  return anthropic.messages.create({ model, max_tokens: 4096, temperature: 0, system, messages });
}

async function generateVisualSpecs({ report, segments, tier = "premium", pipelineTag = "premium", audioSeconds = 0 }) {
  const metrics = newMetrics("anthropic", PREMIUM_MODEL, pipelineTag);
  metrics.audioSeconds = audioSeconds;

  if (!process.env.ANTHROPIC_API_KEY) {
    return { visuals: [], metrics: markError(metrics, new Error("ANTHROPIC_API_KEY not set"), "MISSING_API_KEY") };
  }
  const maxVisuals = tier === "normal" ? MAX_NORMAL_VISUALS : MAX_PREMIUM_VISUALS;

  const userPrompt = buildUserPrompt({ report, segments, maxVisuals });
  const messages   = [{ role: "user", content: userPrompt }];

  let msg;
  try {
    msg = await callOnce(PREMIUM_MODEL, messages, SYSTEM_PROMPT);
  } catch (err) {
    if (FALLBACK_MODEL && FALLBACK_MODEL !== PREMIUM_MODEL) {
      console.warn(`⚠️  Visual gen primary ${PREMIUM_MODEL} failed → fallback ${FALLBACK_MODEL}`);
      try { msg = await callOnce(FALLBACK_MODEL, messages, SYSTEM_PROMPT); metrics.model = FALLBACK_MODEL; }
      catch (err2) { return { visuals: [], metrics: markError(metrics, err2) }; }
    } else {
      return { visuals: [], metrics: markError(metrics, err) };
    }
  }

  let visuals = [];
  try {
    const parsed = safeParseJson(extractText(msg));
    visuals = Array.isArray(parsed.visuals) ? parsed.visuals.slice(0, maxVisuals) : [];
  } catch (err) {
    return { visuals: [], metrics: markError(metrics, err, "PARSE_ERROR") };
  }

  metrics.inputTokens  = msg.usage?.input_tokens  || 0;
  metrics.outputTokens = msg.usage?.output_tokens || 0;
  metrics.visualCount  = visuals.length;
  metrics.metadata     = { modelUsed: metrics.model, requestedTier: tier };
  finalizeMetrics(metrics);

  return { visuals, metrics };
}

module.exports = { generateVisualSpecs, MAX_PREMIUM_VISUALS, MAX_NORMAL_VISUALS, MAX_NODES, MAX_LABEL_LEN };
