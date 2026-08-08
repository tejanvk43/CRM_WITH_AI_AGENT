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
    
    # Credentials come ONLY from the environment — never hardcode keys in source.
    api_key = os.environ.get("SARVAM_API_KEY")
    if not api_key:
        print("[NBA] SARVAM_API_KEY not set — using keyword fallback.")
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
            ],
            "max_tokens": 45,
            "temperature": 0.2
        }
        resp = httpx.post("https://api.sarvam.ai/v1/chat/completions", json=payload, headers=headers, timeout=5.0)
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
    if "interest" in msg or "rate" in msg or "fee" in msg or "cost" in msg or "charge" in msg:
        return ("Great question! FlexiPay gives you 100 percent zero interest for three full months with no processing fees. "
                "Are you planning an upcoming purchase?")
    elif "kyc" in msg or "document" in msg or "paperwork" in msg or "aadhaar" in msg or "pan" in msg:
        return ("Our KYC is completely digital and takes just two minutes with your Aadhaar card! "
                "Would you like me to send you the verification link right now?")
    elif "limit" in msg or "amount" in msg or "maximum" in msg or "eligible" in msg or "how much" in msg:
        return ("Our credit lines range from 3,000 up to 75,000 rupees based on your profile. "
                "How much credit were you looking to get today?")
    elif "miss" in msg or "late" in msg or "penalty" in msg or "overdue" in msg:
        return ("No worries at all! We offer a three-day grace period, and the late fee is completely waived on your first missed payment. "
                "Does that help?")
    elif "link" in msg or "sms" in msg or "apply" in msg or "register" in msg or "signup" in msg:
        return ("Awesome! I can text the instant 1-click onboarding link straight to your phone right now. "
                "Shall I go ahead and send it?")
    elif "hello" in msg or "hi" in msg or "hey" in msg:
        return ("Hello! I'm Priya from FlexiPay. I'd love to help you with our zero percent interest credit line today. "
                "What can I answer for you?")
    else:
        return ("I'd be delighted to help with that! FlexiPay offers instant zero percent interest credit lines for Indian shoppers. "
                "What purchase do you have in mind today?")


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
        "You are Priya, a warm, enthusiastic, and helpful sales advisor for FlexiPay.\n"
        "You are speaking live on the phone with a customer.\n\n"
        "Rules for speaking naturally like a real human:\n"
        "- Sound warm, engaging, and friendly—never robotic or clunky.\n"
        "- Always start with a natural conversational opener (e.g. 'Sure thing!', 'Great question!', 'I would love to help you with that!').\n"
        "- Give a clear, helpful 1-sentence explanation without clumsy jargon.\n"
        "- End with an interactive question or polite offer to keep the conversation flowing smoothly.\n"
        "- Keep total response under 25 words.\n"
        "- Never spell out words or use weird symbols. Say 'pay', 'EMI', 'KYC', and 'rupees' naturally.\n"
        "- Core facts: zero percent interest for 3 months, minimum purchase rupees 3000, 100 percent digital KYC in 2 minutes with Aadhaar, first missed payment fee is waived."
    )
    user_msg = (
        f"Customer asked: {customer_text}\n"
        f"Knowledge: {facts_block}\n"
        "Reply as Priya with natural warmth and an interactive closing question:"
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
