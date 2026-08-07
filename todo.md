# FlexiPay Voice Co-Pilot — Dashboard TODO

- [x] Seed knowledge base: port ingest.py pipeline to TypeScript (chunking 500 tokens/50 overlap, local-style embedding via small model, 3 collections: product_terms, kyc_process, faq_objections)
- [x] Backend pipeline: intent classification node (5 intents + 3 sentiments) with cost logging
- [x] Backend pipeline: RAG retrieval node with grounded answer + source citations (source_file + version)
- [x] Dark theme applied app-wide
- [x] Sidebar navigation: Demo, Knowledge Base, Architecture, Cost Log
- [x] Demo page: text input, real-time intent/sentiment display, grounded RAG answer panel
- [x] Demo page: 3 pre-loaded clickable sample transcript turns
- [x] Knowledge Base page: list documents with version/updated_at, chunk drill-down
- [x] Cost Log page: live log (agent_name, model_tier, cost_usd) + running session total
- [x] Architecture page: pipeline explanation (ChromaDB, sentence-transformers, intent agent, LangGraph nodes)
- [x] Vitest tests for backend pipeline
- [x] End-to-end verification + checkpoint
- [x] All pipeline files moved into the project folder: scripts/data/docs/ (3 knowledge docs), scripts/ingest.py, scripts/test_retrieval.py, agents/ (intent_agent.py, rag_agent.py, run_agents.py), README.md with layout/setup, requirements.txt
