#!/usr/bin/env python3
"""
text_demo.py — Pure text-pipeline simulator for Inside Sales Voice Co-Pilot.

Reads sample_call.txt and queries the FastAPI backend running at http://localhost:8000.
"""

import sys
import os
import time
import requests

# Terminal colors (ANSI escape codes)
RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
BOLD = "\033[1m"
RESET = "\033[0m"

BASE_URL = "http://127.0.0.1:8000"
CALL_ID = 2026


def main():
    sample_file = "sample_call.txt"
    if not os.path.exists(sample_file):
        print(f"{RED}Error: {sample_file} not found.{RESET}")
        sys.exit(1)

    print("=" * 80)
    print(f"{BOLD}{BLUE}Inside Sales Co-Pilot Text Simulator{RESET}")
    print("=" * 80)

    # 1. Start Call
    print(f"Connecting to co-pilot server at {BASE_URL}...")
    try:
        start_resp = requests.post(f"{BASE_URL}/call/start", json={"call_id": CALL_ID})
        start_resp.raise_for_status()
    except Exception as e:
        print(f"{RED}Error connecting to server. Is the FastAPI app running?{RESET}")
        print(f"Detail: {e}")
        print(f"Run this first: {BOLD}uvicorn main:app --port 8000{RESET}")
        sys.exit(1)

    consent = start_resp.json().get("consent_script")
    print(f"\n{BOLD}Server Response (Consent Script Required):{RESET}")
    print(f"  {YELLOW}\"{consent}\"{RESET}\n")
    print("-" * 80)

    # Read turns
    with open(sample_file, "r", encoding="utf-8") as f:
        turns = [line.strip() for line in f if line.strip()]

    # 2. Feed turns one by one
    for idx, turn_text in enumerate(turns):
        print(f"\n{BOLD}Turn {idx+1}:{RESET} Customer says:")
        print(f"  \"{turn_text}\"")

        try:
            # Query the turn
            turn_resp = requests.post(
                f"{BASE_URL}/call/turn",
                json={"call_id": CALL_ID, "transcript_text": turn_text}
            )
            turn_resp.raise_for_status()
            data = turn_resp.json()
        except Exception as e:
            print(f"  {RED}Error invoking /call/turn: {e}{RESET}")
            continue

        intent = data.get("intent")
        suggestion = data.get("suggestion")
        comp_flag = data.get("compliance_flag")

        # Color code compliance warning
        if comp_flag:
            comp_str = f"{RED}{BOLD}True (REJECTED FOR AUTO-SPEAK / HOLD){RESET}"
            sugg_str = f"{RED}{suggestion}{RESET}"
        else:
            comp_str = f"{GREEN}False{RESET}"
            sugg_str = f"{GREEN}{suggestion}{RESET}"

        print(f"  {BOLD}Intent          :{RESET} {YELLOW}{intent}{RESET}")
        print(f"  {BOLD}Compliance Hold :{RESET} {comp_str}")
        print(f"  {BOLD}NBA Suggestion  :{RESET} {sugg_str}")
        print("-" * 80)
        time.sleep(1)

    # 3. End Call
    print(f"\nEnding call {CALL_ID}...")
    try:
        end_resp = requests.post(f"{BASE_URL}/call/end", json={"call_id": CALL_ID})
        end_resp.raise_for_status()
        end_data = end_resp.json()
    except Exception as e:
        print(f"{RED}Error ending call: {e}{RESET}")
        sys.exit(1)

    summary = end_data.get("summary")
    passed = end_data.get("self_check_passed")
    corrections = end_data.get("corrections")
    cost = end_data.get("total_cost_usd")

    passed_str = f"{GREEN}PASS{RESET}" if passed else f"{RED}{BOLD}FAIL{RESET}"

    print("=" * 80)
    print(f"{BOLD}{BLUE}Call Session Summary Results{RESET}")
    print("=" * 80)
    print(f"{BOLD}Summary of Conversation :{RESET} {summary}")
    print(f"{BOLD}Facts Self-Check        :{RESET} {passed_str}")
    if corrections:
        print(f"{BOLD}Validation Corrections  :{RESET}")
        for c in corrections:
            print(f"  - {RED}{c}{RESET}")
    print(f"{BOLD}Accumulated Session Cost:{RESET} {GREEN}${cost:.5f} USD{RESET}")
    print("=" * 80)


if __name__ == "__main__":
    main()
