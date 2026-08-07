#!/usr/bin/env python3
"""
nba_agent.py — LangGraph-compatible node: Next-Best-Action recommendations.

Takes the customer turn context (intent, retrieved facts, and call history) and 
generates a single concrete suggestion (max 2 sentences) for the sales agent.

Design:
- Uses a stub `call_reasoning_llm` simulating a high-stakes commercial reasoning LLM.
- Logs a standard cost of $0.01 per decision to the shared `cost_log` list.
"""

import json

# Cost for the expensive reasoning LLM
COST_NBA_USD = 0.01


import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

def call_reasoning_llm(system_prompt: str, user_message: str) -> str:
    """Uses OpenAI gpt-4o for high-stakes reasoning."""
    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=0.7,
            max_tokens=150
        )
        return response.choices[0].message.content or "No suggestion generated."
    except Exception as e:
        print(f"OpenAI API Error: {e}")
        return "System error: unable to generate suggestion."


def nba_node(state: dict) -> dict:
    """LangGraph node function.
    
    Expected state input: {
        "intent": str,
        "retrieved_facts": list[str],
        "call_history": list[dict]
    }
    Returns: {"nba_suggestion": str, "cost_log": [dict]}
    """
    intent = state.get("intent", "small_talk")
    facts = state.get("retrieved_facts", [])
    history = state.get("call_history", [])

    system_prompt = (
        "You are an AI sales coach inside an inside-sales voice co-pilot. "
        "Review the customer's intent, facts retrieved from the knowledge base, "
        "and conversation history. Provide ONE concrete, actionable recommendation "
        "for the human sales agent. Keep it to a maximum of 2 sentences."
    )
    user_msg = f"Intent: {intent}\nRetrieved Facts: {json.dumps(facts)}\nCall History: {json.dumps(history)}"

    suggestion = call_reasoning_llm(system_prompt, user_msg)

    entry = {
        "agent_name": "nba",
        "model_tier": "reasoning",
        "cost_usd": COST_NBA_USD,
        "detail": f"NBA suggestion for intent: {intent}",
    }

    # Append to the global log if it's imported
    try:
        from agents.intent_agent import cost_log
        cost_log.append(entry)
    except ImportError:
        pass

    return {
        "nba_suggestion": suggestion,
        "cost_log": [entry],
    }


if __name__ == "__main__":
    # Quick standalone validation
    test_state = {
        "intent": "product_question",
        "retrieved_facts": ["FlexiPay features 0% interest and ₹199 late fee."],
        "call_history": [{"speaker": "customer", "text": "Are there any hidden fees?"}]
    }
    out = nba_node(test_state)
    print("NBA Output:", json.dumps(out, indent=2))
