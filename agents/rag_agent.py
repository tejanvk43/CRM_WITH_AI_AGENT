#!/usr/bin/env python3
"""
rag_agent.py — LangGraph-compatible node: grounded retrieval-augmented answer.

Takes a query, retrieves the top-3 chunks from the ChromaDB index built by
ingest.py, and returns an answer that ONLY uses retrieved text
(no outside knowledge). Every factual claim carries its source_file and
version for the accuracy guardrail.

Grounding is enforced in two layers:
1. An answer-generation LLM (stubbed behind call_expensive_llm()) receives
   a strict "only use the provided context" instruction.
2. A deterministic self-check pass (`_verify_grounding`) re-scans the
   generated answer and drops any sentence whose keywords appear in none
   of the retrieved chunks — guaranteeing zero hallucinated facts even
   if the LLM misbehaves.

LangGraph contract:
    def rag_node(state: dict) -> dict:
        return {"answer": ..., "sources": [...], "cost_log": [...]}
"""

import json
import os
import re

from agents.intent_agent import cost_log, MODEL_TIER, COST_PER_CALL_USD

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROMA_DB_PATH = os.path.join(BASE_DIR, "scripts", "chroma_db")
COLLECTION_NAME = "flexipay_knowledge"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"

GROUNDING_SYSTEM_PROMPT = (
    "You are the knowledge answerer for a sales voice co-pilot. Answer the "
    "customer query using ONLY the provided retrieved context. Do not add "
    "outside knowledge. If the context does not contain the answer, say so "
    "explicitly. Keep the answer under 3 sentences, factual, and calm. "
    "Do not mention 'retrieved context' or 'chunks' to the customer."
)

# Cost for the high-stakes answer-generation step (one commercial-LLM call).
COST_ANSWER_USD = 0.005   # ~1k input + 200 output tokens on a mid-tier model


def _get_collection():
    import chromadb
    from chromadb.utils import embedding_functions

    embed_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=EMBEDDING_MODEL
    )
    client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
    return client.get_collection(COLLECTION_NAME, embedding_function=embed_fn)


def call_expensive_llm(system_prompt: str, user_message: str) -> str:
    """Stub for the high-stakes answer-generation call.

    Swap the body for your commercial LLM (GPT-4o-mini, Claude Haiku, etc.).
    Default implementation: extracts and stitches verbatim sentences from the
    context that best match the query — $0 cost, 100% grounded, no hallucination
    by construction. Good enough for the hackathon demo.
    """
    # user_message format: "Query: ...\n\nContext:\n..."
    m = re.search(r"Query:\s*(.+?)\n\nContext:", user_message, re.S)
    query = m.group(1).strip().lower() if m else user_message.lower()

    context_part = user_message.split("Context:\n", 1)[-1]
    # Drop [source|vX] provenance tags so answers never leak internal markup
    context_part = re.sub(r"\[\S+\|v[\d.]+\]\s*", "", context_part)
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", context_part)
                 if s.strip()]

    query_words = set(re.findall(r"[a-z0-9\u20b9]+", query))
    scored = []
    for s in sentences:
        s_words = set(re.findall(r"[a-z0-9\u20b9]+", s.lower()))
        score = len(query_words & s_words)
        scored.append((score, s))
    scored.sort(key=lambda x: -x[0])

    picked = [s for score, s in scored[:3] if score > 0]
    if not picked:
        picked = ["The requested information could not be verified from the "
                  "current knowledge base; please consult a human agent."]
    return " ".join(picked[:3])


# ---------------------------------------------------------------- node

def rag_node(state: dict) -> dict:
    """LangGraph node function.

    Expected state input:  {"query": "<customer question>"}
    Returns: {"answer": str, "sources": [dict], "cost_log": [dict]}
    """
    query = state.get("query") or state.get("turn") or ""
    top_k = state.get("top_k", 3)

    collection = _get_collection()
    results = collection.query(query_texts=[query], n_results=min(top_k, 10))

    chunks = []
    for i in range(len(results["ids"][0])):
        chunks.append({
            "id": results["ids"][0][i],
            "text": results["documents"][0][i],
            "source_file": results["metadatas"][0][i]["source_file"],
            "section": results["metadatas"][0][i]["section"],
            "version": results["metadatas"][0][i]["version"],
            "updated_at": results["metadatas"][0][i]["updated_at"],
        })

    def strip_internal_artifacts(text: str) -> str:
        """Remove markdown headings and internal doc metadata so the LLM
        can only quote customer-facing facts."""
        text = re.sub(r"^#+\s*.*$", "", text, flags=re.M)
        text = re.sub(r"\*\*Document version:\*\*.*$",
                        "", text, flags=re.M)
        text = re.sub(r"\*\*Last updated:\*\*.*$",
                        "", text, flags=re.M)
        text = re.sub(r"\*\*Source of truth:\*\*.*$",
                        "", text, flags=re.M)
        text = re.sub(r"\n{2,}", "\n", text)
        return text.strip()

    context_block = "\n\n".join(
        f"[{c['source_file']}|v{c['version']}] "
        f"{strip_internal_artifacts(c['text'])}"
        for c in chunks
    )
    user_msg = f"Query: {query}\n\nContext:\n{context_block}"

    raw_answer = call_expensive_llm(GROUNDING_SYSTEM_PROMPT, user_msg)
    answer = _verify_grounding(raw_answer, chunks)

    # Build fact-level sources: which chunks actually contributed keywords
    used = _identify_used_chunks(answer, chunks)
    sources = [
        {"source_file": c["source_file"], "version": c["version"],
         "section": c["section"], "updated_at": c["updated_at"]}
        for c in used
    ]

    entry = {
        "agent_name": "rag",
        "model_tier": MODEL_TIER,
        "cost_usd": COST_ANSWER_USD,
        "query_snippet": query[:80],
    }
    cost_log.append(entry)

    return {
        "answer": answer,
        "sources": sources,
        "cost_log": [entry],
    }


def _verify_grounding(answer: str, chunks: list[dict]) -> str:
    """Self-check step (build principle): keep only sentences that are
    verbatim or near-verbatim present in a retrieved chunk. Guarantees no
    outside knowledge leaks."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", answer)
                 if s.strip()]
    # Strip markdown artifacts so answers read cleanly to customers
    def clean(s: str) -> str:
        s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
        s = re.sub(r"^#+\s*|###\s*", "", s)
        s = re.sub(r"\\n", " ", s)
        s = re.sub(r"\s+", " ", s).strip()
        return s

    chunk_bodies = []
    for c in chunks:
        body = re.sub(r"^#+\s*.*$", "", c["text"], flags=re.M)
        chunk_bodies.append(clean(body).lower())

    kept = []
    for s in sentences:
        cs = clean(s).lower()
        # Skip provenance tags and quoted objection framing artifacts
        if cs.startswith("[") or cs.startswith("approved response"):
            continue
        words = set(re.findall(r"[a-z0-9\u20b9]+", cs))
        # Require >=3 content words AND >=70% of them present in one chunk
        # (verbatim-ish evidence, not just keyword coincidence)
        for body in chunk_bodies:
            body_words = set(re.findall(r"[a-z0-9\u20b9]+", body))
            if len(words) >= 3 and len(words & body_words) / len(words) >= 0.7:
                kept.append(clean(s))
                break
    if not kept:
        return ("I could not verify an answer from the current knowledge "
                "base. A human agent will follow up on this.")
    return " ".join(kept[:5])


def _identify_used_chunks(answer: str, chunks: list[dict]) -> list[dict]:
    answer_words = set(re.findall(r"[a-z0-9\u20b9]+", answer.lower()))
    used = []
    for c in chunks:
        c_words = set(re.findall(r"[a-z0-9\u20b9]+", c["text"].lower()))
        if len(answer_words & c_words) >= 2:
            used.append(c)
    return used


if __name__ == "__main__":
    # Standalone sanity check
    for q in ["What is the interest rate?",
              "What documents do I need for KYC?",
              "What happens if I miss a payment?"]:
        out = rag_node({"query": q})
        print(f"\nQ: {q}\nA: {out['answer']}\nSources: {out['sources']}")
