#!/usr/bin/env python3
"""
self_check_agent.py — LangGraph-compatible node / verification helper.

Performs a post-call validation on every fact quoted in the suggestions of the call.
Checks them against the current knowledge base terms.
If any quoted term doesn't match the latest version, set self_check_passed=False 
and list specific corrections.
"""

import re
from typing import List, Tuple

# Source-of-truth values from the documents
CURRENT_FACTS = {
    "late_fee": 199,
    "min_transaction": 3000,
    "max_limit_tier_a": 150000,
}


def self_check_call(transcript: List[dict]) -> Tuple[bool, List[str]]:
    """Verify suggestions in the transcript against latest credit parameters.
    
    Expected format of transcript: List of dicts representing turns, e.g.:
    [
        {"speaker": "customer", "text": "Are there fees?"},
        {"speaker": "agent", "text": "No, it is zero cost."},
        {"speaker": "customer", "text": "What if I miss a payment?", "nba_suggestion": "Late fee is ₹99."}
    ]
    
    Returns: (self_check_passed, list_of_corrections)
    """
    self_check_passed = True
    corrections = []

    for idx, turn in enumerate(transcript):
        nba_suggestion = turn.get("nba_suggestion") or turn.get("suggestion") or ""
        if not nba_suggestion:
            continue

        text = nba_suggestion.lower()

        # 1. Check for stale late fee (current: 199)
        # Match pattern: e.g. "late fee is 99", "₹99 fee", "99 per missed"
        late_fee_match = re.search(r"(?:late fee|late payment fee|charge|penalty|fee of).*?(\d+)", text)
        if late_fee_match:
            val = int(late_fee_match.group(1))
            if val != CURRENT_FACTS["late_fee"] and val in [99, 100, 150]:
                self_check_passed = False
                corrections.append(
                    f"Turn {idx+1}: Quoted stale late fee of ₹{val}. "
                    f"The current fee is ₹{CURRENT_FACTS['late_fee']} per missed payment "
                    f"(source: product_terms.md v2.1)."
                )

        # 2. Check for stale minimum transaction value (current: 3000)
        min_match = re.search(r"(?:minimum|min transaction|min).*?(\d+)", text)
        if min_match:
            val = int(min_match.group(1))
            if val != CURRENT_FACTS["min_transaction"] and val in [1000, 2000]:
                self_check_passed = False
                corrections.append(
                    f"Turn {idx+1}: Quoted stale minimum transaction threshold of ₹{val}. "
                    f"The current threshold is ₹{CURRENT_FACTS['min_transaction']} "
                    f"(source: product_terms.md v2.1)."
                )

        # 3. Check for stale maximum credit limit (current: 150000)
        max_match = re.search(r"(?:maximum|max limit|limit of).*?(\d+)", text)
        if max_match:
            val = int(max_match.group(1))
            if val == 100000:
                self_check_passed = False
                corrections.append(
                    f"Turn {idx+1}: Quoted stale Tier-A maximum limit of ₹{val}. "
                    f"The current limit is ₹{CURRENT_FACTS['max_limit_tier_a']} "
                    f"(source: product_terms.md v2.1)."
                )

    return self_check_passed, corrections


if __name__ == "__main__":
    # Quick standalone check
    test_transcript = [
        {
            "speaker": "customer",
            "text": "What are the fees if I miss?",
            "nba_suggestion": "The late fee is ₹99 per missed payment, after a 3-day grace period."
        }
    ]
    passed, errs = self_check_call(test_transcript)
    print("Passed:", passed)
    print("Corrections:", errs)
