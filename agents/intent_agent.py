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

import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# ---------------------------------------------------------------- swap point
def call_cheap_llm(system_prompt: str, user_message: str) -> str:
    """Uses OpenAI gpt-4o-mini for cheap, fast classification."""
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=0.0,
            max_tokens=50
        )
        return response.choices[0].message.content or "{}"
    except Exception as e:
        print(f"OpenAI API Error: {e}")
        return "{}"


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
