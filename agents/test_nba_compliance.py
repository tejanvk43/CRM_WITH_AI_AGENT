#!/usr/bin/env python3
"""
test_nba_compliance.py — Test script for NBA and Compliance agents.

Runs the pipeline on:
1. One normal product question: "What is the interest rate and processing fees?"
   (Should pass through cleanly with compliance_flag=False).
2. One sensitive question: "Can you guarantee my loan approval?"
   (Must trigger compliance_flag=True and modify suggestion).
"""

import json
from agents.intent_agent import intent_node, cost_log
from agents.rag_agent import rag_node
from agents.nba_agent import nba_node
from agents.compliance_agent import compliance_node


def run_pipeline(turn: str) -> dict:
    # 1. Intent Node
    intent_out = intent_node({"turn": turn})
    intent = intent_out["intent"]
    
    # 2. RAG Node
    rag_out = rag_node({"query": turn, "top_k": 3})
    facts = [rag_out["answer"]]
    
    # 3. NBA Node
    nba_out = nba_node({
        "intent": intent,
        "retrieved_facts": facts,
        "call_history": [{"speaker": "customer", "text": turn}]
    })
    suggestion = nba_out["nba_suggestion"]
    
    # 4. Compliance Node
    compliance_out = compliance_node({
        "nba_suggestion": suggestion,
        "turn": turn
    })
    
    return {
        "turn": turn,
        "intent": intent,
        "answer": rag_out["answer"],
        "nba_suggestion": compliance_out["nba_suggestion"],
        "compliance_flag": compliance_out["compliance_flag"],
        "cost_log": nba_out["cost_log"] + compliance_out["cost_log"]
    }


def main():
    print("=" * 90)
    print("AI Sales Co-Pilot — NBA & Compliance Agent Verification")
    print("=" * 90)
    
    # Reset cost log
    cost_log.clear()
    
    # Test case 1: Normal Product Question
    print("\n--- Test Case 1: Normal Product Question")
    res1 = run_pipeline("What is the interest rate and processing fees?")
    print(f"Customer   : {res1['turn']}")
    print(f"Intent     : {res1['intent']}")
    print(f"NBA Suggest: {res1['nba_suggestion']}")
    print(f"Compliance : {res1['compliance_flag']}")
    assert res1["compliance_flag"] is False, "Error: Normal query should not trigger compliance!"
    print("Result     : PASS")
    
    # Test case 2: Sensitive Approval Guarantee Question
    print("\n--- Test Case 2: Sensitive Approval Guarantee")
    res2 = run_pipeline("Can you guarantee my loan approval?")
    print(f"Customer   : {res2['turn']}")
    print(f"Intent     : {res2['intent']}")
    print(f"NBA Suggest: {res2['nba_suggestion']}")
    print(f"Compliance : {res2['compliance_flag']}")
    assert res2["compliance_flag"] is True, "Error: sensitive guarantee request MUST trigger compliance!"
    assert "human_judgment_required" in res2["nba_suggestion"], "Error: NBA suggestion should carry human judgment warning!"
    print("Result     : PASS")
    
    print("\n" + "=" * 90)
    print("Cumulative session cost log:")
    print(json.dumps(cost_log, indent=2))
    print("=" * 90)


if __name__ == "__main__":
    main()
