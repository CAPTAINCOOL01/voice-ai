// Premium report provider — Claude Opus (default 4.7, fallback 4.6).
//
// Contract (see the factuality spec):
//   - rawTranscript is NEVER overwritten. Cleaning produces cleanedTranscript.
//   - Every important report item includes transcript evidence + classification:
//       directly_stated | clearly_inferred | ai_clarification | illustrative_example
//   - Cleaning may correct punctuation/capitalisation and paragraph, may remove
//     filler when enabled. Cleaning must NOT guess missing speech, change
//     prices/dates/quantities/company names, remove negations, invent owners
//     or deadlines, or convert suggestions into decisions.
//   - Use "Unclear in the recording" for items that cannot be verified.
//
// Visual specs are produced by ./claudeOpusVisuals.js (step 9) so the
// report + visuals concerns stay small and independently testable.

const Anthropic = require("@anthropic-ai/sdk");
const { newMetrics, finalizeMetrics, markError } = require("./base");

const PREMIUM_MODEL  = process.env.PREMIUM_REPORT_MODEL          || "claude-opus-4-7";
const FALLBACK_MODEL = process.env.PREMIUM_REPORT_FALLBACK_MODEL || "claude-opus-4-6";
const REMOVE_FILLER  = String(process.env.PREMIUM_REPORT_REMOVE_FILLER || "true").toLowerCase() === "true";
// Rough INR/hour for cost estimation; actuals are captured post-hoc.
const COST_INR_PER_HOUR = 17;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a deterministic executive meeting-intelligence analyst.
You produce a structured report from a diarised voice recording transcript.

## OUTPUT FORMAT
Output ONLY valid JSON, no prose, no markdown fences, no commentary outside JSON.
Same input must always produce the same output. Temperature 0 semantics.

## FACTUALITY — READ CAREFULLY
Every important statement in your output MUST include:
  - "classification": one of "directly_stated" | "clearly_inferred" | "ai_clarification" | "illustrative_example"
  - "evidence": array of transcript excerpts { "startMs", "endMs", "speaker", "text" }
    (may be empty ONLY for ai_clarification and illustrative_example)
  - "confidence": "high" | "medium" | "low"

Classification rules:
  - directly_stated: The person said the exact fact or intent in the transcript.
  - clearly_inferred: The fact follows unambiguously from what was said (e.g. "book flight for Monday" → deadline: Monday).
  - ai_clarification: You added an explanation to improve reader understanding. MUST be prefixed with "AI clarification: " in its "text" field.
  - illustrative_example: You added an example to help understanding. MUST be prefixed with "Illustrative example: " in its "text" field.

You MUST NOT:
  - Invent decisions, prices, quantities, dates, company names, or owner assignments that weren't stated or clearly inferred.
  - Convert a hedged suggestion ("we might…", "maybe…") into a decision.
  - Remove or invert negations.
  - Attach an owner to an action item unless a specific person was named in the transcript.

If a field cannot be verified from the transcript, put the string "Unclear in the recording" in that field. Do NOT guess.

## TRANSCRIPT CLEANING
Produce "cleaned_transcript" alongside the report. Cleaning MAY:
  - Correct punctuation, capitalisation, paragraph breaks.
  ${REMOVE_FILLER ? "- Remove filler words (um, uh, you know, like)." : "- Keep filler words as-is."}
Cleaning MUST NOT:
  - Guess missing speech. If something is inaudible, write "[inaudible]".
  - Change prices, dates, quantities, company names, or proper nouns.
  - Remove negations.
  - Reword suggestions into decisions or vice versa.

## QUALITY WARNINGS
Populate "quality_warnings" with objects { "type", "message" } for anything that
should reduce reader confidence — e.g. very short recording, ambiguous speaker
labels, low audio quality signals in the transcript, missing timestamps, etc.
Empty array if none.`;

function buildUserPrompt({ rawTranscript, segments, speakers, audioSeconds }) {
  const speakerList = (speakers || []).map(s => `- ${s.label} (${Math.round((s.totalMs || 0) / 1000)}s)`).join("\n") || "- (no diarisation)";
  const segmentDump = (segments || []).slice(0, 800).map(s =>
    `[${s.startMs}-${s.endMs} ${s.speaker}] ${s.text}`
  ).join("\n") || "(no timestamped segments; raw text below)";

  return `Meeting duration: ${Math.round(audioSeconds || 0)}s.
Speakers detected:
${speakerList}

Diarised segments:
${segmentDump}

Raw transcript (fallback if segments are empty):
${rawTranscript || "(empty)"}

Produce a JSON object with EXACTLY the following top-level fields:

{
  "title": string (max 8 words, descriptive),
  "cleaned_transcript": string (see rules; preserve speaker labels if present),
  "executive_summary": string (markdown, 3-6 sentences; second person "you"),
  "summary": string (markdown; the same structured 5-section format as the legacy summary — Overview, Key Points, Decisions, Challenges, Next Steps),
  "tags": [string, ...] (4-8 keyword tags),

  "action_items": [{
    "text": string,
    "owner": string | "Unclear in the recording",
    "deadline": string | "Unclear in the recording",
    "classification": string,
    "confidence": string,
    "evidence": [{ "startMs": int, "endMs": int, "speaker": string, "text": string }]
  }],

  "decisions": [{
    "text": string,
    "classification": string,
    "confidence": string,
    "evidence": [...]
  }],

  "commitments": [{
    "text": string,
    "made_by": string | "Unclear in the recording",
    "made_to": string | "Unclear in the recording",
    "classification": string,
    "evidence": [...]
  }],

  "objections": [{
    "text": string,
    "raised_by": string | "Unclear in the recording",
    "evidence": [...]
  }],

  "risks": [{
    "text": string,
    "severity": "high" | "medium" | "low",
    "evidence": [...]
  }],

  "unresolved_issues": [{
    "text": string,
    "evidence": [...]
  }],

  "prices_and_quantities": [{
    "label": string,
    "value": string,
    "evidence": [...]
  }],

  "deadlines": [{
    "text": string,
    "date": string | "Unclear in the recording",
    "evidence": [...]
  }],

  "follow_up_recommendations": [string, ...],

  "follow_up_drafts": {
    "email": string (subject + body separated by "\\n\\n---\\n\\n"),
    "whatsapp": string (max 400 chars, casual tone)
  },

  "next_meeting_agenda": [string, ...],

  "actionItems": [string, ...] (legacy-compatible flattening of action_items[].text for the existing UI),

  "quality_warnings": [{ "type": string, "message": string }, ...]
}

Return valid JSON. Nothing else.`;
}

function extractText(msg) {
  return msg.content.filter(b => b.type === "text").map(b => b.text).join("");
}

async function callOnce(model, messages, system, maxTokens) {
  return anthropic.messages.create({
    model,
    max_tokens:  maxTokens,
    temperature: 0,
    system,
    messages,
  });
}

async function callWithFallback(messages, system, maxTokens = 8000) {
  try {
    return { msg: await callOnce(PREMIUM_MODEL, messages, system, maxTokens), model: PREMIUM_MODEL };
  } catch (err) {
    if (FALLBACK_MODEL && FALLBACK_MODEL !== PREMIUM_MODEL) {
      console.warn(`⚠️  Opus primary ${PREMIUM_MODEL} failed → fallback ${FALLBACK_MODEL}: ${err.message}`);
      return { msg: await callOnce(FALLBACK_MODEL, messages, system, maxTokens), model: FALLBACK_MODEL };
    }
    throw err;
  }
}

// Strip JSON out of a response that may or may not have wrapping text.
function safeParseJson(text) {
  // Prefer full parse.
  try { return JSON.parse(text); } catch (_) { /* fall through */ }
  // Otherwise find outer braces.
  const first = text.indexOf("{");
  const last  = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("No JSON object found in response");
  return JSON.parse(text.slice(first, last + 1));
}

async function report({ rawTranscript, cleanedTranscript, speakers, segments, pipelineTag = "premium", audioSeconds = 0 }) {
  const metrics = newMetrics("anthropic", PREMIUM_MODEL, pipelineTag);
  metrics.audioSeconds = audioSeconds;

  if (!process.env.ANTHROPIC_API_KEY) {
    return { title: "", summary: "", tags: [], actionItems: [], reportData: null, visualSpecs: [],
             metrics: markError(metrics, new Error("ANTHROPIC_API_KEY not set"), "MISSING_API_KEY") };
  }
  const inputText = rawTranscript || cleanedTranscript || "";
  if (!inputText.trim()) {
    return { title: "", summary: "", tags: [], actionItems: [], reportData: null, visualSpecs: [],
             metrics: markError(metrics, new Error("empty transcript"), "EMPTY_TRANSCRIPT") };
  }

  const userPrompt = buildUserPrompt({ rawTranscript: inputText, segments, speakers, audioSeconds });

  try {
    const { msg, model } = await callWithFallback(
      [{ role: "user", content: userPrompt }],
      SYSTEM_PROMPT,
      8000
    );

    const raw    = extractText(msg);
    const parsed = safeParseJson(raw);

    metrics.model        = model;
    metrics.inputTokens  = msg.usage?.input_tokens  || 0;
    metrics.outputTokens = msg.usage?.output_tokens || 0;
    metrics.metadata     = { stopReason: msg.stop_reason, model, modelUsed: model, fallback: model !== PREMIUM_MODEL };
    metrics.estimatedCostInr = (audioSeconds / 3600) * COST_INR_PER_HOUR;
    finalizeMetrics(metrics);

    // Coerce arrays defensively — Opus is reliable but the schema is deep.
    const arr = v => (Array.isArray(v) ? v : []);
    const cleanedOut = String(parsed.cleaned_transcript || "").trim();

    return {
      title:   parsed.title || "",
      summary: parsed.summary || parsed.executive_summary || "",
      tags:    arr(parsed.tags),
      actionItems: arr(parsed.actionItems).length ? arr(parsed.actionItems)
                   : arr(parsed.action_items).map(a => (typeof a === "string" ? a : a?.text)).filter(Boolean),
      cleanedTranscript: cleanedOut || cleanedTranscript || inputText,
      reportData: {
        type:                       "premium",
        executive_summary:          parsed.executive_summary || "",
        action_items:               arr(parsed.action_items),
        decisions:                  arr(parsed.decisions),
        commitments:                arr(parsed.commitments),
        objections:                 arr(parsed.objections),
        risks:                      arr(parsed.risks),
        unresolved_issues:          arr(parsed.unresolved_issues),
        prices_and_quantities:      arr(parsed.prices_and_quantities),
        deadlines:                  arr(parsed.deadlines),
        follow_up_recommendations:  arr(parsed.follow_up_recommendations),
        follow_up_drafts: {
          email:    parsed.follow_up_drafts?.email    || "",
          whatsapp: parsed.follow_up_drafts?.whatsapp || "",
        },
        next_meeting_agenda:        arr(parsed.next_meeting_agenda),
        quality_warnings:           arr(parsed.quality_warnings),
        model_used:                 model,
      },
      visualSpecs: [],   // step 9 fills this in a second Opus call
      metrics,
    };
  } catch (err) {
    return {
      title: "", summary: "", tags: [], actionItems: [], reportData: null, visualSpecs: [],
      metrics: markError(metrics, err),
    };
  }
}

module.exports = { report, model: PREMIUM_MODEL };
