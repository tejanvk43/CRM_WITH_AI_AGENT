#!/usr/bin/env python3
"""
compliance_agent.py — LangGraph-compatible node: compliance checks on recommendations.

Scans the recommended suggestion and the customer question for sensitive keywords 
(interest rate change, credit limit, loan tenure, approval guarantee).
Applies a rule-based check followed by a lightweight LLM confirmation.

If triggered, set compliance_flag=True and prepends [human_judgment_required] to the suggestion.
"""

import json

SENSITIVE_KEYWORDS = [
    "interest rate change",
    "credit limit",
    "loan tenure",
    "approval guarantee",
    "guarantee approval",
    "guarantee my loan",
    "guarantee my approval",
]

COST_COMPLIANCE_USD = 0.0002


import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

def check_compliance_llm(text: str) -> bool:
    """Uses OpenAI gpt-4o-mini to confirm high-risk terms."""
    try:
        system_prompt = (
            "You are a compliance monitor. If the customer asks for a 'guarantee' on approval, "
            "or an 'interest rate change', or 'limit modification', return True. Otherwise False. "
            "Return only the word True or False."
        )
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text}
            ],
            temperature=0.0,
            max_tokens=10
        )
        answer = response.choices[0].message.content.strip().lower()
        return "true" in answer
    except Exception as e:
        print(f"OpenAI API Error in compliance: {e}")
        return False


def compliance_node(state: dict) -> dict:
    """LangGraph node function.
    
    Expected state input: {
        "nba_suggestion": str,
        "query": str, (or "turn" containing customer statement)
    }
    Returns: {
        "compliance_flag": bool,
        "nba_suggestion": str,
        "cost_log": [dict]
    }
    """
    nba_suggestion = state.get("nba_suggestion", "")
    customer_turn = state.get("query") or state.get("turn") or ""

    combined_text = f"NBA: {nba_suggestion} | Customer: {customer_turn}".lower()

    # Layer 1: Rule-based keyword matching
    rule_triggered = False
    for kw in SENSITIVE_KEYWORDS:
        if kw in combined_text:
            rule_triggered = True
            break

    # Layer 2: LLM confirmation
    llm_triggered = check_compliance_llm(combined_text)

    compliance_flag = rule_triggered or llm_triggered

    final_suggestion = nba_suggestion
    if compliance_flag:
        # Prepend block marker to prevent auto-speaking this suggestion to customer
        final_suggestion = "[human_judgment_required] " + nba_suggestion

    entry = {
        "agent_name": "compliance",
        "model_tier": "cheap",
        "cost_usd": COST_COMPLIANCE_USD,
        "detail": f"Compliance check. Flag={compliance_flag}",
    }

    # Append to the global log if it's imported
    try:
        from agents.intent_agent import cost_log
        cost_log.append(entry)
    except ImportError:
        pass

    return {
        "compliance_flag": compliance_flag,
        "nba_suggestion": final_suggestion,
        "cost_log": [entry],
    }


if __name__ == "__main__":
    # Quick standalone validation
    test_state = {
        "nba_suggestion": "Explain documents are safe.",
        "turn": "Can you guarantee my loan approval?"
    }
    out = compliance_node(test_state)
    print("Compliance Output:", json.dumps(out, indent=2))
