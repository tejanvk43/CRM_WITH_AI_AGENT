import os
import uuid
import httpx
import base64
import psycopg2
from psycopg2.extras import RealDictCursor
from fastapi import APIRouter, Request, Body
from fastapi.responses import PlainTextResponse, FileResponse
from twilio.twiml.voice_response import VoiceResponse, Gather
from twilio.rest import Client
from dotenv import load_dotenv

load_dotenv()

# The public-facing base URL (ngrok in dev, your real domain in prod)
PUBLIC_BASE_URL = os.environ.get("NGROK_URL", "http://127.0.0.1:8000").rstrip("/")
SARVAM_API_KEY = os.environ.get("SARVAM_API_KEY", "sk_ouoli4yi_TeQxY387JyL86NPGEaG7KRAP")

# Setup directory to cache generated TTS files
AUDIO_CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audio_cache")
os.makedirs(AUDIO_CACHE_DIR, exist_ok=True)

router = APIRouter()

# ---------------------------------------------------------------- Database Connection Helper
def get_db_connection():
    """
    Safely connects to the Supabase database, parsing the DATABASE_URL manually 
    to handle password strings containing special symbols like '@'.
    """
    db_url = os.environ.get("DATABASE_URL", "")
    try:
        if "://" in db_url:
            protocol, rest = db_url.split("://", 1)
            user_pass, host_port_db = rest.rsplit("@", 1)
            user, password = user_pass.split(":", 1)
            host_port, dbname = host_port_db.split("/", 1)
            host, port = host_port.split(":", 1)
            
            return psycopg2.connect(
                host=host,
                port=int(port),
                user=user,
                password=password,
                database=dbname
            )
    except Exception as e:
        print(f"[DB Connect Error] Custom parsing failed: {e}. Falling back to default psycopg2 parsing.")
    return psycopg2.connect(db_url)


# ---------------------------------------------------------------- Lead Lookup/Creation Helper
def get_or_create_lead_by_phone(phone: str) -> dict:
    """
    Looks up a lead in the database by checking clean phone number matches.
    If no match is found, auto-generates a new lead record.
    """
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            clean_phone = "".join(c for c in phone if c.isdigit())
            cur.execute("SELECT id, name, phone, \"creditScore\" FROM leads")
            leads_list = cur.fetchall()
            for lead in leads_list:
                lead_phone_clean = "".join(c for c in lead["phone"] if c.isdigit())
                if clean_phone.endswith(lead_phone_clean) or lead_phone_clean.endswith(clean_phone):
                    return lead
            
            # Create dynamic lead if not existing
            cur.execute(
                "INSERT INTO leads (name, phone, status, \"creditScore\", \"approvedLimit\", notes) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, name, phone, \"creditScore\"",
                (f"Incoming: {phone}", phone, "lead", 700, 3000, "Auto-created from incoming Twilio call.")
            )
            lead = cur.fetchone()
            conn.commit()
            return lead
    except Exception as e:
        print(f"[DB Error] get_or_create_lead_by_phone failed: {e}")
        return {"id": 1, "name": "Prospect", "phone": phone, "creditScore": 700}
    finally:
        conn.close()


# ---------------------------------------------------------------- Call Record Helpers
def create_call_record(lead_id: int) -> int:
    """
    Inserts a new call session into the database.
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO calls (\"leadId\", status, \"totalCost\") VALUES (%s, %s, %s) RETURNING id",
                (lead_id, "active", "0.0")
            )
            call_id = cur.fetchone()[0]
            conn.commit()
            return call_id
    except Exception as e:
        print(f"[DB Error] create_call_record failed: {e}")
        # Generate arbitrary fallback session ID
        return hash(str(lead_id)) % 100000
    finally:
        conn.close()


def persist_transcript_turn(call_id: int, speaker: str, text: str, intent: str = None, sentiment: str = None, assistant_response: str = None, cost_usd: float = 0.0):
    """
    Persists a conversation turn to the call_transcripts database table.
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO call_transcripts (\"callId\", speaker, text, intent, sentiment, \"assistantResponse\", \"costUsd\") VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (call_id, speaker, text, intent, sentiment, assistant_response, f"{cost_usd:.4f}")
            )
            conn.commit()
    except Exception as e:
        print(f"[DB Error] persist_transcript_turn failed: {e}")
    finally:
        conn.close()


def update_call_cost(call_id: int, add_cost: float):
    """
    Accumulates and updates the total spent call cost in the calls table.
    """
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT \"totalCost\" FROM calls WHERE id = %s", (call_id,))
            row = cur.fetchone()
            current_cost = float(row[0]) if row and row[0] else 0.0
            new_cost = current_cost + add_cost
            cur.execute(
                "UPDATE calls SET \"totalCost\" = %s WHERE id = %s",
                (f"{new_cost:.4f}", call_id)
            )
            conn.commit()
    except Exception as e:
        print(f"[DB Error] update_call_cost failed: {e}")
    finally:
        conn.close()


# ---------------------------------------------------------------- Sarvam AI TTS Service
async def generate_sarvam_audio(text: str) -> str:
    """
    Converts text to natural-sounding Indic voice using Sarvam AI's Text-to-Speech REST API.
    Saves the wav file into the audio cache directory and returns the cached filename.
    """
    if not SARVAM_API_KEY:
        print("[Sarvam TTS Warning] No SARVAM_API_KEY set.")
        return None
        
    try:
        url = "https://api.sarvam.ai/text-to-speech"
        headers = {
            "api-subscription-key": SARVAM_API_KEY,
            "Content-Type": "application/json"
        }
        payload = {
            "text": text,
            "language_code": "en-IN",
            "speaker": "tanya",
            "model": "bulbul:v3",
            "output_audio_codec": "mp3"
        }
        
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload, headers=headers, timeout=12.0)
            if resp.status_code == 200:
                data = resp.json()
                audios = data.get("audios", [])
                if audios:
                    audio_bytes = base64.b64decode(audios[0])
                    filename = f"{uuid.uuid4()}.mp3"
                    filepath = os.path.join(AUDIO_CACHE_DIR, filename)
                    with open(filepath, "wb") as f:
                        f.write(audio_bytes)
                    return filename
            else:
                print(f"[Sarvam TTS Error] HTTP {resp.status_code}: {resp.text}")
    except Exception as e:
        print(f"[Sarvam TTS Exception] failed to convert: {e}")
    return None


async def speak_text(response: VoiceResponse, text: str):
    """
    Uses Sarvam AI TTS to speak the response text if available.
    Falls back to Twilio's default 'alice' voice if Sarvam fails.
    """
    filename = await generate_sarvam_audio(text)
    if filename:
        audio_url = f"{PUBLIC_BASE_URL}/twilio/audio/{filename}"
        response.play(audio_url)
    else:
        # High quality fallback
        response.say(text, voice='alice')


# ---------------------------------------------------------------- Webhook Endpoints
@router.post("/voice")
async def twilio_voice(request: Request):
    """
    Webhook endpoint for incoming Twilio Voice calls.
    Lookup or create lead, start database call record, greet the user, and collect speech.
    """
    form_data = await request.form()
    call_sid = form_data.get("CallSid")
    from_phone = form_data.get("From", "")

    # 1. Database registration
    lead = get_or_create_lead_by_phone(from_phone)
    call_id = create_call_record(lead["id"])

    # Register call session in memory for LangGraph transcript accumulations
    from main import ACTIVE_CALLS
    ACTIVE_CALLS[call_id] = {
        "transcript": [],
        "cost_log": [],
        "lead_id": lead["id"],
        "silent_count": 0  # Initialize silent count
    }

    # Pass call_id as query parameter to identify the session in the gather step
    gather_url = f"{PUBLIC_BASE_URL}/twilio/gather?call_id={call_id}"
    status_url = f"{PUBLIC_BASE_URL}/twilio/status?call_id={call_id}"
    
    print(f"[Twilio /voice] CallSid={call_sid} | lead_id={lead['id']} | call_id={call_id} | gather_url={gather_url}")

    response = VoiceResponse()
    
    # Generate the initial greeting text
    consent = "Welcome to FlexiPay. This call is AI-assisted and recorded for quality and compliance. How can I help you today?"
    
    # Persist the initial greeting text to database
    persist_transcript_turn(call_id, "agent", consent, cost_usd=0.0)

    # Gather with statusCallback parameters to track call end events
    gather = Gather(input='speech', action=gather_url, method='POST', speechTimeout='auto')
    await speak_text(gather, consent)
    response.append(gather)
    
    # If the user remains silent, redirect to gather_url to trigger silent count retries
    response.redirect(gather_url)
    return PlainTextResponse(str(response), media_type="text/xml")


@router.post("/gather")
async def twilio_gather(request: Request):
    """
    Handles speech collected from the customer.
    Invokes the LangGraph node pipeline, logs transcripts in real-time to Supabase, 
    speaks suggestions using Sarvam TTS, and keeps the call active.
    """
    from main import process_turn, CallTurnRequest, ACTIVE_CALLS

    try:
        form_data = await request.form()
        speech_result = form_data.get("SpeechResult")
        call_sid = form_data.get("CallSid")
        
        call_id_str = request.query_params.get("call_id")
        call_id = int(call_id_str) if call_id_str else (hash(call_sid) % 100000)
        
        gather_url = f"{PUBLIC_BASE_URL}/twilio/gather?call_id={call_id}"
        print(f"[Twilio /gather] CallId={call_id} | CallSid={call_sid} | Speech='{speech_result}'")

        response = VoiceResponse()

        if speech_result:
            try:
                # 1. Process turn through LangGraph node pipeline
                req = CallTurnRequest(call_id=call_id, transcript_text=speech_result)
                ai_output = process_turn(req)
                
                suggestion = ai_output.get("suggestion", "")
                intent = ai_output.get("intent", "small_talk")
                sentiment = ai_output.get("sentiment", "neutral")
                turn_cost = ai_output.get("cost_usd", 0.0)

                # 2. Persist turn inputs and outputs to database in real-time
                # Store the customer speech
                persist_transcript_turn(
                    call_id=call_id,
                    speaker="customer",
                    text=speech_result,
                    intent=intent,
                    sentiment=sentiment,
                    assistant_response=suggestion,
                    cost_usd=turn_cost
                )
                
                # Store the agent response
                persist_transcript_turn(
                    call_id=call_id,
                    speaker="agent",
                    text=suggestion,
                    cost_usd=0.0
                )
                
                # Accumulate cost to call record
                update_call_cost(call_id, turn_cost)

                # Reset silent count on successful speech
                from main import ACTIVE_CALLS
                if call_id in ACTIVE_CALLS:
                    ACTIVE_CALLS[call_id]["silent_count"] = 0

                # 3. Handle compliance flag warnings without hanging up!
                if ai_output["compliance_flag"] or "[human_judgment_required]" in suggestion:
                    compliance_warning = "I have noted your request. Please note that guarantees on limits require document validation. What else can I check for you?"
                    await speak_text(response, compliance_warning)
                else:
                    # Speak the AI suggestion back to the caller
                    await speak_text(response, suggestion)
                
                # Always append gather to keep the conversation going indefinitely
                gather = Gather(input='speech', action=gather_url, method='POST', speechTimeout='auto')
                response.append(gather)
                
            except Exception as e:
                print("Error processing turn:", e)
                fallback_msg = "Sorry, our AI is experiencing minor technical delays. How can I help you?"
                await speak_text(response, fallback_msg)
                gather = Gather(input='speech', action=gather_url, method='POST', speechTimeout='auto')
                response.append(gather)
        else:
            from main import ACTIVE_CALLS
            session = ACTIVE_CALLS.get(call_id, {})
            silent_count = session.get("silent_count", 0) + 1
            session["silent_count"] = silent_count
            print(f"[Twilio /gather] Silence detected. Count={silent_count} for call_id={call_id}")

            if silent_count <= 2:
                fallback_repeat = "I didn't quite catch that. Are you still there?"
                gather = Gather(input='speech', action=gather_url, method='POST', speechTimeout='auto')
                await speak_text(gather, fallback_repeat)
                response.append(gather)
                response.redirect(gather_url)
            else:
                fallback_goodbye = "Thank you for calling FlexiPay. Have a great day, goodbye."
                await speak_text(response, fallback_goodbye)
                response.hangup()

        return PlainTextResponse(str(response), media_type="text/xml")
    except Exception as e:
        print(f"Critical error in /gather: {e}")
        return PlainTextResponse("<Response><Say>An unexpected error occurred.</Say></Response>", media_type="text/xml")


@router.post("/call/outbound")
async def trigger_outbound_call(payload: dict = Body(...)):
    """
    Triggers an outbound call to the lead's phone number using Twilio REST API.
    Associates the call session with lead_id.
    """
    to_phone = payload.get("phone")
    lead_id = payload.get("lead_id")
    if not to_phone:
        return {"error": "Missing phone number"}

    try:
        account_sid = os.environ.get("TWILIO_ACCOUNT_SID")
        auth_token = os.environ.get("TWILIO_AUTH_TOKEN")
        from_phone = os.environ.get("TWILIO_PHONE_NUMBER")

        if not account_sid or not auth_token or not from_phone:
            return {"error": "Twilio credentials not configured in environment"}

        # 1. Initialize DB call record
        call_id = create_call_record(lead_id)

        # Register call session in memory for LangGraph transcript accumulations
        from main import ACTIVE_CALLS
        ACTIVE_CALLS[call_id] = {
            "transcript": [],
            "cost_log": [],
            "lead_id": lead_id,
            "silent_count": 0
        }

        # 2. Trigger the Twilio Outbound Call
        client = Client(account_sid, auth_token)
        call = client.calls.create(
            to=to_phone,
            from_=from_phone,
            url=f"{PUBLIC_BASE_URL}/twilio/voice-outbound?call_id={call_id}"
        )
        print(f"[Outbound Call Triggered] CallSid={call.sid} | lead_id={lead_id} | call_id={call_id}")
        return {"success": True, "call_sid": call.sid, "call_id": call_id}
    except Exception as e:
        print(f"[Outbound Call Error] {e}")
        return {"error": str(e)}


@router.post("/voice-outbound")
async def twilio_voice_outbound(request: Request):
    """
    Webhook endpoint triggered when outbound call is answered.
    Greets the lead and starts speech collection.
    """
    call_id_str = request.query_params.get("call_id")
    if not call_id_str:
        return PlainTextResponse("<Response><Say>Invalid call configuration.</Say></Response>", media_type="text/xml")
    
    call_id = int(call_id_str)
    gather_url = f"{PUBLIC_BASE_URL}/twilio/gather?call_id={call_id}"
    
    response = VoiceResponse()
    
    # Generate the initial greeting text
    consent = "Welcome to FlexiPay. This call is AI-assisted and recorded for quality and compliance. How can I help you today?"
    
    # Persist the initial greeting text to database
    persist_transcript_turn(call_id, "agent", consent, cost_usd=0.0)

    # Gather speech
    gather = Gather(input='speech', action=gather_url, method='POST', speechTimeout='auto')
    await speak_text(gather, consent)
    response.append(gather)
    
    # If the user remains silent, redirect to gather_url to trigger silent count retries
    response.redirect(gather_url)
    return PlainTextResponse(str(response), media_type="text/xml")


@router.post("/status")
async def twilio_status(request: Request):
    """
    Status callback webhook triggered by Twilio when the call ends.
    Updates the database call state to completed, performs compliance auditing, and summaries.
    """
    try:
        form_data = await request.form()
        call_sid = form_data.get("CallSid")
        call_status = form_data.get("CallStatus")
        call_id_str = request.query_params.get("call_id")
        
        print(f"[Twilio /status] CallSid={call_sid} | Status={call_status} | call_id={call_id_str}")
        
        if call_status in ["completed", "failed", "busy", "no-answer"] and call_id_str:
            call_id = int(call_id_str)
            
            # 1. Update call state to completed in database
            conn = get_db_connection()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE calls SET status = %s WHERE id = %s",
                        ("completed", call_id)
                    )
                    conn.commit()
            except Exception as e:
                print(f"[DB Error] Status update failed: {e}")
            finally:
                conn.close()
                
            # 2. Perform compliance auditing and summaries
            from main import ACTIVE_CALLS
            if call_id in ACTIVE_CALLS:
                session = ACTIVE_CALLS.get(call_id)
                transcript = session.get("transcript", [])
                
                # Formulate summary
                intents = [t.get("intent") for t in transcript if t.get("intent")]
                if not intents:
                    summary = "Inquiry call resolved with default instructions."
                else:
                    summary = f"Customer call resolved with intents: {', '.join(set(intents))}."
                
                # Perform post-call self check
                from agents.self_check_agent import self_check_call
                self_check_passed, corrections = self_check_call(transcript)
                
                # Update call analysis in DB
                conn = get_db_connection()
                try:
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE calls SET summary = %s, \"overallSentiment\" = %s WHERE id = %s",
                            (summary, "neutral", call_id)
                        )
                        conn.commit()
                except Exception as e:
                    print(f"[DB Error] Post-call updates failed: {e}")
                finally:
                    conn.close()
                
                # Clean session from active memory
                ACTIVE_CALLS.pop(call_id, None)
                
    except Exception as e:
        print(f"Error in status webhook: {e}")
    return PlainTextResponse("OK")


@router.get("/audio/{filename}")
async def serve_audio(filename: str):
    """
    Serves generated TTS mp3 files from cache so Twilio can play them.
    """
    filepath = os.path.join(AUDIO_CACHE_DIR, filename)
    if os.path.exists(filepath):
        return FileResponse(filepath, media_type="audio/mpeg")
    return {"error": "File not found"}
