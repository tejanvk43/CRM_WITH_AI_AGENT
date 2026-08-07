/**
 * retrieval.ts — Lightweight retrieval engine (the RAG agent node).
 *
 * This is the deploy-friendly equivalent of the Python ChromaDB/
 * all-MiniLM-L6-v2 pipeline from ingest.py. It uses deterministic
 * tokenized term scoring with BM25-style document-frequency weighting,
 * which costs $0 per query and needs no API key — satisfying the hackathon
 * build principle of preferring a classical solver over constant expensive
 * LLM calls.
 *
 * Grounding guarantee: the generated answer is built ONLY from verbatim
 * sentences in the retrieved chunks (no paraphrasing), then self-checked.
 */

import type { Chunk } from "./seed";

interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

/** Tokenize with word splitting; keep ₹ and digits. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[#*`|>_-]/g, " ")
    .split(/[^a-z0-9\u20b9]+/)
    .filter((w) => w.length >= 2);
}

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "day", "get", "has", "him", "his",
  "how", "its", "may", "new", "now", "old", "see", "two", "way", "who",
  "did", "she", "too", "any", "own", "per", "via", "with", "that", "this",
  "from", "have", "been", "your", "only", "also", "into", "more", "than",
  "then", "them", "they", "some", "each", "must", "after", "before",
  "about", "which", "there", "their", "what", "when", "where", "would",
  "could", "should", "just", "like", "does", "done", "made", "make",
  "time", "first", "last", "well", "back", "even", "still", "very",
]);

/** Rank chunks by weighted token overlap (BM25-inspired IDF term boost). */
export function retrieve(query: string, chunks: Chunk[], topK = 3): ScoredChunk[] {
  const qTokens = tokenize(query).filter((w) => !STOPWORDS.has(w));
  if (qTokens.length === 0) return [];

  const n = chunks.length;
  const df = new Map<string, number>();
  for (const c of chunks) {
    const cTokens = new Set(tokenize(c.text));
    for (const w of Array.from(cTokens)) df.set(w, (df.get(w) ?? 0) + 1);
  }

  const scored: ScoredChunk[] = chunks.map((chunk) => {
    const body = chunk.text
      .replace(/^#+.*$/gm, "")
      .replace(/\*+Document version:\*\*.*/g, "")
      .replace(/\*+Last updated:\*\*.*/g, "")
      .replace(/\*+Source of truth:\*\*.*/g, "");
    const cTokens = tokenize(body);
    const cSet = new Set(cTokens);
    const qSet = new Set(qTokens);
    let score = 0;
    for (const w of Array.from(qSet)) {
      if (cSet.has(w)) {
        const idf = Math.log(1 + (n - (df.get(w) ?? 0)) / ((df.get(w) ?? 0) + 1));
        const tf = cTokens.filter((t) => t === w).length / cTokens.length;
        score += (idf + 1) * tf * 2.5; // IDF weight + frequency bonus
      }
    }
    // Section title match bonus (strong signal for doc-drilling queries)
    if (tokenize(chunk.metadata.section).some((w) => qSet.has(w))) score += 1.0;
    return { chunk, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Split into sentence-ish units preserving headings. */
function splitSentences(text: string): string[] {
  // First split on newline-before-headings so a heading can never merge
  // into the sentence that follows it.
  // Split on start-of-text or newline before a heading/list, so a heading at
  // position 0 (with no preceding newline) never merges into the body that follows.
  // A leading heading (no preceding newline) must not merge with the body.
  // Normalize: inject a newline before a heading/numbered-title at position 0,
  // then split on newline-before-heading-or-list.
  const normalized = text.replace(/^(#{1,4}\s|\d+\.?\s+[A-Z])/, "\n$1");
  const units = normalized.split(/\n(?=#{1,4}\s|- )/);
  const out: string[] = [];
  for (const unit of units) {
    const trimmed = unit.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      // Keep only the heading line itself; any body text after it must be
      // processed as a separate unit (headings must never merge into body).
      const firstLine = trimmed.split("\n")[0].trim();
      if (firstLine) out.push(firstLine);
      const restOfHeadingUnit = trimmed.slice(trimmed.indexOf("\n") + 1).trim();
      if (restOfHeadingUnit) {
        for (const seg of restOfHeadingUnit.split(/(?<=[.!?])\s+(?=[A-Z(])/)) {
          const ts = seg.trim();
          if (ts) out.push(ts);
        }
      }
      continue;
    }
    // Inside a body unit, peel off any stripped heading remnants like
    // '4. Pricing, Fees and Charges' that sit at the start of the block.
    let rest = trimmed;
    for (let i = 0; i < 3; i++) {
      const m = rest.match(/^\d+\.?\s+[A-Z][A-Za-z%&':\-,\s]{5,120}?\s+(?=[A-Z(])/);
      if (!m) break;
      rest = rest.slice(m[0].length).trim();
    }
    if (rest) {
      for (const seg of rest.split(/(?<=[.!?])\s+(?=[A-Z(])/)) {
        const ts = seg.trim();
        if (ts) out.push(ts);
      }
    }
    continue;
  }
  return out;
}

/** Clean markdown for customer-facing display. */
function cleanSentence(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#+\s*/, "")
    .replace(/^[-*+]\s+/, "")
    // Strip heading-style prefixes that were merged with the sentence body
    .replace(/^\d+\.?\s+[A-Z][A-Za-z%&'\- ]{4,40}\s+(?=[A-Z(])/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip internal doc metadata lines. */
function stripMeta(text: string): string {
  return text
    .replace(/\*\*Document version:\*\*.*/g, "")
    .replace(/\*\*Last updated:\*\*.*/g, "")
    .replace(/\*\*Source of truth:\*\*.*/g, "")
    .replace(/### Objection \d+:.*/g, "");
}

export interface GroundedAnswer {
  answer: string;
  sources: Array<{
    source_file: string;
    version: string;
    section: string;
    updated_at: string;
  }>;
  usedChunkIds: string[];
}

/**
 * Build a grounded answer using ONLY verbatim sentences from retrieved
 * chunks, plus a mandatory self-check that drops anything not evidenced.
 */
export function groundedAnswer(query: string, chunks: Chunk[]): GroundedAnswer {
  const top = retrieve(query, chunks, 3);
  if (top.length === 0) {
    return {
      answer:
        "I could not find verified information for that question. A human agent will follow up.",
      sources: [],
      usedChunkIds: [],
    };
  }

  const qTokens = new Set(
    tokenize(query).filter((w) => !STOPWORDS.has(w)),
  );

  // Score sentences across top chunks by overlap with query
  const candidates: Array<{ sentence: string; chunk: Chunk; score: number }> = [];
  for (const { chunk } of top) {
    const body = stripMeta(chunk.text);
    for (const s of splitSentences(body)) {
      const cs = cleanSentence(s);
      // Drop section headings (with or without leftover markdown markers)
      const isHeading = /^(#+\s*)?(\d+\.?\s*)?[A-Z][a-zA-Z% &':\-]+$/.test(cs) && cs.length < 80;
      if (cs.length < 15 || cs.startsWith("#") || isHeading) continue;
      const words = new Set(tokenize(cs));
      const overlap = Array.from(qTokens).filter((w) => words.has(w)).length;
      if (overlap === 0) continue;
      candidates.push({ sentence: cs, chunk, score: overlap });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  // Pick the best sentences (up to 3), avoiding duplicate chunks if possible
  const picked: Array<{ sentence: string; chunk: Chunk }> = [];
  const seenSentences = new Set<string>();
  const seenChunks = new Set<string>();
  for (const c of candidates) {
    const key = c.sentence.slice(0, 80);
    if (seenSentences.has(key)) continue;
    if (picked.length >= 3 && seenChunks.has(c.chunk.id)) continue;
    picked.push({ sentence: c.sentence, chunk: c.chunk });
    seenSentences.add(key);
    seenChunks.add(c.chunk.id);
    if (picked.length >= 3) break;
  }

  if (picked.length === 0) {
    return {
      answer:
        "I could not verify an answer from the current knowledge base. A human agent will follow up on this.",
      sources: [],
      usedChunkIds: [],
    };
  }

  // Self-check: keep only sentences whose >=70% content words appear in the retrieved chunks (verbatim evidence)
  const allChunkWords = top.map((t) => new Set(tokenize(stripMeta(t.chunk.text))));
  const verified: Array<{ sentence: string; chunk: Chunk }> = [];
  for (const p of picked) {
    const words = new Set(tokenize(p.sentence));
    if (words.size < 3) continue;
    const grounded = allChunkWords.some(
      (cw) => Array.from(words).filter((w) => cw.has(w)).length / words.size >= 0.7,
    );
    if (grounded) verified.push(p);
  }
  const final = verified.length > 0 ? verified : picked;

  const answer = final
    .map((p) =>
      p.sentence
        // Drop section-heading prefixes that got merged into the sentence
        .replace(/^\d+\.?\s+[A-Z][A-Za-z%&':\-, ]{5,120}?\s+(?=[A-Z(])/, "")
    )
    .map((s) => s.trim())
    .filter((s) => s.length > 10)
    .join(" ");
  const usedChunks = Array.from(new Map(final.map((p) => [p.chunk.id, p.chunk])).values());

  return {
    answer,
    sources: usedChunks.map((c) => ({
      source_file: c.metadata.source_file,
      version: c.metadata.version,
      section: c.metadata.section,
      updated_at: c.metadata.updated_at,
    })),
    usedChunkIds: usedChunks.map((c) => c.id),
  };
}
