// Control-pipeline report provider — Claude Sonnet 4.6.
//
// Wraps the existing generateNotes() prompt verbatim. Same JSON output shape:
// { title, summary (markdown), tags[], actionItems[] }.
//
// Premium mode uses claudeOpus.js with a richer prompt + evidence linking.

const Anthropic = require("@anthropic-ai/sdk");
const { newMetrics, finalizeMetrics, markError } = require("./base");

const NOTES_MODEL = process.env.CONTROL_REPORT_MODEL || "claude-sonnet-4-6";
const anthropic   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a deterministic meeting intelligence system and note-taker.
Your job is to extract structured, work-related information from voice recording transcripts.
The transcript may contain filler words, informal speech, or background noise — clean it up and extract the full meaning.

## STRICT RULES
1. Output ONLY valid JSON. No markdown fences, no explanation, no commentary outside JSON.
2. Be deterministic — same input must always produce the same output.
3. Do NOT hallucinate. Extract only what is explicitly stated or clearly implied.
4. Do NOT include personal conversations, greetings, jokes, or small talk.
5. If a field has no data, return [] or null. Never omit the field.

## TASK DETECTION (for actionItems)
Extract BOTH explicit and implicit forward-looking tasks:
  EXPLICIT: "Ram will send the report", "Finish the design by Monday"
  IMPLICIT: "We should check the sizing", "Someone needs to follow up with the vendor"
Do NOT extract past regrets ("we should have done that") or pure hypotheticals.

## PRIORITY IN SUMMARY
When writing Next Steps, order by urgency: items with deadlines or urgency words first.`;

const userPrompt = text => `Analyse this voice recording transcript and return a JSON object with EXACTLY these fields:

"title": string — max 8 words, specific and descriptive (e.g. "Weekly Team Sync Follow-Up Tasks")

"summary": string — plain markdown string structured as follows:

## 🗂️ Overview\\n
2-4 sentences covering what was discussed, decided, or noted. Write in second person ("you discussed", "you mentioned"). Extract as much meaning as possible even from short recordings.\\n\\n
## 💡 Key Points\\n
- Each bullet is 1-2 sentences with context, names, numbers, or deadlines if mentioned.\\n
- Include every distinct topic, idea, or piece of information.\\n
- Do not skip minor points.\\n\\n
## 🔑 Decisions Made\\n
- List every decision with context behind it. Omit this section entirely if no decisions were made.\\n\\n
## ⚠️ Challenges & Concerns\\n
- List problems, blockers, or risks mentioned. Omit entirely if none.\\n\\n
## 🚀 Next Steps\\n
- List every next step or follow-up ordered by urgency (deadlines first).\\n
- Include implied next steps even if not explicitly stated.

"tags": array of 4-8 keyword strings covering topics, people, projects, and domains mentioned

"actionItems": array of concrete actionable tasks. Rules:
  - Include EVERY task — explicit and implicit, do not cap the list
  - Each item must start with a verb and be self-contained (include names, dates, details)
  - Exclude observations, facts, preferences, or general statements
  - Plain text only, no markdown, no bullet prefix
  - Deduplicate — same task mentioned twice appears once
  - Return [] if nothing actionable

Transcript: ${text}`;

async function report({ cleanedTranscript, rawTranscript, pipelineTag = "control", audioSeconds = 0 }) {
  const metrics = newMetrics("anthropic", NOTES_MODEL, pipelineTag);
  metrics.audioSeconds = audioSeconds;

  const text = cleanedTranscript || rawTranscript || "";
  if (!text.trim()) {
    return { title: "", summary: "", tags: [], actionItems: [], reportData: null, visualSpecs: [],
             metrics: markError(metrics, new Error("empty transcript"), "EMPTY_TRANSCRIPT") };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { title: "", summary: "", tags: [], actionItems: [], reportData: null, visualSpecs: [],
             metrics: markError(metrics, new Error("ANTHROPIC_API_KEY not set"), "MISSING_API_KEY") };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model:       NOTES_MODEL,
        max_tokens:  2048,
        temperature: 0,
        system:      SYSTEM_PROMPT,
        messages: [
          { role: "user",      content: userPrompt(text) },
          { role: "assistant", content: "{" },   // JSON prefill
        ],
      });
      const body   = msg.content.map(b => b.type === "text" ? b.text : "").join("");
      const parsed = JSON.parse("{" + body);

      metrics.inputTokens  = msg.usage?.input_tokens  || 0;
      metrics.outputTokens = msg.usage?.output_tokens || 0;
      metrics.metadata     = { stopReason: msg.stop_reason, model: msg.model };
      finalizeMetrics(metrics);

      return {
        title:       parsed.title || "",
        summary:     parsed.summary || "",
        tags:        Array.isArray(parsed.tags) ? parsed.tags : [],
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
        reportData:  { type: "control", ...parsed },
        visualSpecs: [],   // no visuals in control pipeline
        metrics,
      };
    } catch (err) {
      if (attempt === 1) {
        return {
          title: "", summary: "", tags: [], actionItems: [], reportData: null, visualSpecs: [],
          metrics: markError(metrics, err),
        };
      }
    }
  }
}

module.exports = { report, model: NOTES_MODEL };
