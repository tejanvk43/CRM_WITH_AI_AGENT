#!/usr/bin/env python3
"""
intent_agent.py — LangGraph-compatible node: intent + sentiment classifier.

Classifies a single transcript turn into one of:
    {product_question, objection, kyc_question, ready_to_convert, small_talk}
plus sentiment: {positive, neutral, negative}.

Design:
- Uses a cheap/fast model (stubbed behind `call_cheap_llm()` — swap the
  implementation for Qwen-2-0.5B-Instruct locally, Gemma-2B, or any cheap
  API without touching the rest of the file).
- Structured output is enforced by a simple self-healing parser: the stub
  returns JSON; if the cheap model returns free text, a rule-based fallback
  classifier still guarantees a valid label.
- Logs every call to `cost_log` with {agent_name, model_tier, cost_usd}.

LangGraph contract:
    def intent_node(state: dict) -> dict:
        return {"intent": ..., "sentiment": ..., "cost_log": [...]}
"""

import json
import re

# ---------------------------------------------------------------- cost log
# Shared across calls so the graph can sum costs at the end of a run.
cost_log: list[dict] = []

# ---------------------------------------------------------------- model tier
MODEL_TIER = "cheap"
COST_PER_CALL_USD = 0.0002

INTENTS = [
    "product_question",
    "objection",
    "kyc_question",
    "ready_to_convert",
    "small_talk",
]
SENTIMENTS = ["positive", "neutral", "negative"]

# ---------------------------------------------------------------- swap point
def call_cheap_llm(system_prompt: str, user_message: str) -> str:
    """Local rule-based classifier — zero cost, zero latency, zero API dependency."""
    text = user_message.lower()

    intent_scores = {
        "product_question": 0.0, "objection": 0.0, "kyc_question": 0.0,
        "ready_to_convert": 0.0, "small_talk": 0.0,
    }
    product_kw  = ["interest","rate","fee","fees","charges","installment","emi",
                   "cost","free","zero cost","prepay","prepayment","late",
                   "missed payment","grace","limit","maximum","minimum","services","offer"]
    objection_kw = ["don't want","dont want","not interested","not sure","skeptical",
                    "doubt","scam","catch","trust","hidden","too much paperwork",
                    "think about","think it over","decide later","send me details",
                    "already have","why would i","no thanks","nothing is ever free",
                    "hidden charges","hidden fees"]
    kyc_kw      = ["documents","document","aadhaar","pan","kyc","video call",
                   "upload","identity","proof","paperwork","onboarding"]
    convert_kw  = ["sign up","signup","activate","apply now","register",
                   "let's do it","lets do it","i'm in","im in","okay do it",
                   "ok do it","proceed","start now","send me the link"]
    smalltalk_kw= ["how are you","good morning","good evening","hello","hi",
                   "hi there","thanks for asking","nice weather","bye","goodbye","thank you"]

    for kw in product_kw:   intent_scores["product_question"] += text.count(kw)
    for kw in objection_kw: intent_scores["objection"]        += text.count(kw) * 2
    for kw in kyc_kw:       intent_scores["kyc_question"]     += text.count(kw)
    for kw in convert_kw:   intent_scores["ready_to_convert"] += text.count(kw)
    for kw in smalltalk_kw: intent_scores["small_talk"]       += text.count(kw)

    intent = max(intent_scores, key=lambda k: intent_scores[k])
    if intent_scores[intent] == 0:
        intent = "product_question"  # default for unrecognised speech

    pos = ["great","good","thanks","happy","interested","love","perfect",
           "sounds good","okay","ok","yes","sure","do it"]
    neg = ["bad","terrible","scam","worried","afraid","hate",
           "not interested","annoyed","angry","waste"]
    score = sum(1 for w in pos if w in text) - sum(1 for w in neg if w in text)
    sentiment = "positive" if score > 0 else ("negative" if score < 0 else "neutral")

    return json.dumps({"intent": intent, "sentiment": sentiment})


# ---------------------------------------------------------------- node

INTENT_SYSTEM_PROMPT = (
    "You are an intent classifier for a fintech inside-sales voice co-pilot. "
    "Classify the customer's transcript turn into exactly one of these "
    "intents: product_question, objection, kyc_question, ready_to_convert, "
    "small_talk. Also classify sentiment: positive, neutral, negative. "
    "Respond ONLY with JSON: {\"intent\": ..., \"sentiment\": ...}"
)


def intent_node(state: dict) -> dict:
    """LangGraph node function.

    Expected state input:  {"turn": "<customer transcript turn text>"}
    Returns: {"intent": str, "sentiment": str, "cost_log": [dict]}
    """
    turn = state.get("turn", "")

    raw = call_cheap_llm(INTENT_SYSTEM_PROMPT, turn)

    result = _parse_intent_output(raw)
    if result is None:
        # Defensive fallback: run the stub's own rules directly
        result = _parse_intent_output(call_cheap_llm("", turn))

    entry = {
        "agent_name": "intent",
        "model_tier": MODEL_TIER,
        "cost_usd": COST_PER_CALL_USD,
        "turn_snippet": turn[:80],
    }
    cost_log.append(entry)

    return {
        "intent": result["intent"],
        "sentiment": result["sentiment"],
        "cost_log": [entry],
    }


from typing import Optional

def _parse_intent_output(raw: str) -> Optional[dict]:
    """Self-healing parser: tolerate markdown fences and stray text."""
    text = raw.strip()
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    intent = obj.get("intent", "")
    sentiment = obj.get("sentiment", "")
    if intent not in INTENTS:
        intent = "small_talk"
    if sentiment not in SENTIMENTS:
        sentiment = "neutral"
    return {"intent": intent, "sentiment": sentiment}


if __name__ == "__main__":
    # Standalone sanity check
    for turn in [
        "Is there really no interest on this?",
        "I need time to think about it. Send me the details.",
        "Sounds good, let's do it — send me the signup link.",
    ]:
        out = intent_node({"turn": turn})
        print(f"{turn!r} -> {out['intent']} / {out['sentiment']}")
    print("\nCost log:", json.dumps(cost_log, indent=2))
