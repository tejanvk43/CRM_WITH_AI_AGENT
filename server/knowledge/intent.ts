/**
 * intent.ts — The intent agent node (LangGraph-compatible).
 *
 * Classifies a transcript turn into one of:
 *   {product_question, objection, kyc_question, ready_to_convert, small_talk}
 * plus sentiment: {positive, neutral, negative}.
 *
 * Design (hackathon build principle): the cheap-model call is stubbed
 * behind `callCheapLLM()` — swap in Ollama/Gemini-lite without touching the
 * rest of the file. Default implementation is a deterministic keyword/pattern
 * classifier: $0 cost, ~0 ms latency, guaranteed valid labels.
 *
 * Every call logs {agent_name, model_tier, cost_usd} via the cost tracker.
 */

export type Intent =
  | "product_question"
  | "objection"
  | "kyc_question"
  | "ready_to_convert"
  | "small_talk";

export type Sentiment = "positive" | "neutral" | "negative";

export const INTENTS: Intent[] = [
  "product_question",
  "objection",
  "kyc_question",
  "ready_to_convert",
  "small_talk",
];

export const SENTIMENTS: Sentiment[] = ["positive", "neutral", "negative"];

export interface IntentResult {
  intent: Intent;
  sentiment: Sentiment;
  model_tier: string;
  cost_usd: number;
}

/**
 * Stub for the cheap model call. Swap the body for a real endpoint
 * (Ollama local, OpenRouter cheap tier, Gemini Flash-lite). The default
 * rule-based classifier keeps the pipeline zero-cost and key-free.
 */
export function callCheapLLM(
  _systemPrompt: string,
  userMessage: string,
): { intent: Intent; sentiment: Sentiment } {
  const text = userMessage.toLowerCase();

  const score = (kws: string[], weight = 1) =>
    kws.reduce((acc, kw) => acc + (text.includes(kw) ? weight : 0), 0);

  const intentScores: Record<Intent, number> = {
    product_question: score([
      "interest", "rate", "fee", "fees", "charges", "hidden", "installment",
      "emi", "cost", "free", "zero cost", "prepay", "prepayment", "late",
      "missed", "grace", "limit", "maximum", "minimum", "affect", "credit card",
    ]),
    objection: score(
      [
        "don't want", "dont want", "not interested", "not sure", "skeptical",
        "doubt", "scam", "catch", "trust", "too much paperwork", "think about",
        "think it over", "decide later", "send me details", "already have",
        "why would i", "no thanks", "nothing is free",
      ],
      2, // objections use stronger signals
    ),
    kyc_question: score([
      "documents", "document", "aadhaar", "pan", "kyc", "video call",
      "upload", "identity", "proof", "paperwork", "onboarding",
    ]),
    ready_to_convert: score([
      "sign up", "signup", "activate", "apply now", "register", "let's do it",
      "lets do it", "i'm in", "im in", "okay do it", "ok do it", "proceed",
      "start now", "send me the link",
    ]),
    small_talk: score([
      "how are you", "good morning", "good evening", "hello", "hi there",
      "thanks for asking", "nice weather", "have a nice", "bye", "goodbye",
    ]),
  };

  const intent: Intent =
    (Object.keys(intentScores) as Intent[]).reduce((best, k) =>
      intentScores[k] > intentScores[best] ? k : best,
    ) as Intent;
  const finalIntent = intentScores[intent] === 0 ? "small_talk" : intent;

  const pos = [
    "great", "good", "thanks", "happy", "interested", "love", "perfect",
    "sounds good", "okay", "ok", "yes", "sure", "do it", "let's do it",
  ];
  const neg = [
    "bad", "terrible", "scam", "worried", "afraid", "hate", "no thanks",
    "not interested", "annoyed", "angry", "waste", "don't trust", "dont trust",
    "nothing is free",
  ];
  const sentimentScore =
    pos.reduce((a, w) => a + (text.includes(w) ? 1 : 0), 0) -
    neg.reduce((a, w) => a + (text.includes(w) ? 1 : 0), 0);

  const sentiment: Sentiment =
    sentimentScore > 0
      ? "positive"
      : sentimentScore < 0
        ? "negative"
        : "neutral";

  return { intent: finalIntent, sentiment };
}

export const INTENT_COST_USD = 0.0002; // stub price for a cheap-model call
export const RAG_COST_USD = 0.005; // stub price for the grounded-answer call

export function classifyTurn(turn: string): IntentResult {
  const { intent, sentiment } = callCheapLLM(INTENT_SYSTEM_PROMPT, turn);
  return {
    intent,
    sentiment,
    model_tier: "cheap",
    cost_usd: INTENT_COST_USD,
  };
}

export const INTENT_SYSTEM_PROMPT =
  "You are an intent classifier for a fintech inside-sales voice co-pilot. " +
  "Classify the customer's transcript turn into exactly one of these intents: " +
  "product_question, objection, kyc_question, ready_to_convert, small_talk. " +
  "Also classify sentiment: positive, neutral, negative. " +
  "Respond ONLY with JSON: {\"intent\": ..., \"sentiment\": ...}";
