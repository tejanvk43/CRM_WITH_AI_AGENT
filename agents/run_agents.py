#!/usr/bin/env python3
"""
run_agents.py — Verify intent_agent and rag_agent on 3 sample transcript turns.

Pipeline per turn:
    customer turn ──► intent_node ──► rag_node (only for query-like turns)
Then prints intent, sentiment, grounded answer, sources, and the cost log.
"""

import json

from agents.intent_agent import intent_node, cost_log
from agents.rag_agent import rag_node

SAMPLE_TURNS = [
    # 1. Product question, neutral sentiment
    "Hi, I saw your ad — is this EMI really zero interest? What are the fees?",
    # 2. Objection, negative-leaning sentiment
    "Nothing is ever free. There must be some hidden charges. I don't trust "
    "these schemes, and I really don't want to share my documents either.",
    # 3. Ready to convert, positive sentiment
    "Okay, that sounds good to me. Let's do it — send me the signup link. "
    "By the way, what documents do I need for KYC?",
]

SKIP_RAG_FOR_INTENTS = {"small_talk"}


def main():
    print("=" * 90)
    print("FlexiPay Voice Co-Pilot — Agent Verification Run")
    print("=" * 90)

    total_cost = 0.0
    for i, turn in enumerate(SAMPLE_TURNS, 1):
        print(f"\n--- Turn {i}: \"{turn}\"")

        # Intent classification (cheap model)
        intent_out = intent_node({"turn": turn})
        intent, sentiment = intent_out["intent"], intent_out["sentiment"]
        print(f"    intent    : {intent}")
        print(f"    sentiment : {sentiment}")
        print(f"    cost      : ${intent_out['cost_log'][0]['cost_usd']} "
              f"(model_tier={intent_out['cost_log'][0]['model_tier']})")

        # Grounded RAG answer (skip small talk; also skip pure objections
        # with no question — but our sample objections contain questions too)
        if intent not in SKIP_RAG_FOR_INTENTS:
            rag_out = rag_node({"query": turn, "top_k": 3})
            print(f"    answer    : {rag_out['answer']}")
            print(f"    sources   : {json.dumps(rag_out['sources'], indent=6)}")
            print(f"    cost      : ${rag_out['cost_log'][0]['cost_usd']}")

    print("\n" + "=" * 90)
    print("Cost log (all calls):")
    print(json.dumps(cost_log, indent=2))
    total = sum(e["cost_usd"] for e in cost_log)
    print(f"\nTotal cost for {len(SAMPLE_TURNS)} turns: ${total:.4f}  "
          f"(avg ${total/len(SAMPLE_TURNS):.4f}/turn)")
    print("=" * 90)


if __name__ == "__main__":
    main()
