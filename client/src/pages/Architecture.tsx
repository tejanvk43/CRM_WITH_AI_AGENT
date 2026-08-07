import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Layers,
  Brain,
  Search,
  Bot,
  DollarSign,
  ShieldCheck,
  ArrowDown,
} from "lucide-react";

const PIPELINE_STEPS = [
  {
    icon: FileText,
    title: "1. Knowledge ingestion (ingest.py)",
    body: "Markdown source-of-truth documents (product_terms.md, kyc_process.md, faq_objections.md) are split into ~500-token chunks with 50-token overlap, respecting sentence and section boundaries. Every chunk carries metadata: source_file, section, version, updated_at.",
  },
  {
    icon: Layers,
    title: "2. Embedding & vector store",
    body: "Chunks are embedded with sentence-transformers all-MiniLM-L6-v2 — a small open-source model running locally with no API key — and persisted in a ChromaDB collection. Dense vector similarity matches customer questions to the most relevant facts.",
  },
  {
    icon: Bot,
    title: "3. Intent agent (LangGraph node 1)",
    body: "Each transcript turn is classified into {product_question, objection, kyc_question, ready_to_convert, small_talk} plus sentiment {positive, neutral, negative}. A cheap/fast model handles this routine decision — stubbed behind call_cheap_llm() so it can be swapped for Qwen/Gemma-lite — at roughly $0.0002 per call.",
  },
  {
    icon: Search,
    title: "4. RAG agent (LangGraph node 2)",
    body: "The turn (or query) retrieves top-3 chunks from ChromaDB and generates a grounded answer using ONLY retrieved text. A deterministic self-check drops any sentence not evidenced verbatim in the context, guaranteeing zero hallucinated facts.",
  },
  {
    icon: DollarSign,
    title: "5. Cost accounting",
    body: "Every agent call logs {agent_name, model_tier, cost_usd} to a session cost log. Cheap tier (~$0.0002) handles routine classification; the expensive tier (~$0.005) is reserved for answer generation — total ≈ $0.0052 per turn, well under typical contact-center cost per interaction.",
  },
  {
    icon: ShieldCheck,
    title: "6. Guardrails",
    body: "Consent disclosure, DPDP Act 2023 data handling, human oversight on final credit terms, and version-pinned source citations ensure the assistant supports — never replaces — the sales agent's judgment.",
  },
];

export default function Architecture() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto w-full">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Architecture Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The full RAG + intent-classification pipeline behind the FlexiPay voice co-pilot,
          built on the build principle of several specialized, cooperating agents.
        </p>
      </div>

      {/* Pipeline flow */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-3">
            {PIPELINE_STEPS.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                  <step.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 pb-4">
                  <h3 className="text-sm font-semibold">{step.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    {step.body}
                  </p>
                </div>
                {i < PIPELINE_STEPS.length - 1 && (
                  <ArrowDown className="h-4 w-4 text-muted-foreground/40 mx-auto hidden md:block" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* LangGraph node design */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">LangGraph node design</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border bg-secondary/30 p-4">
            <p className="text-xs font-mono mb-2 text-primary">intent_node(state)</p>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
{`input:  {"turn": "<customer transcript turn>"}
output: {"intent": Intent, "sentiment": Sentiment,
         "cost_log": [{agent_name:"intent", model_tier:"cheap",
                       cost_usd:0.0002}]`}
            </pre>
          </div>
          <div className="rounded-lg border bg-secondary/30 p-4">
            <p className="text-xs font-mono mb-2 text-primary">rag_node(state)</p>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
{`input:  {"query": "<customer question>", "top_k": 3}
output: {"answer": "<grounded text>",
         "sources": [{source_file, version, section, updated_at}],
         "cost_log": [{agent_name:"rag", model_tier:"expensive",
                       cost_usd:0.005}]`}
            </pre>
          </div>
          <p className="text-xs text-muted-foreground">
            In production these nodes compose inside a LangGraph StateGraph:
            intent_node branches on intent (objection → objection playbook,
            ready_to_convert → handoff to CRM onboarding), and every path
            terminates in the self-check step before a response is surfaced
            to the customer or the agent.
          </p>
        </CardContent>
      </Card>

      {/* Stack */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Stack & model-tier strategy</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {[
              "Python 3.12",
              "sentence-transformers",
              "all-MiniLM-L6-v2 (open-source)",
              "ChromaDB (persistent vector store)",
              "FastAPI",
              "LangGraph nodes",
              "React 19 + Tailwind 4 (dashboard)",
              "tRPC / Express (API layer)",
            ].map((tech) => (
              <Badge key={tech} variant="secondary" className="text-xs">
                {tech}
              </Badge>
            ))}
          </div>
          <div className="mt-4 grid sm:grid-cols-2 gap-3">
            <div className="rounded-lg border bg-secondary/30 p-3">
              <p className="text-xs font-semibold mb-1">Cheap tier (routine)</p>
              <p className="text-xs text-muted-foreground">
                Intent + sentiment classification: open-source or low-cost model,
                ≈ $0.0002/call, ≈ 50 ms latency.
              </p>
            </div>
            <div className="rounded-lg border bg-secondary/30 p-3">
              <p className="text-xs font-semibold mb-1">Expensive tier (high-stakes)</p>
              <p className="text-xs text-muted-foreground">
                Grounded answer generation: commercial LLM only when retrieval
                confirms a factual answer exists, ≈ $0.005/call.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
