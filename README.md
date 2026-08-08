# FlexiPay AI Voice CRM — Complete Architecture & Implementation Guide

> A production-grade, AI-powered inside-sales voice co-pilot built for the Indian market.
> Handles inbound customer calls, speaks in English and Telugu, qualifies leads, performs KYC checks, sends notifications, and escalates to a human manager — all within a 1–2 second latency budget.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Technology Stack & Exact Models](#3-technology-stack--exact-models)
4. [System Components (File-by-File)](#4-system-components-file-by-file)
5. [LangGraph Pipeline — Detailed State Machine](#5-langgraph-pipeline--detailed-state-machine)
6. [Voice Pipeline — Latency Architecture](#6-voice-pipeline--latency-architecture)
7. [Database Schema (Supabase PostgreSQL)](#7-database-schema-supabase-postgresql)
8. [Notification System (SMS & Email)](#8-notification-system-sms--email)
9. [Human Transfer & Escalation Bridge](#9-human-transfer--escalation-bridge)
10. [Silence Handling & Call Persistence](#10-silence-handling--call-persistence)
11. [TTS Text Normalisation](#12-tts-text-normalisation)
12. [Startup Warmup & Latency Optimisation](#13-startup-warmup--latency-optimisation)
13. [Security & Compliance](#14-security--compliance)
14. [Environment Variables Reference](#15-environment-variables-reference)
15. [Running the Project Locally](#16-running-the-project-locally)
16. [API Endpoint Reference](#18-api-endpoint-reference)
17. [Conversation Flow Walkthrough](#19-conversation-flow-walkthrough)
18. [Cost Model](#20-cost-model)

---

## 1. Project Overview

FlexiPay AI CRM is an **autonomous telephony AI agent** that acts as an inside-sales co-pilot for a fintech lending product called *FlexiPay*. When a customer calls the Twilio number:

- The AI greets the caller, identifies them via phone number, and begins a natural conversation.
- It classifies the customer''s **intent** (product question, KYC, objection, ready-to-convert, small talk).
- It retrieves **grounded facts** from a ChromaDB vector store (no hallucinations).
- It generates a **warm, human-sounding response** via Sarvam AI''s 105B parameter LLM.
- It speaks back using **Amazon Polly Kajal-Neural** (Indian English) for sub-second voice delivery.
- It can **send SMS and Email** (Terms & Conditions, KYC checklist, KYC status) in real time.
- It can **transfer the call to a human manager** at any point during the conversation.
- The call **never hangs up** unless the customer explicitly says goodbye or goes completely silent for 5+ cycles.
- Every turn is **logged to Supabase** in real time for CRM review.

---

## 2. High-Level Architecture

```
Customer Phone
     |  PSTN Call
     v
Twilio Voice Platform
  - Receives call, sends HTTP webhook
  - Renders TwiML (Gather, Say, Dial, Redirect)
  - Polly.Kajal-Neural neural TTS for instant voice
     |  POST webhook
     v
FastAPI Application (main.py + twilio_router.py)
  /twilio/voice  --> Lead lookup/create --> Greet caller
  /twilio/gather --> Speech dispatch
       |
       |-- Human Transfer  (Dial TwiML)
       |-- KYC Status      (DB query + SMS + Email)
       |-- Terms & Conditions (SMS + Email)
       |-- KYC Requirements  (SMS + Email)
       |-- AI Pipeline     (LangGraph StateGraph)
              |
              v
         intent_node --> rag_node --> nba_node --> compliance_node
              |
              +--> (small_talk shortcut) --> nba_node
              |
         Response via Polly.Kajal-Neural
         DB write (async background)
         Sarvam bulbul:v3 audio cached in background
     |
     v
Supabase PostgreSQL (tables: leads, calls, call_transcripts, kyc_applications)
     |
     v
Notifications: Twilio SMS + Gmail SMTP
```

---

## 3. Technology Stack & Exact Models

| Layer | Technology | Exact Model / Version |
|---|---|---|
| LLM (Sales Reasoning) | Sarvam AI Chat API | `sarvam-105b-conversations` |
| TTS Live Call (Primary) | Amazon Polly via Twilio | `Polly.Kajal-Neural` (en-IN) / `Polly.Aditi` (te-IN) |
| TTS CRM Cache (Background) | Sarvam AI TTS API | `bulbul:v3` (speakers: `tanya` en-IN, `meera` te-IN) |
| Embeddings (RAG) | sentence-transformers | `all-MiniLM-L6-v2` |
| Vector Database | ChromaDB | `PersistentClient` on-disk |
| Intent Classifier | Rule-based (zero-cost) | Keyword scoring engine |
| Compliance Checker | Rule-based (zero-cost) | Regex + keyword matching |
| STT (Speech-to-Text) | Twilio built-in | Gather `input=speech`, `speechTimeout=auto` |
| Workflow Engine | LangGraph | `StateGraph` from `langgraph.graph` |
| Web Framework | FastAPI | >= 0.110.0 |
| Database | Supabase PostgreSQL | `psycopg2` with `RealDictCursor` |
| Telephony | Twilio Voice | REST API + TwiML webhooks |
| SMS | Twilio Messaging | REST API via `twilio.rest.Client` |
| Email | Gmail SMTP | `smtplib` with STARTTLS, App Password auth |
| HTTP Client | httpx | Async + sync for all API calls |
| Containerisation | Docker | `python:3.9-slim` base image |

### Why `sarvam-105b-conversations`?

Sarvam AI''s 105B-parameter model is specifically trained on Indian languages and financial dialogue patterns. It understands code-switching (English + Telugu in the same sentence), financial jargon (EMI, KYC, CIBIL), and produces short, warm, conversational responses suited for telephone interactions.

### Why `Polly.Kajal-Neural` for live calls instead of `bulbul:v3`?

| Factor | Polly.Kajal-Neural | bulbul:v3 |
|---|---|---|
| Latency | ~0.05s (Twilio telecom edge) | 3-7s (Sarvam API round-trip) |
| Language | Indian English (en-IN) | Indian English + Telugu |
| Quality | Neural, warm, expressive | High-fidelity, natural Indic |
| Usage | Primary live voice | Async background CRM cache |

The dual-TTS approach gives instant call response from Polly, and high-quality audio stored in Supabase for CRM playback via bulbul:v3.

---

## 4. System Components (File-by-File)

### 4.1 `main.py` — FastAPI Server & LangGraph Workflow

**Role:** Root application entry point. Builds the LangGraph StateGraph, exposes REST API endpoints for call management, and mounts the Twilio webhook router.

#### AgentState (TypedDict)

```python
class AgentState(TypedDict):
    transcript_turn: str       # Raw customer speech text for this turn
    call_id: int               # Unique session identifier (from DB)
    intent: str                # Classified intent label
    sentiment: str             # Classified sentiment label
    retrieved_facts: List[str] # Top-3 grounded facts from ChromaDB
    suggestion: str            # Final NBA suggestion to speak
    compliance_flag: bool      # True if human review required
    cost_log: Annotated[List[dict], operator.add]  # Accumulated per-agent costs
```

The `Annotated[List[dict], operator.add]` pattern tells LangGraph to **concatenate** cost log lists across nodes rather than overwrite.

#### Graph Routing

```
customer_speech
      |
      v
  intent_node
      |
      |-- intent == "small_talk" --------> nba_node
      |                                        |
      +-- any other intent --> rag_node --> nba_node --> compliance_node --> END
```

**Key insight:** Small talk skips the RAG node entirely, saving ~1-2 seconds by not querying ChromaDB for non-factual exchanges.

#### REST Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness probe |
| `/call/start` | POST | Initialise call session, return consent script |
| `/call/turn` | POST | Run one LangGraph turn, return intent + suggestion + cost |
| `/call/end` | POST | Post-call self-check, return audit summary + total cost |

#### Startup Warmup

On server startup, three cold-start bottlenecks are pre-warmed:
1. `SentenceTransformer` — loads `all-MiniLM-L6-v2` model weights into RAM.
2. ChromaDB — opens the persistent collection and runs a dummy query.
3. Sarvam LLM — sends a warmup HTTP request to pre-establish the TCP connection pool.

---

### 4.2 `twilio_router.py` — Voice Webhook Engine

**Role:** Core real-time call handler. Contains all TwiML webhook routes, the TTS pipeline, database helpers, and notification dispatchers.

#### Database Helper Functions

| Function | Purpose |
|---|---|
| `get_db_connection()` | Parses DATABASE_URL safely (handles @ in passwords) |
| `get_or_create_lead_by_phone(phone)` | Fuzzy phone match; auto-creates record for unknown callers |
| `create_call_record(lead_id)` | Inserts a new calls row, returns call_id |
| `persist_transcript_turn(...)` | Writes one conversation turn to call_transcripts |
| `update_call_cost(call_id, add_cost)` | Accumulates running cost in calls.totalCost |
| `get_lead_kyc_status(phone)` | Queries kyc_applications and leads for live KYC status |

#### TTS Pipeline: `speak_text(response, text, language)`

```
Input text
    |
    v
normalize_text_for_tts()   <-- Expands rupee symbol, P.A.Y->pay, 0%->zero percent
    |
    v
USE_FAST_VOICE == True?
    |
    |-- YES --> response.say(text, voice="Polly.Kajal-Neural")  <-- Instant
    |           asyncio.create_task(generate_sarvam_audio())    <-- Background cache
    |
    +-- NO  --> await generate_sarvam_audio()                   <-- Full Sarvam TTS
                response.play(audio_url)
```

#### `/twilio/voice` — Call Entry Webhook

1. Reads From phone from Twilio form data.
2. Calls `get_or_create_lead_by_phone()` — identifies or creates the lead.
3. Calls `create_call_record()` — creates a DB call session.
4. Registers the session in ACTIVE_CALLS in-memory dictionary.
5. Builds a Gather with `input=speech` and `action=/twilio/gather?call_id=...`.
6. Speaks the consent greeting.
7. Appends `response.redirect(gather_url)` to re-trigger if user stays silent.

#### `/twilio/gather` — Speech Processing (Priority Order)

| Priority | Trigger | Handler |
|---|---|---|
| 1 | Human transfer keywords | Speak transfer msg -> Dial to manager |
| 2 | KYC status keywords | DB lookup -> Speak status -> SMS + Email |
| 3 | Terms & Conditions keywords | Speak summary -> SMS + Email |
| 4 | KYC requirements keywords | Speak checklist -> SMS + Email |
| 5 | Everything else | Full LangGraph AI pipeline |

AI pipeline timeout guard: `asyncio.wait_for(..., timeout=13.0)` — if AI exceeds 13s, fallback Say keeps call alive.

---

### 4.3 `agents/intent_agent.py` — Intent & Sentiment Classifier

**Model:** Zero-cost local keyword scoring engine (~0ms latency, no API call).

**Intents classified:**

| Intent | Trigger keywords |
|---|---|
| `product_question` | interest, rate, fee, EMI, limit, installment, grace |
| `objection` | not interested, hidden, scam, catch, think about it |
| `kyc_question` | documents, Aadhaar, PAN, KYC, upload, onboarding |
| `ready_to_convert` | sign up, activate, let''s do it, I''m in, send me the link |
| `small_talk` | hello, hi, good morning, bye, thank you |

**Sentiment:** positive / neutral / negative via word-score delta.

**Self-healing parser:** `_parse_intent_output()` uses regex fallback and defaults to `small_talk`/`neutral` on any failure — never crashes the pipeline.

---

### 4.4 `agents/rag_agent.py` — RAG Knowledge Retrieval

**Embedding model:** `sentence-transformers/all-MiniLM-L6-v2`
**Vector store:** ChromaDB PersistentClient at `scripts/chroma_db/`
**Collection:** `flexipay_knowledge`

#### Two-Layer Grounding

**Layer 1 — Vector retrieval:**
```python
results = collection.query(query_texts=[query], n_results=3)
```

**Layer 2 — Sentence scoring (no LLM needed):**
Instead of calling Sarvam (which added 4 seconds), the RAG node:
1. Splits each retrieved chunk into sentences.
2. Scores each sentence by keyword overlap with the query.
3. Returns the top-3 highest-scoring sentences as `retrieved_facts`.

Zero hallucination — every fact is verbatim from the knowledge base.

#### `_verify_grounding()` — Accuracy Guardrail

Drops any sentence whose keywords are not present in at least one retrieved chunk. Requires ≥3 content words AND ≥70% overlap. This is the second anti-hallucination layer.

**Cost:** $0.00 — pure vector search + sentence scoring, no LLM API call.

---

### 4.5 `agents/nba_agent.py` — Next-Best-Action Recommender

**Model:** `sarvam-105b-conversations` via `https://api.sarvam.ai/v1/chat/completions`

**Parameters:**
```python
{
    "model": "sarvam-105b-conversations",
    "max_tokens": 45,       # Limits response length for speed
    "temperature": 0.2,     # Low temp = consistent, factual responses
    "timeout": 5.0          # Hard timeout for live call budget
}
```

**Persona "Priya":**
- Warm, enthusiastic, never robotic.
- Opens with a natural conversational starter (Sure thing!, Great question!).
- Ends with an interactive question to keep conversation flowing.
- Max 25 words per response.
- Never spells out words character by character.

**Fallback:** If Sarvam API is unavailable, `_fallback_reasoning_llm()` provides category-appropriate keyword responses — call continues uninterrupted.

**Cost:** $0.01 per NBA decision.

---

### 4.6 `agents/compliance_agent.py` — Compliance Gate

**Model:** Rule-based, zero-cost, zero-latency.

Scans NBA suggestion + customer question for regulated terms requiring human oversight.

**Sensitive triggers:**
- "guarantee approval" / "guarantee my loan"
- "interest rate change" / "waive interest"
- "guarantee my limit" / "credit limit" modification promises

**If triggered:** Prepends `[human_judgment_required]` to suggestion. The twilio_router detects this prefix and replaces with a safe compliance message before speaking to customer.

---

### 4.7 `agents/self_check_agent.py` — Post-Call Fact Auditor

**Model:** Rule-based regex matching against CURRENT_FACTS dictionary.

Run at call end to detect stale financial facts quoted during the call.

| Fact | Current Value | Stale Values Flagged |
|---|---|---|
| Late fee | Rs.199 | Rs.99, Rs.100, Rs.150 |
| Minimum transaction | Rs.3,000 | Rs.1,000, Rs.2,000 |
| Tier-A maximum limit | Rs.1,50,000 | Rs.1,00,000 |

Returns: `(self_check_passed: bool, corrections: List[str])` with source document + version citations.

---

## 5. LangGraph Pipeline — Detailed State Machine

LangGraph builds a directed graph where each node is a pure Python function that takes the current AgentState and returns a partial state update.

### State Flow Example — Product Question

```
Input: "Is there any interest on this?"

Step 1 intent_node:
  "interest" keyword -> product_question, neutral
  update: { intent: "product_question", sentiment: "neutral" }

Step 2 route_intent:
  intent != "small_talk" -> route to rag

Step 3 rag_node:
  ChromaDB query: "Is there any interest on this?"
  Top chunk: "0% interest for 3 equal monthly installments..."
  update: { retrieved_facts: ["0% interest for 3 months..."] }

Step 4 nba_node (Sarvam 105B):
  "Great question! FlexiPay gives you zero percent interest for 3 months
   with no processing fees. Would you like to sign up today?"
  update: { suggestion: "...", cost_log: [{cost_usd: 0.01}] }

Step 5 compliance_node:
  No sensitive keywords. compliance_flag: False.

Output -> spoken via Polly.Kajal-Neural in < 1.5 seconds
```

### State Flow Example — Small Talk

```
Input: "Hello, how are you?"

Step 1 intent_node:
  "hello" keyword -> small_talk, positive
  update: { intent: "small_talk" }

Step 2 route_intent:
  intent == "small_talk" -> SKIP rag_node, go directly to nba

Step 3 nba_node:
  "Hello! I''m Priya from FlexiPay. How can I help you today?"

Step 4 compliance_node: no flags.

Output -> spoken (RAG saved ~1-2 seconds latency)
```

---

## 6. Voice Pipeline — Latency Architecture

End-to-end latency goal: **1.0 – 1.5 seconds** from customer speech end to AI voice start.

### Per-Turn Latency Breakdown

| Stage | Duration | Notes |
|---|---|---|
| Twilio STT | 0ms | Twilio handles before webhook fires |
| HTTP POST to /twilio/gather | ~50ms | ngrok/network |
| intent_node (keyword scoring) | ~2ms | Zero API call |
| rag_node (ChromaDB query) | ~80-150ms | Cached embeddings in RAM |
| nba_node (Sarvam 105B, max_tokens=45) | ~500-800ms | Primary latency source |
| compliance_node (rule-based) | ~1ms | Zero API call |
| speak_text — Polly.Kajal-Neural | ~50ms | Twilio edge renders instantly |
| DB write (async background) | 0ms | Non-blocking asyncio.create_task |
| **Total** | **~700-1100ms** | Well within 1-2s target |

### Key Optimisations

1. **Polly.Kajal-Neural** instead of bulbul:v3 for live calls — eliminates 3-7s on critical path.
2. **RAG without LLM call** — sentence scoring replaces 4s Sarvam call in RAG node.
3. **max_tokens: 45** — caps generation, cuts time by ~60%.
4. **temperature: 0.2** — model reaches first plausible token faster.
5. **Startup warmup** — pre-loads model, ChromaDB, and Sarvam TCP pool.
6. **Small talk shortcut** — skips RAG for non-factual speech.
7. **Async DB writes** — all DB writes via asyncio.create_task with zero impact on response.

---

## 7. Database Schema (Supabase PostgreSQL)

### `leads` table

| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment lead ID |
| name | text | Full name |
| phone | text | Phone number (any format) |
| email | text | Email address |
| status | text | lead / prospect / converted |
| creditScore | integer | CIBIL or synthetic score |
| approvedLimit | integer | Pre-approved credit limit in Rs |
| notes | text | Free-form CRM notes |

### `calls` table

| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment call session ID |
| leadId | integer FK | Links to leads.id |
| status | text | active / completed / failed |
| totalCost | numeric | Accumulated AI inference cost in USD |
| recording_url | text | Twilio dual-channel MP3 recording URL |

### `call_transcripts` table

| Column | Type | Description |
|---|---|---|
| id | serial PK | Auto-increment turn ID |
| callId | integer FK | Links to calls.id |
| speaker | text | customer or agent |
| text | text | Raw speech or AI response text |
| intent | text | Classified intent label |
| sentiment | text | Classified sentiment label |
| assistantResponse | text | AI suggestion generated |
| costUsd | numeric | Per-turn AI cost |
| audioUrl | text | Sarvam TTS MP3 or Twilio recording URL |

### `kyc_applications` table

| Column | Type | Description |
|---|---|---|
| id | serial PK | Application ID |
| leadId | integer FK | Links to leads.id |
| fullName | text | KYC full name |
| phone | text | Applicant phone |
| status | text | pending / approved / verified / rejected |
| approvedLimit | integer | Approved credit limit |
| rejectionReason | text | Reason if rejected |

### Phone Number Matching Algorithm

All phone lookups use a fuzzy match that strips non-digits and checks if one number ends with the other:
```python
clean_phone = "".join(c for c in phone if c.isdigit())
if clean_phone.endswith(lead_phone_clean) or lead_phone_clean.endswith(clean_phone):
    return lead  # Match!
```
This handles +91XXXXXXXXXX vs XXXXXXXXXX variations without failing.

---

## 8. Notification System (SMS & Email)

### SMS via Twilio Messaging API

| Function | Trigger | Content |
|---|---|---|
| `send_terms_sms()` | "send terms", "T&C" | T&C: 0% interest, Rs.3000 min, zero fees, Rs.199 late fee |
| `send_kyc_requirements_sms()` | "what documents", "KYC requirement" | KYC: Aadhaar, PAN, bank account + onboarding link |
| `send_kyc_status_sms()` | "check my KYC", "KYC status" | Live status: Approved/Pending/Rejected + action link |
| `send_kyc_sms()` | intent=ready_to_convert or kyc_question | KYC onboarding link (sent once per call) |

### Email via Gmail SMTP

All SMS functions also send a parallel multipart email (plain text + HTML) when the lead has an email address on record.

```
SMTP Server: <configured smtp host>
Port: 587 (STARTTLS)
Auth: Gmail App Password (16-character)
Format: Multipart HTML + plain text
```

### One-Send Guard

The `link_sent` flag in `ACTIVE_CALLS[call_id]` ensures the KYC onboarding link is only SMS-dispatched **once per call session**, preventing duplicate messages.

---

## 9. Human Transfer & Escalation Bridge

When the customer uses any transfer keyword ("talk to manager", "connect to human", "transfer", "Teja"), the system:

1. Speaks: "Certainly! I am transferring you directly to our sales manager right now. Please stay on the line."
2. Executes a Twilio `<Dial>` verb:
```python
dial = response.dial(
    caller_id=TWILIO_PHONE_NUMBER,  # Must be registered Twilio number
    timeout=30,
    action=fallback_url
)
dial.number(MANAGER_PHONE)  # <configured manager phone>
```

**Why caller_id must be the Twilio number:** Indian telecom carriers (BSNL, Airtel, Jio) reject transfers where the caller ID is not a verified, registered number. Using any other number causes call failure. This was a critical bug fix.

**Fallback:** If manager does not answer (busy/no-answer), the customer is returned to the AI agent via `/twilio/transfer-fallback`.

### Outbound Human Bridge: `POST /twilio/call/outbound`

The CRM dashboard can trigger proactive human-to-human calls:
1. Twilio calls the sales manager first.
2. When manager picks up, Twilio bridges to the customer via `/twilio/voice-direct-bridge`.
3. Call is dual-channel recorded.
4. Recording URL saved to `calls.recording_url` via `/twilio/recording-callback`.

---

## 10. Silence Handling & Call Persistence

The system never hangs up on a silent caller. Progressive re-engagement strategy:

| Silence Count | Agent Response |
|---|---|
| 1 | "I''m still here. How can I help you with FlexiPay today?" |
| 2 | "Are you still on the line? Feel free to ask about our zero percent interest credit or KYC." |
| 3 | "Take your time. I am here whenever you are ready." |
| 4 | "I haven''t heard from you in a moment. Let me know if you need any assistance." |
| 5+ | "Thank you for contacting FlexiPay. Have a great day, goodbye." -> Hangup |

Call terminates ONLY if:
- Customer says an explicit goodbye phrase (bye, goodbye, end call, hang up, thank you bye).
- Silence count exceeds 5 retries.


---

## 11. TTS Text Normalisation

The `normalize_text_for_tts()` function prevents the voice engine from spelling symbols or characters literally.

### Transformations Applied

| Input | Output | Reason |
|---|---|---|
| Rs.3000 | rupees 3000 | TTS reads "Rs" as individual letters |
| P.A.Y | pay | Stops letter-by-letter spelling |
| p, a, y | pay | Comma-separated spelling pattern |
| 0% | zero percent | TTS reads % as "percent sign" |
| 3% | three percent | Same issue |
| **bold** | bold | Markdown formatting stripped |

The regex `\b([a-zA-Z])([,.\-][,.\- ]?[a-zA-Z]){2,}\b` catches any letter-by-letter pattern separated by commas, periods, or hyphens.

---

## 12. Startup Warmup & Latency Optimisation

```python
@app.on_event("startup")
async def startup_warmup():
    col = await asyncio.to_thread(_get_collection)
    await asyncio.to_thread(col.query, query_texts=["warmup query"], n_results=1)
    await asyncio.to_thread(call_reasoning_llm, "Warmup prompt", "Hello")
```

Before warmup: First call turn takes 8-12 seconds (cold model load).
After warmup: Every turn takes 0.7-1.5 seconds (everything pre-loaded in RAM).

---

## 13. Security & Compliance

### Data Privacy
- Consent collected at call start per Digital Personal Data Protection Act (DPDP) 2023.
- Consent: "This call may be recorded and AI-assisted... processed under DPDP Act 2023 and stored in India."

### Credential Security
- Zero hardcoded credentials in source code.
- All secrets loaded via `os.environ.get()` from `.env`.
- `.env` listed in `.gitignore`.
- Gmail uses App Password for SMTP auth (not main account password).

### Compliance Agent
- Blocks any AI suggestion making loan approval guarantees or interest rate modification promises.
- Flags prepend `[human_judgment_required]` so the Twilio router never speaks flagged content.

### Indian Telecom Compliance
- Caller ID on all outbound/transfer calls is always the registered Twilio number.
- All call recordings stored with audit trails in Supabase.

---

## 14. Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| TWILIO_ACCOUNT_SID | Yes | Twilio Account SID (AC...) |
| TWILIO_AUTH_TOKEN | Yes | Twilio Auth Token |
| TWILIO_PHONE_NUMBER | Yes | Registered Twilio number ( |
| SARVAM_API_KEY | Yes | Sarvam AI API subscription key (sk_...) |
| DATABASE_URL | Yes | Supabase PostgreSQL connection string |
| NGROK_URL | Yes | Public base URL (ngrok in dev, domain in prod) |
| SMTP_HOST | Yes | SMTP hostname (e.g., smtp.gmail.com) |
| SMTP_PORT | Yes | SMTP port (587 for STARTTLS) |
| SMTP_USER | Yes | SMTP login email |
| SMTP_PASSWORD | Yes | Gmail App Password (16 characters) |
| SMTP_FROM | Yes | Sender email address |
| ADMIN_EMAIL | Optional | Fallback email for auto-created leads |
| MANAGER_PHONE | Yes | Sales manager phone for human transfer, configured through MANAGER_PHONE |
| USE_FAST_VOICE | Optional | true (default) = Polly, false = Sarvam TTS |

---

## 15. Running the Project Locally

### Prerequisites

- Python 3.9+
- Twilio account with Voice-enabled phone number
- Sarvam AI API key
- Supabase project with database schema applied
- ngrok for local webhook tunneling

### Setup

```bash
# Clone and enter project
git clone <repo-url>
cd CRM_KL

# Create virtual environment (Windows)
python -m venv venv
venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt
pip install psycopg2-binary langgraph twilio python-dotenv

# Configure environment
copy .env.example .env
# Edit .env with your credentials

# Ingest knowledge base into ChromaDB
python scripts/ingest.py

# Start ngrok tunnel
ngrok http 8000

# Set NGROK_URL in .env to the HTTPS ngrok URL

# Start the server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Configure Twilio Webhooks

In Twilio Console -> Phone Numbers -> Your Number:
- Voice webhook (POST): `https://your-ngrok-url.ngrok.io/twilio/voice`
- Status callback (POST): `https://your-ngrok-url.ngrok.io/twilio/status`

---

## 16. API Endpoint Reference

### Core REST (main.py)

| Endpoint | Method | Request Body | Response |
|---|---|---|---|
| /health | GET | - | {"status": "ok"} |
| /call/start | POST | {"call_id": int} | {"consent_script": str} |
| /call/turn | POST | {"call_id": int, "transcript_text": str} | {intent, sentiment, suggestion, retrieved_facts, compliance_flag, cost_usd} |
| /call/end | POST | {"call_id": int} | {summary, self_check_passed, corrections, total_cost_usd} |

### Twilio Webhooks (mounted at /twilio/)

| Endpoint | Method | Caller | Purpose |
|---|---|---|---|
| /twilio/voice | POST | Twilio | Inbound call entry point |
| /twilio/gather | POST | Twilio | Per-turn speech processing |
| /twilio/status | POST | Twilio | Call end status callback |
| /twilio/recording-callback | POST | Twilio | Recording URL storage |
| /twilio/call/outbound | POST | CRM | Trigger human-to-human outbound call |
| /twilio/voice-direct-bridge | POST | Twilio | Human bridge TwiML |
| /twilio/transfer-fallback | POST | Twilio | Transfer busy/no-answer fallback |
| /twilio/audio/{filename} | GET | Twilio | Serve Sarvam TTS audio file |
| /twilio/kyc/onboarding | GET | Browser | KYC onboarding page |
| /twilio/notify/terms | POST | CRM | Trigger T&C SMS+Email |
| /twilio/notify/kyc-requirements | POST | CRM | Trigger KYC requirements SMS+Email |
| /twilio/notify/kyc-status | POST | CRM | Trigger KYC status SMS+Email |

---

## 17. Conversation Flow Walkthrough

```
Customer calls 
    |
    v
Twilio fires POST /twilio/voice
    |
    v
AI: "Welcome to FlexiPay. This call is AI-assisted and recorded.
     How can I help you today?"
    |
    v  (customer speaks)
    |
    v
Twilio fires POST /twilio/gather?call_id=42

  -- "Talk to manager"  --> Transfer bridge --> Dial <configured manager phone>
  -- "Check my KYC"    --> DB lookup -> speak status -> SMS + Email
  -- "Send terms"      --> Speak summary -> SMS + Email
  -- "What documents"  --> Speak checklist -> SMS + Email
  -- "What is the interest rate?"
          |
          v
     LangGraph Pipeline:
       intent_node: product_question / neutral
       rag_node: "0% interest for 3 equal monthly installments..."
       nba_node (Sarvam 105B):
         "Great question! FlexiPay gives you zero percent interest for 3
          months with no fees. Want to sign up today?"
       compliance_node: no flags
          |
          v
     Polly.Kajal-Neural speaks response (total < 1.5s)
     DB write (async background)
     Sarvam bulbul:v3 audio cached (async background)
          |
          v
     New <Gather> appended -> call continues

  -- "Bye"  --> "Thank you for speaking with FlexiPay. Have a great day!" -> Hangup
```

---

## 18. Cost Model

| Agent | Model | Cost per Turn |
|---|---|---|
| Intent Classifier | Rule-based | $0.0002 (tracking only, no API) |
| RAG Retrieval | ChromaDB + sentence scoring | $0.0000 (zero API cost) |
| NBA Agent | Sarvam 105B | $0.0100 |
| Compliance Checker | Rule-based | $0.0002 (tracking only) |
| **Total per AI turn** | | **~$0.011** |

- Twilio SMS: ~$0.0079 per message (India)
- Gmail SMTP: Free with App Password
- Twilio Voice: ~$0.013/minute (Indian inbound)

---

*Built for the Indian fintech market. Powered by Sarvam AI, Twilio, LangGraph, ChromaDB, and Supabase.*
