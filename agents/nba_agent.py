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


def call_reasoning_llm(system_prompt: str, user_message: str) -> str:
    """Queries the Sarvam AI Chat Completion API to get dynamic sales suggestions."""
    import os
    import httpx
    
    api_key = os.environ.get("SARVAM_API_KEY", "sk_ouoli4yi_TeQxY387JyL86NPGEaG7KRAP")
    if not api_key:
        return _fallback_reasoning_llm(user_message)
        
    try:
        headers = {
            "api-subscription-key": api_key,
            "Content-Type": "application/json"
        }
        payload = {
            "model": "sarvam-105b-conversations",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ]
        }
        resp = httpx.post("https://api.sarvam.ai/v1/chat/completions", json=payload, headers=headers, timeout=10.0)
        if resp.status_code == 200:
            data = resp.json()
            choices = data.get("choices", [])
            if choices:
                return choices[0]["message"]["content"].strip()
        print(f"[Sarvam LLM Error in NBA] Status={resp.status_code} | Body={resp.text}")
    except Exception as e:
        print(f"[Sarvam LLM Exception in NBA] {e}")
        
    return _fallback_reasoning_llm(user_message)


def _fallback_reasoning_llm(user_message: str) -> str:
    msg = user_message.lower()
    if "objection" in msg:
        return ("Acknowledge the concern warmly. Remind the customer that FlexiPay charges "
                "ZERO interest — the ₹199 late fee only applies after a 3-day grace period "
                "and is waived on the first missed payment.")
    elif "kyc_question" in msg or "document" in msg or "paperwork" in msg:
        return ("Reassure the customer — KYC is 100% digital and takes under 10 minutes. "
                "Offer to send a secure onboarding link via SMS right now.")
    elif "ready_to_convert" in msg or "signup" in msg or "link" in msg:
        return ("Great — send the SMS registration link immediately. "
                "Remind them their pre-approved limit is reserved for 7 days.")
    elif "product_question" in msg or "interest" in msg or "fee" in msg or "services" in msg:
        return ("Confirm: 0% interest for 3 months, zero processing fee, no prepayment penalty. "
                "Ask which upcoming purchase they have in mind to check the ₹3,000 minimum.")
    else:
        return ("Build rapport — ask if they have a specific purchase in mind "
                "that qualifies for the ₹3,000 minimum transaction threshold.")


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

    # Build a customer-name from call history
    customer_text = " | ".join(
        t.get("text", "") for t in history if t.get("speaker") == "customer"
    ) or "(unknown)"

    # Facts grounded from the ChromaDB knowledge base
    facts_block = "\n".join(f"- {f}" for f in facts if f) or "No specific facts retrieved."

    system_prompt = (
        "You are Priya, a friendly and professional phone sales representative for FlexiPay, "
        "a zero-interest pay-in-3 installments product for Indian consumers.\n"
        "You are speaking DIRECTLY to a customer on a live phone call.\n\n"
        "Rules:\n"
        "- Respond DIRECTLY to the customer's question in 1-2 short, warm, conversational sentences.\n"
        "- Use the product facts provided — do NOT invent information.\n"
        "- Keep total response under 30 words — this will be read aloud over a phone call.\n"
        "- Use simple English. Do NOT use markdown, bullet points, or formatting.\n"
        "- Do NOT start with 'I' or 'As a'. Start with the answer directly or a warm acknowledgment.\n"
        "- Core facts: 0% interest for 3 months, Rs 199 late fee waived on first miss, "
        "minimum Rs 3000 transaction, KYC is fully digital and takes under 10 minutes."
    )
    user_msg = (
        f"Customer said: {customer_text}\n\n"
        f"Grounded product facts:\n{facts_block}\n\n"
        f"Customer intent: {intent}\n\n"
        "Reply to the customer directly in 1-2 short sentences:"
    )

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
