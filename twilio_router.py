import os
from fastapi import APIRouter, Request, BackgroundTasks
from fastapi.responses import PlainTextResponse
from twilio.twiml.voice_response import VoiceResponse, Gather
from twilio.rest import Client
from dotenv import load_dotenv

load_dotenv()
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")
TWILIO_PHONE_NUMBER = os.environ.get("TWILIO_PHONE_NUMBER")

twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN else None

router = APIRouter()

@router.post("/voice")
async def twilio_voice(request: Request):
    """
    Webhook endpoint for incoming Twilio Voice calls.
    Uses <Gather> to collect user speech and send to /twilio/gather.
    """
    form_data = await request.form()
    call_sid = form_data.get("CallSid")

    response = VoiceResponse()
    
    # Greet the customer and ask a question.
    gather = Gather(input='speech', action='/twilio/gather', method='POST', speechTimeout='auto')
    
    # Read the consent script initially (we'd fetch this from the graph in a real setup)
    consent = "Welcome to FlexiPay. This call is AI-assisted and recorded for quality purposes. How can I help you today?"
    gather.say(consent, voice='Polly.Matthew-Neural')
    
    response.append(gather)
    
    # If they don't say anything, say goodbye
    response.say("We didn't receive any input. Goodbye.")
    
    return PlainTextResponse(str(response), media_type="text/xml")


@router.post("/gather")
async def twilio_gather(request: Request):
    """
    Handles the gathered speech from the customer.
    Sends it to the Python LangGraph backend, gets the NBA suggestion, 
    and reads it back.
    """
    from main import process_turn, CallTurnRequest, ACTIVE_CALLS

    form_data = await request.form()
    speech_result = form_data.get("SpeechResult")
    call_sid = form_data.get("CallSid")

    # Generate a numeric ID for the internal dictionary from the CallSid (or just use string, 
    # but our main.py assumes integer call_id, let's map it roughly)
    call_id = hash(call_sid) % 100000

    response = VoiceResponse()

    if speech_result:
        # 1. Process turn through LangGraph
        try:
            req = CallTurnRequest(call_id=call_id, transcript_text=speech_result)
            ai_output = process_turn(req)
            
            # Extract NBA Suggestion
            suggestion = ai_output["suggestion"]
            
            # If compliance flag is raised, do not read out the suggestion, transfer to human!
            if ai_output["compliance_flag"] or "[human_judgment_required]" in suggestion:
                response.say("Let me transfer you to a human agent to discuss this sensitive matter.", voice='Polly.Matthew-Neural')
                # Optional: response.dial("+1234567890")
            else:
                # Speak the AI suggestion back to the caller
                response.say(suggestion, voice='Polly.Matthew-Neural')
                
                # Gather again for the next turn
                gather = Gather(input='speech', action='/twilio/gather', method='POST', speechTimeout='auto')
                response.append(gather)
        except Exception as e:
            response.say("Sorry, our AI is experiencing technical difficulties.", voice='Polly.Matthew-Neural')
            print("Error processing turn:", e)
    else:
        response.say("I didn't quite catch that. Can you repeat?", voice='Polly.Matthew-Neural')
        gather = Gather(input='speech', action='/twilio/gather', method='POST', speechTimeout='auto')
        response.append(gather)

    return PlainTextResponse(str(response), media_type="text/xml")
