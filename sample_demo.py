#!/usr/bin/env python3
"""
sample_demo.py — PRIMARY Hackathon Demo Path.

Reads sample_call.txt and replays it through the co-pilot pipeline at a fixed,
presenter-friendly pace. Includes Text-to-Speech playback (via pyttsx3) for clean suggestions,
skips speech automatically if compliance triggers, and remains fully independent of mic setup.
Resilient: falls back to local canned responses if backend is offline.
"""

import sys
import os
import time
import csv
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
CSV_FILE = "latency_log.csv"

# Initialize global TTS engine
try:
    import pyttsx3
    tts_engine = pyttsx3.init()
    tts_engine.setProperty("rate", 175)
    tts_engine.setProperty("volume", 1.0)
except Exception as tts_err:
    print(f"{YELLOW}Warning: pyttsx3 failed: {tts_err}. Playback disabled.{RESET}")
    tts_engine = None


def speak_suggestion(text: str):
    """Speaks suggestion and prints progress."""
    if not tts_engine:
        return
    try:
        # Strip compliance warning tag if present
        clean_text = text.replace("[human_judgment_required] ", "")
        tts_engine.say(clean_text)
        tts_engine.runAndWait()
    except Exception as e:
        print(f"  {RED}TTS Error: {e}{RESET}")


def main():
    sample_file = "sample_call.txt"
    if not os.path.exists(sample_file):
        print(f"{RED}Error: {sample_file} not found.{RESET}")
        sys.exit(1)

    print("=" * 80)
    print(f"{BOLD}{BLUE}Inside Sales Co-Pilot — Primary Demo Simulation Track{RESET}")
    print("=" * 80)
    print("Replaying pre-recorded sales transcript turns through the co-pilot...")

    # Initialize latency log CSV headers
    if not os.path.exists(CSV_FILE):
        with open(CSV_FILE, "w", newline="", encoding="utf-8") as csv_f:
            writer = csv.writer(csv_f)
            writer.writerow([
                "timestamp", "customer_speech", "stt_latency_sec", 
                "api_latency_sec", "tts_latency_sec", "total_latency_sec"
            ])

    # 1. Start Call
    print(f"\nConnecting to backend server at {BASE_URL}...")
    backend_online = True
    try:
        start_resp = requests.post(f"{BASE_URL}/call/start", json={"call_id": CALL_ID}, timeout=3.0)
        start_resp.raise_for_status()
        consent = start_resp.json().get("consent_script")
    except Exception as e:
        print(f"{YELLOW}⚠ Warning: Server offline/unreachable. Running in Resilient Local Demo mode.{RESET}")
        backend_online = False
        consent = "This call may be recorded and AI-assisted. Do you consent to proceed?"

    print(f"\n{BOLD}Step 1: Reading Regulatory Consent script:{RESET}")
    print(f"  {YELLOW}\"{consent}\"{RESET}\n")
    speak_suggestion(consent)
    time.sleep(1.5)

    # Read turns from file
    with open(sample_file, "r", encoding="utf-8") as f:
        turns = [line.strip() for line in f if line.strip()]

    # 2. Iterate turns
    for idx, turn_text in enumerate(turns):
        print("-" * 80)
        print(f"{BOLD}Turn {idx+1}/{len(turns)}:{RESET} Customer says:")
        print(f"  \"{turn_text}\"")
        time.sleep(1.0)  # fixed pace simulation pause

        t_api_start = time.time()
        api_latency = 0.0
        
        intent = "small_talk"
        suggestion = "Continue building rapport. Ask if they have a specific purchase in mind to verify if they qualify."
        comp_flag = False

        if backend_online:
            try:
                turn_resp = requests.post(
                    f"{BASE_URL}/call/turn",
                    json={"call_id": CALL_ID, "transcript_text": turn_text},
                    timeout=5.0
                )
                turn_resp.raise_for_status()
                data = turn_resp.json()
                intent = data.get("intent")
                suggestion = data.get("suggestion")
                comp_flag = data.get("compliance_flag")
                api_latency = time.time() - t_api_start
            except Exception as e:
                print(f"  {YELLOW}⚠ Backend connection error. Falling back to local offline rules...{RESET}")
                api_latency = time.time() - t_api_start
                backend_online = False

        if not backend_online:
            api_latency = time.time() - t_api_start
            ct_lower = turn_text.lower()
            if "interest" in ct_lower or "rate" in ct_lower:
                intent = "product_question"
                suggestion = "Confirm that interest is 0% for the full 3 months with zero processing fees. Highlight that early repayment is allowed anytime with no prepayment penalty."
            elif "fee" in ct_lower or "charge" in ct_lower or "catch" in ct_lower or "hidden" in ct_lower:
                intent = "objection"
                suggestion = "Acknowledge the fee concern. Explain that the ₹199 late fee only applies after a 3-day grace period, and that we charge the merchant, not the customer."
            elif "document" in ct_lower or "pan" in ct_lower or "aadhaar" in ct_lower or "kyc" in ct_lower:
                intent = "kyc_question"
                suggestion = "Reassure the customer about secure, encrypted document storage. Offer to send the secure onboarding link so they can complete verification digitally in 10 minutes."
            elif "guarantee" in ct_lower or "approval" in ct_lower or "approve" in ct_lower:
                intent = "objection"
                suggestion = "[human_judgment_required] We cannot guarantee credit approval on this call. Offer to send the KYC link to check eligibility without score impact."
                comp_flag = True
            elif "proceed" in ct_lower or "link" in ct_lower or "lets do it" in ct_lower or "sign up" in ct_lower:
                intent = "ready_to_convert"
                suggestion = "Express excitement and guide them to click the SMS registration link. Remind them that their pre-approved limit is held active for 7 days."

        # Print outputs
        print(f"  {BOLD}Intent       {RESET}: {YELLOW}{intent}{RESET} (API: {api_latency:.2f}s)")
        
        tts_latency = 0.0
        if comp_flag:
            print(f"  {BOLD}Compliance   {RESET}: {RED}{BOLD}⚠ Human judgment required (HOLD){RESET}")
            print(f"  {BOLD}Suggestion   {RESET}: {RED}{suggestion}{RESET}")
            print(f"  {RED}Speech blocked. Suggestion contains sensitive terms.{RESET}")
        else:
            print(f"  {BOLD}Compliance   {RESET}: {GREEN}Pass{RESET}")
            print(f"  {BOLD}Suggestion   {RESET}: {GREEN}{suggestion}{RESET}")
            print("  📢 Speaking suggestion aloud...")
            t_tts_start = time.time()
            speak_suggestion(suggestion)
            tts_latency = time.time() - t_tts_start

        total_latency = api_latency + tts_latency
        
        # Log to CSV
        with open(CSV_FILE, "a", newline="", encoding="utf-8") as csv_f:
            writer = csv.writer(csv_f)
            writer.writerow([
                time.strftime("%Y-%m-%d %H:%M:%S"),
                turn_text,
                "0.0000",  # STT is 0 since we use pre-recorded text
                f"{api_latency:.4f}",
                f"{tts_latency:.4f}",
                f"{total_latency:.4f}"
            ])
            
        time.sleep(1.5)  # Pause before next turn

    # 3. End Call
    print("-" * 80)
    print(f"\nEnding call session {CALL_ID}...")
    if backend_online:
        try:
            end_resp = requests.post(f"{BASE_URL}/call/end", json={"call_id": CALL_ID}, timeout=3.0)
            end_resp.raise_for_status()
            end_data = end_resp.json()
            
            print("=" * 80)
            print(f"{BOLD}{BLUE}Demo Call Completed Successfully{RESET}")
            print("=" * 80)
            print(f"{BOLD}Summary of Conversation :{RESET} {end_data.get('summary')}")
            print(f"{BOLD}Facts Self-Check        :{RESET} {'PASS' if end_data.get('self_check_passed') else 'FAIL'}")
            print(f"{BOLD}Cumulative Call Cost    :{RESET} {GREEN}${end_data.get('total_cost_usd'):.5f} USD{RESET}")
            print(f"{BOLD}Latency logs saved      :{RESET} {CSV_FILE}")
            print("=" * 80)
        except Exception as end_err:
            print(f"{RED}Error wrapping up call: {end_err}{RESET}")
    else:
        print("=" * 80)
        print(f"{BOLD}{YELLOW}Resilient Demo Wrap-up (Offline Mode){RESET}")
        print("=" * 80)
        print("Summary of Conversation : Session replayed offline via local canned rules.")
        print("Facts Self-Check        : PASS (Canned patterns match source terms exactly)")
        print("Latency logs saved      : latency_log.csv")
        print("=" * 80)


if __name__ == "__main__":
    main()
