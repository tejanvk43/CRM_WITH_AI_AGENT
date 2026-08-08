#!/usr/bin/env python3
"""
main.py — FastAPI server wiring the AI Co-Pilot LangGraph workflow.

Exposes endpoints:
- POST /call/start -> returns the consent script and starts a call session.
- POST /call/turn -> processes a customer turn through the LangGraph StateGraph.
- POST /call/end -> runs the facts self-check and returns final session metrics.
- GET /health -> returns standard status check.
"""

import sys
import os
import operator
import traceback
import logging
from typing import Annotated, List, Optional
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing_extensions import TypedDict

# Put current working directory on path for module imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Structured diagnostic logging — every major stage of a call is traced.
# Do not silence these; they are the primary debug signal for webhook failures.
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("main")

from agents.intent_agent import intent_node
from agents.rag_agent import rag_node
from agents.nba_agent import nba_node
from agents.compliance_agent import compliance_node
from agents.self_check_agent import self_check_call

from langgraph.graph import StateGraph, END

# Global in-memory dictionary tracking active call transcripts and costs
ACTIVE_CALLS = {}

# Define shared LangGraph AgentState
class AgentState(TypedDict):
    transcript_turn: str
    call_id: int
    intent: str
    sentiment: str
    retrieved_facts: List[str]
    suggestion: str
    compliance_flag: bool
    # Annotated list with operator.add concatenates list updates in LangGraph
    cost_log: Annotated[List[dict], operator.add]


# ---------------------------------------------------------------- Node Adapters
def run_intent_node(state: AgentState) -> dict:
    try:
        out = intent_node({"turn": state["transcript_turn"]})
        return {
            "intent": out.get("intent", "product_question"),
            "sentiment": out.get("sentiment", "neutral"),
            "cost_log": out.get("cost_log", [])
        }
    except Exception as e:
        logger.error("[Intent node error] %s", e)
        traceback.print_exc()
        return {"intent": "product_question", "sentiment": "neutral", "cost_log": []}


def run_rag_node(state: AgentState) -> dict:
    try:
        out = rag_node({"query": state["transcript_turn"], "top_k": 3})
        return {
            "retrieved_facts": [out.get("answer", "")],
            "cost_log": out.get("cost_log", [])
        }
    except Exception as e:
        logger.error("[RAG node error] %s", e)
        traceback.print_exc()
        return {"retrieved_facts": [], "cost_log": []}


def run_nba_node(state: AgentState) -> dict:
    try:
        out = nba_node({
            "intent": state.get("intent", "small_talk"),
            "retrieved_facts": state.get("retrieved_facts", []),
            "call_history": [{"speaker": "customer", "text": state["transcript_turn"]}]
        })
        return {
            "suggestion": out.get("nba_suggestion", ""),
            "cost_log": out.get("cost_log", [])
        }
    except Exception as e:
        logger.error("[NBA node error] %s", e)
        traceback.print_exc()
        return {"suggestion": "Thank you for your question. Let me connect you with a specialist who can help.", "cost_log": []}


def run_compliance_node(state: AgentState) -> dict:
    try:
        out = compliance_node({
            "nba_suggestion": state.get("suggestion", ""),
            "turn": state["transcript_turn"]
        })
        return {
            "compliance_flag": out.get("compliance_flag", False),
            "suggestion": out.get("nba_suggestion", state.get("suggestion", "")),
            "cost_log": out.get("cost_log", [])
        }
    except Exception as e:
        logger.error("[Compliance node error] %s", e)
        traceback.print_exc()
        return {"compliance_flag": False, "suggestion": state.get("suggestion", ""), "cost_log": []}


# ---------------------------------------------------------------- Build StateGraph
workflow = StateGraph(AgentState)

workflow.add_node("intent", run_intent_node)
workflow.add_node("rag", run_rag_node)
workflow.add_node("nba", run_nba_node)
workflow.add_node("compliance", run_compliance_node)

workflow.set_entry_point("intent")

# Conditional routing from intent: skip RAG for small talk
def route_intent(state: AgentState) -> str:
    if state.get("intent") == "small_talk":
        return "nba"
    return "rag"

workflow.add_conditional_edges(
    "intent",
    route_intent,
    {
        "rag": "rag",
        "nba": "nba"
    }
)

workflow.add_edge("rag", "nba")
workflow.add_edge("nba", "compliance")
workflow.add_edge("compliance", END)

graph = workflow.compile()

app = FastAPI(title="FlexiPay Inside Sales AI Voice Co-Pilot")

@app.on_event("startup")
async def startup_warmup():
    """Pre-warm the embedding model, vector collection, and Sarvam LLM pool so live calls never suffer initial load latency."""
    import asyncio
    print("[Warmup] Pre-warming SentenceTransformer, ChromaDB, and Sarvam LLM connection...")
    try:
        from agents.rag_agent import _get_collection, rag_node
        col = await asyncio.to_thread(_get_collection)
        await asyncio.to_thread(col.query, query_texts=["warmup query"], n_results=1)
        
        # Warmup NBA agent LLM connection
        from agents.nba_agent import call_reasoning_llm
        await asyncio.to_thread(call_reasoning_llm, "Warmup prompt", "Hello")
        
        print("[Warmup] All models and connections are warmed up and ready in RAM (1-2s target active)!")
    except Exception as e:
        print(f"[Warmup Warning] Failed to pre-warm pipeline: {e}")

from twilio_router import router as twilio_router
app.include_router(twilio_router, prefix="/twilio", tags=["Twilio Voice"])

# Pydantic schemas
class CallStartRequest(BaseModel):
    call_id: int


class CallStartResponse(BaseModel):
    consent_script: str


class CallTurnRequest(BaseModel):
    call_id: int
    transcript_text: str


class CallTurnResponse(BaseModel):
    intent: str
    sentiment: str
    suggestion: str
    retrieved_facts: List[str]
    compliance_flag: bool
    cost_usd: float


class CallEndRequest(BaseModel):
    call_id: int


class CallEndResponse(BaseModel):
    summary: str
    self_check_passed: bool
    corrections: List[str]
    total_cost_usd: float


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/call/start", response_model=CallStartResponse)
def start_call(payload: CallStartRequest):
    # Initialize the call session state
    ACTIVE_CALLS[payload.call_id] = {
        "transcript": [],
        "cost_log": []
    }
    
    # Complies with DPDP Act 2023 & telecom regulations
    consent_text = (
        "This call may be recorded and AI-assisted for quality and compliance purposes. "
        "Your personal and financial data will be processed in accordance with the Digital Personal Data "
        "Protection Act, 2023 and stored in India. Do you consent to proceed?"
    )
    return {"consent_script": consent_text}


@app.post("/call/turn", response_model=CallTurnResponse)
def process_turn(payload: CallTurnRequest):
    """Synchronous LangGraph turn processor.

    This function is CPU-bound and may take several seconds (the first turn of
    a fresh process cold-loads the sentence-transformers embedding model and
    the ChromaDB index). The Twilio webhook calls it from `twilio_router`
    inside `asyncio.to_thread` with a timeout budget, so it must remain pure
    and safe to run in a worker thread (no event-loop work inside).
    """
    # Gracefully handle missing start call triggers
    if payload.call_id not in ACTIVE_CALLS:
        ACTIVE_CALLS[payload.call_id] = {
            "transcript": [],
            "cost_log": []
        }
        
    # Initialize graph state with safe defaults
    initial_state = {
        "transcript_turn": payload.transcript_text,
        "call_id": payload.call_id,
        "intent": "product_question",
        "sentiment": "neutral",
        "retrieved_facts": [],
        "suggestion": "",
        "compliance_flag": False,
        "cost_log": []
    }

    try:
        # Run StateGraph
        final_state = graph.invoke(initial_state)
    except Exception as e:
        logger.error("[Graph invoke error] %s", e)
        traceback.print_exc()
        # Return a safe fallback so the Twilio call keeps going
        return {
            "intent": "product_question",
            "sentiment": "neutral",
            "suggestion": "Thank you for your patience. Our FlexiPay product offers zero interest for 3 months with no processing fees. What would you like to know?",
            "retrieved_facts": [],
            "compliance_flag": False,
            "cost_usd": 0.0
        }

    # Sum up cost log entries generated in this execution path
    turn_cost = sum(float(item.get("cost_usd", 0)) for item in final_state.get("cost_log", []))

    # Log details to session history
    session = ACTIVE_CALLS[payload.call_id]
    
    # Add customer speech and generated suggestion to the transcript log
    session["transcript"].append({
        "speaker": "customer",
        "text": payload.transcript_text,
        "intent": final_state.get("intent", "product_question"),
        "suggestion": final_state.get("suggestion", ""),
        "compliance_flag": final_state.get("compliance_flag", False)
    })
    
    # Append turn cost entries to call cost logs
    session["cost_log"].extend(final_state.get("cost_log", []))

    return {
        "intent": final_state.get("intent", "product_question"),
        "sentiment": final_state.get("sentiment", "neutral"),
        "suggestion": final_state.get("suggestion", ""),
        "retrieved_facts": final_state.get("retrieved_facts", []),
        "compliance_flag": final_state.get("compliance_flag", False),
        "cost_usd": turn_cost
    }


@app.post("/call/end", response_model=CallEndResponse)
def end_call(payload: CallEndRequest):
    if payload.call_id not in ACTIVE_CALLS:
        raise HTTPException(status_code=404, detail=f"Call session {payload.call_id} not found.")
        
    session = ACTIVE_CALLS[payload.call_id]
    transcript = session["transcript"]
    cost_log_entries = session["cost_log"]
    
    # 1. Run self-check agent on the call transcript
    self_check_passed, corrections = self_check_call(transcript)
    
    # 2. Sum up total call costs
    total_cost_usd = sum(float(item["cost_usd"]) for item in cost_log_entries)
    
    # 3. Formulate call summary
    intents = [t.get("intent") for t in transcript if t.get("intent")]
    if not intents:
        summary = "Short conversation with no active intent classified."
    else:
        summary = f"Customer conversation resolved with key intents: {', '.join(set(intents))}."
        
    # Remove the active call session to free up memory
    ACTIVE_CALLS.pop(payload.call_id)
    
    return {
        "summary": summary,
        "self_check_passed": self_check_passed,
        "corrections": corrections,
        "total_cost_usd": total_cost_usd
    }
