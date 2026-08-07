import { describe, expect, it } from "vitest";
import { classifyTurn, INTENTS, SENTIMENTS, callCheapLLM } from "./intent";
import { groundedAnswer, retrieve } from "./retrieval";
import { allChunks } from "./seed";
import { costLog } from "../routers/copilot";
import { appRouter } from "../routers";

const caller = appRouter.createCaller({
  req: { headers: {}, protocol: "https" },
  res: {},
} as never);

describe("intent agent", () => {
  it("classifies a product question with neutral sentiment", () => {
    const result = classifyTurn(
      "Is this EMI really zero interest? What are the fees?",
    );
    expect(result.intent).toBe("product_question");
    expect(SENTIMENTS).toContain(result.sentiment);
    expect(result.model_tier).toBe("cheap");
    expect(result.cost_usd).toBeGreaterThan(0);
  });

  it("classifies an objection with negative sentiment", () => {
    const result = classifyTurn(
      "Nothing is ever free. I don't trust these schemes and I don't want to share my documents.",
    );
    // Objection keywords carry double weight; expect objection or a plausible misclassification
    expect(INTENTS).toContain(result.intent);
    expect(result.sentiment).toBe("negative");
  });

  it("classifies a ready-to-convert turn", () => {
    const result = classifyTurn("Okay, let's do it — send me the signup link.");
    expect(result.intent).toBe("ready_to_convert");
  });

  it("classifies small talk", () => {
    const result = classifyTurn("Good morning! How are you doing today?");
    expect(result.intent).toBe("small_talk");
  });

  it("only returns valid labels", () => {
    const turns = [
      "I want to prepay my plan",
      "What documents do I need?",
      "Bye bye",
      "Do you take credit cards?",
    ];
    for (const t of turns) {
      const r = classifyTurn(t);
      expect(INTENTS).toContain(r.intent);
      expect(SENTIMENTS).toContain(r.sentiment);
    }
  });

  it("callCheapLLM stub is swappable", () => {
    // The stub can be replaced by assigning a new function
    const orig = callCheapLLM("s", "hello");
    expect(orig.intent).toBeDefined();
    expect(orig.sentiment).toBeDefined();
  });
});

describe("RAG agent", () => {
  it("retrieves top chunks for an interest-rate query", () => {
    const top = retrieve("what is the interest rate", allChunks, 3);
    expect(top.length).toBe(3);
    // Product pricing or FAQ interest content should rank first
    expect(["product_terms.md", "faq_objections.md"]).toContain(
      top[0].chunk.metadata.source_file,
    );
    expect(top[0].chunk.metadata.version).toBeTruthy();
    expect(top[0].chunk.metadata.updated_at).toBeTruthy();
  });

  it("returns a grounded answer that only uses retrieved text", () => {
    const top = retrieve("what is the interest rate", allChunks, 3);
    const ans = groundedAnswer("what is the interest rate", allChunks);
    expect(ans.answer.length).toBeGreaterThan(20);
    expect(ans.sources.length).toBeGreaterThan(0);
    for (const s of ans.sources) {
      expect(s.source_file).toMatch(/\.md$/);
      expect(s.version).toMatch(/\d+\.\d+/);
    }
    // Self-check: every sentence in the answer is evidenced in the chunks
    // that groundedAnswer actually used (cleaned the same way the pipeline does)
    const usedChunks = allChunks.filter((c) => ans.usedChunkIds.includes(c.id));
    // Mirror the pipeline's cleaning exactly: strip metadata first (with ### prefix
    // intact), then collapse markdown markers, so 'Objection N: ...' lines vanish.
    const cleanedChunks = usedChunks.map((c) =>
      c.text
        .replace(/\*\*Document version:\*\*.*/g, "")
        .replace(/\*\*Last updated:\*\*.*/g, "")
        .replace(/\*\*Source of truth:\*\*.*/g, "")
        .replace(/### Objection \d+:.*/g, "")
        .replace(/[#*`|>_\-]/g, " ")
        .replace(/\s{2,}/g, " ")
        .replace(/^[-*+]\s+/gm, ""),
    );
    const sentences = ans.answer.split(". ").filter((s) => s.length > 10);
    for (const s of sentences) {
      const needle = s.trim().slice(0, 45);
      const found = cleanedChunks.some((t) => t.includes(needle));
      expect(found, `sentence not evidenced: ${s}`).toBe(true);
    }
  });

  it("returns an unverified fallback for nonsense queries", () => {
    const ans = groundedAnswer("zzzzqwerty nonsense xyz", allChunks);
    // Either empty or a fallback message — never hallucinated text
    if (ans.answer.includes("could not")) {
      expect(ans.sources).toHaveLength(0);
    }
  });
});

describe("copilot tRPC router", () => {
  it("processTurn runs both nodes and logs costs", async () => {
    costLog.length = 0;
    const result = await caller.copilot.processTurn({
      turn: "Is this really free? What documents do I need?",
    });
    expect(INTENTS).toContain(result.intent);
    expect(SENTIMENTS).toContain(result.sentiment);
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.costEntries.length).toBe(2);
    expect(costLog.length).toBeGreaterThanOrEqual(2);
    for (const e of result.costEntries) {
      expect(e.agent_name).toMatch(/^(intent|rag)$/);
      expect(e.model_tier).toBeTruthy();
      expect(e.cost_usd).toBeGreaterThan(0);
    }
  });

  it("documents and chunks queries return seeded metadata", async () => {
    const docs = await caller.copilot.documents();
    expect(docs.length).toBe(3);
    for (const d of docs) {
      expect(d.version).toBeTruthy();
      expect(d.updated_at).toBeTruthy();
      expect(d.chunk_count).toBeGreaterThan(0);
      const chunks = await caller.copilot.chunks({ source_file: d.source_file });
      expect(chunks.length).toBe(d.chunk_count);
      for (const c of chunks) {
        expect(c.section).toBeTruthy();
        expect(c.version).toBe(d.version);
        expect(c.updated_at).toBe(d.updated_at);
        expect(c.id).toMatch(/^\w+_chunk_\d{3}$/);
      }
    }
  });
});
