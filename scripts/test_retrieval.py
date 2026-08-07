#!/usr/bin/env python3
"""
test_retrieval.py — Quick retrieval sanity check

Queries the ChromaDB knowledge base with "what is the interest rate" and
prints the top-3 chunks with their metadata so you can confirm retrieval
works before building agents on top of the collection.

Usage:
    python test_retrieval.py
    python test_retrieval.py "can I prepay early"
"""

import os
import sys

CHROMA_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chroma_db")
EMBEDDING_MODEL = "all-MiniLM-L6-v2"


def main():
    query = "what is the interest rate" if len(sys.argv) < 2 else " ".join(sys.argv[1:])

    import chromadb
    from chromadb.utils import embedding_functions

    embed_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=EMBEDDING_MODEL
    )
    client = chromadb.PersistentClient(path=CHROMA_DB_PATH)
    collection = client.get_collection("flexipay_knowledge", embedding_function=embed_fn)

    results = collection.query(query_texts=[query], n_results=3)

    print(f"Query: \"{query}\"\n")
    print("=" * 90)
    for i in range(len(results["ids"][0])):
        meta = results["metadatas"][0][i]
        dist = results["distances"][0][i]
        text = results["documents"][0][i]
        print(f"[Top-{i+1}] distance={dist:.4f}")
        print(f"  source_file : {meta.get('source_file')}")
        print(f"  section     : {meta.get('section')}")
        print(f"  version     : {meta.get('version')}")
        print(f"  updated_at  : {meta.get('updated_at')}")
        print(f"  text        : {text[:400]}{'...' if len(text) > 400 else ''}")
        print("-" * 90)


if __name__ == "__main__":
    main()
