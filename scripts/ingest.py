#!/usr/bin/env python3
"""
ingest.py — RAG knowledge ingestion pipeline for FlexiPay (Pay-in-3)

Reads the Markdown knowledge documents under ./data/docs/, splits them into
~500-token chunks with 50-token overlap, embeds them locally with
sentence-transformers (all-MiniLM-L6-v2 — no API key needed), and persists
everything in a ChromaDB collection at ./chroma_db.

Every chunk carries metadata: source_file, section, version, updated_at.

Usage:
    python ingest.py                  # full re-ingest
    python ingest.py --no-rebuild     # skip collection rebuild if it exists
"""

import argparse
import os
import re
import sys
import uuid
from datetime import datetime, timezone

CHROMA_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_db")
DOCS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "docs")

CHUNK_TOKENS = 500
OVERLAP_TOKENS = 50
EMBEDDING_MODEL = "all-MiniLM-L6-v2"


def estimate_tokens(text: str) -> int:
    """Rough token estimate: ~1 token per 3.5-4 chars for English text."""
    return max(1, int(len(text) / 3.6) + text.count(" "))


def split_into_sentences(text: str) -> list[str]:
    """Split text into sentence-like units, preserving section boundaries."""
    # Keep markdown headings as their own units so section context is clean
    units = re.split(r"\n(?=#)", text)
    sentences = []
    for unit in units:
        unit = unit.strip()
        if not unit:
            continue
        # Headings stay as single units
        if unit.startswith("#"):
            sentences.append(unit)
            continue
        for seg in re.split(r"(?<=[.!?])\s+(?=[A-Z(])", unit):
            seg = seg.strip()
            if seg:
                sentences.append(seg)
    return sentences


def get_section_title(heading_lines: list[str]) -> str:
    """Extract the section title from short markdown heading lines.

    Headings may carry their following paragraph with embedded newlines
    (e.g. '## 1. Product Overview\n\nFlexiPay is...'), so we only take
    the text up to the first blank line."""
    for line in heading_lines:
        title = line.strip().lstrip("#").strip()
        title = title.split("\n")[0].split("\r")[0].strip()
        if title and len(title) < 120:
            return title
    return "unknown"


def get_doc_version(text: str) -> str:
    m = re.search(r"\*\*Document version:\*\*\s*(.+)", text)
    return m.group(1).strip() if m else "unversioned"


def get_doc_updated(text: str) -> str:
    m = re.search(r"\*\*Last updated:\*\*\s*(.+)", text)
    return m.group(1).strip() if m else datetime.now(timezone.utc).strftime("%Y-%m-%d")


def chunk_document(text: str, source_file: str) -> list[dict]:
    """Sliding-window chunking: ~CHUNK_TOKENS tokens per chunk, OVERLAP_TOKENS overlap."""
    sentences = split_into_sentences(text)
    version = get_doc_version(text)
    updated_at = get_doc_updated(text)

    chunks = []
    window = []
    window_tokens = 0
    chunk_index = 0

    for sentence in sentences:
        s_tokens = estimate_tokens(sentence)
        # If a single sentence exceeds the budget, emit it alone (avoid infinite loop)
        if s_tokens >= CHUNK_TOKENS:
            if window:
                chunks.append(_make_chunk(window, chunk_index, source_file, version, updated_at))
                chunk_index += 1
                window = []
                window_tokens = 0
            chunks.append(_make_chunk([sentence], chunk_index, source_file, version, updated_at))
            chunk_index += 1
            continue

        if window_tokens + s_tokens > CHUNK_TOKENS and window:
            chunks.append(_make_chunk(window, chunk_index, source_file, version, updated_at))
            chunk_index += 1
            # Keep an overlap tail so consecutive chunks share context
            window, window_tokens = _overlap_tail(window, OVERLAP_TOKENS)

        window.append(sentence)
        window_tokens += s_tokens

    if window:
        chunks.append(_make_chunk(window, chunk_index, source_file, version, updated_at))

    return chunks


def _overlap_tail(window: list[str], overlap_tokens: int) -> tuple[list[str], int]:
    """Return the trailing portion of window whose token count <= overlap_tokens."""
    tail = []
    tail_tokens = 0
    for sentence in reversed(window):
        t = estimate_tokens(sentence)
        if tail_tokens + t > overlap_tokens:
            break
        tail.append(sentence)
        tail_tokens += t
    return list(reversed(tail)), tail_tokens


def _make_chunk(sentences: list[str], index: int, source_file: str,
                version: str, updated_at: str) -> dict:
    text = "\n".join(sentences)
    return {
        "id": f"{os.path.splitext(os.path.basename(source_file))[0]}_chunk_{index:03d}",
        "text": text,
        "metadata": {
            "source_file": source_file,
            "section": get_section_title([s for s in sentences if s.strip().startswith("#")]),
            "version": version,
            "updated_at": updated_at,
            "chunk_index": index,
            "ingested_at": datetime.now(timezone.utc).isoformat(),
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Ingest knowledge docs into ChromaDB")
    parser.add_argument("--no-rebuild", action="store_true",
                        help="Skip rebuilding the collection if it already exists")
    args = parser.parse_args()

    import chromadb
    from chromadb.utils import embedding_functions

    docs = []
    for fname in sorted(os.listdir(DOCS_DIR)):
        if not fname.endswith(".md"):
            continue
        path = os.path.join(DOCS_DIR, fname)
        text = open(path, encoding="utf-8").read()
        chunks = chunk_document(text, fname)
        docs.extend(chunks)
        print(f"[{fname}] {len(chunks)} chunks")

    if not docs:
        sys.exit(f"ERROR: no .md files found in {DOCS_DIR}")

    # Local embeddings — no API key needed
    embed_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=EMBEDDING_MODEL
    )

    client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
    collection_name = "flexipay_knowledge"
    if args.no_rebuild and collection_name in [c.name for c in client.list_collections()]:
        collection = client.get_collection(collection_name, embedding_function=embed_fn)
        print(f"Collection '{collection_name}' already exists — skipping rebuild (--no-rebuild).")
    else:
        if collection_name in [c.name for c in client.list_collections()]:
            client.delete_collection(collection_name)
        collection = client.create_collection(
            name=collection_name,
            embedding_function=embed_fn,
            metadata={"hnsw:space": "cosine"},
        )

    collection.upsert(
        ids=[c["id"] for c in docs],
        documents=[c["text"] for c in docs],
        metadatas=[c["metadata"] for c in docs],
    )
    print(f"\nTotal chunks indexed: {len(docs)}")
    print(f"ChromaDB persisted at: {CHROMA_DB_PATH}")


if __name__ == "__main__":
    main()
