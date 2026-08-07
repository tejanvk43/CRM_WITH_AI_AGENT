import { z } from "zod";
import { publicProcedure } from "../_core/trpc";
import { allChunks, knowledgeDocuments } from "../knowledge/seed";
import { groundedAnswer } from "../knowledge/retrieval";
import { classifyTurn } from "../knowledge/intent";
import { getDb } from "../db";
import { leads, calls, callTranscripts } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

/**
 * In-memory cost log for the current server session.
 */
export interface CostEntry {
  agent_name: string;
  model_tier: string;
  cost_usd: number;
  detail: string;
  ts: number;
}

export const costLog: CostEntry[] = [];

const logEntry = (agent: string, tier: string, cost: number, detail: string) => {
  const entry: CostEntry = { agent_name: agent, model_tier: tier, cost_usd: cost, detail, ts: Date.now() };
  costLog.push(entry);
  if (costLog.length > 500) costLog.splice(0, costLog.length - 500);
  return entry;
};

// ---------------------------------------------------------------- CRM Mock Store Fallback
interface LeadMemory {
  id: number;
  name: string;
  phone: string;
  email: string;
  status: "lead" | "objection" | "kyc_pending" | "converted" | "lost";
  creditScore: number;
  approvedLimit: number | null;
  notes: string;
  lastCallAt: string | null;
  createdAt: string;
}

const INITIAL_MOCK_LEADS: LeadMemory[] = [
  {
    id: 1,
    name: "Aarav Mehta",
    phone: "+91 98765 43210",
    email: "aarav.mehta@gmail.com",
    status: "lead",
    creditScore: 710,
    approvedLimit: null,
    notes: "Saw our pay-in-3 ad, interested in buying a phone worth ₹25,000.",
    lastCallAt: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 2,
    name: "Priya Sharma",
    phone: "+91 87654 32109",
    email: "priya.sharma@yahoo.com",
    status: "objection",
    creditScore: 685,
    approvedLimit: null,
    notes: "Skeptical about zero interest rate, worried about hidden charges.",
    lastCallAt: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 3,
    name: "Vikram Singh",
    phone: "+91 76543 21098",
    email: "vikram.singh@outlook.com",
    status: "kyc_pending",
    creditScore: 745,
    approvedLimit: null,
    notes: "Wants to proceed but is hesitant about sharing Aadhaar/PAN documents on call.",
    lastCallAt: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 4,
    name: "Neha Gupta",
    phone: "+91 65432 10987",
    email: "neha.gupta@gmail.com",
    status: "converted",
    creditScore: 780,
    approvedLimit: 75000,
    notes: "Onboarded and approved for ₹75,000 credit limit. Repaying on time.",
    lastCallAt: new Date(Date.now() - 3600 * 24 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  },
];

let leadsInMemory = [...INITIAL_MOCK_LEADS];

interface CallMemory {
  id: number;
  leadId: number;
  status: "active" | "completed";
  summary: string;
  overallSentiment: string;
  totalCost: number;
  createdAt: string;
  transcript: Array<{
    id: number;
    speaker: "customer" | "agent" | "copilot";
    text: string;
    intent?: string;
    sentiment?: string;
    assistantResponse?: string;
    nbaSuggestion?: string;
    complianceFlag?: boolean;
    costUsd: number;
    createdAt: string;
  }>;
}

let callsInMemory: CallMemory[] = [];

// ---------------------------------------------------------------- Coached Next Best Action (NBA) Stub
function getNextBestAction(intent: string, text: string): string {
  const t = text.toLowerCase();
  
  if (intent === "objection" || t.includes("charges") || t.includes("fee") || t.includes("hidden")) {
    return "Acknowledge the fee concern. Explain that the ₹199 late fee only applies after a 3-day grace period, and that we charge the merchant, not the customer.";
  }
  if (intent === "kyc_question" || t.includes("documents") || t.includes("aadhaar") || t.includes("pan") || t.includes("paperwork")) {
    return "Reassure the customer about secure, encrypted document storage. Offer to send the secure onboarding link so they can complete verification digitally in 10 minutes.";
  }
  if (intent === "ready_to_convert" || t.includes("proceed") || t.includes("signup") || t.includes("link") || t.includes("lets do it")) {
    return "Express excitement and guide them to click the SMS registration link. Remind them that their pre-approved limit is held active for 7 days.";
  }
  if (intent === "product_question" || t.includes("interest") || t.includes("emi")) {
    return "Confirm that interest is 0% for the full 3 months with zero processing fees. Highlight that early repayment is allowed anytime with no prepayment penalty.";
  }
  
  return "Continue building rapport. Ask if they have a specific purchase in mind to check if they qualify for the ₹3,000 minimum transaction threshold.";
}

// ---------------------------------------------------------------- Compliance Checker Stub
const SENSITIVE_KEYWORDS = [
  "interest rate change",
  "credit limit",
  "loan tenure",
  "approval guarantee",
  "guarantee approval",
  "guarantee my loan",
  "guarantee my approval",
];

function checkCompliance(customerText: string, nbaText: string): boolean {
  const combined = `${customerText} | ${nbaText}`.toLowerCase();
  
  // 1. Keyword check
  for (const kw of SENSITIVE_KEYWORDS) {
    if (combined.includes(kw)) {
      return true;
    }
  }
  
  // 2. Rule simulation for guarantee approval questions
  if (combined.includes("guarantee") && (combined.includes("approval") || combined.includes("approve") || combined.includes("loan"))) {
    return true;
  }
  
  return false;
}

export const copilotRouter = {
  // Original processTurn endpoint for compatibility
  processTurn: publicProcedure
    .input(
      z.object({
        turn: z.string().min(1).max(2000),
      }),
    )
    .mutation(({ input }) => {
      const intentResult = classifyTurn(input.turn);
      const intentEntry = logEntry(
        "intent",
        intentResult.model_tier,
        intentResult.cost_usd,
        input.turn.slice(0, 80),
      );

      const rag = groundedAnswer(input.turn, allChunks);
      const ragEntry = logEntry(
        "rag",
        "cheap",
        0.005,
        input.turn.slice(0, 80),
      );

      const nbaSuggestion = getNextBestAction(intentResult.intent, input.turn);
      const nbaEntry = logEntry("nba", "reasoning", 0.01, input.turn.slice(0, 80));

      const isViolated = checkCompliance(input.turn, nbaSuggestion);
      const compEntry = logEntry("compliance", "cheap", 0.0002, input.turn.slice(0, 80));

      const finalSuggestion = isViolated ? `[human_judgment_required] ${nbaSuggestion}` : nbaSuggestion;

      return {
        turn: input.turn,
        intent: intentResult.intent,
        sentiment: intentResult.sentiment,
        answer: rag.answer,
        sources: rag.sources,
        usedChunkIds: rag.usedChunkIds,
        topChunks: rag.usedChunkIds.length > 0
          ? allChunks.filter((c) => rag.usedChunkIds.includes(c.id))
          : [],
        nbaSuggestion: finalSuggestion,
        complianceFlag: isViolated,
        costEntries: [intentEntry, ragEntry, nbaEntry, compEntry],
      };
    }),

  documents: publicProcedure.query(() =>
    knowledgeDocuments.map((d) => ({
      source_file: d.source_file,
      version: d.version,
      updated_at: d.updated_at,
      chunk_count: d.chunks.length,
    })),
  ),

  chunks: publicProcedure
    .input(z.object({ source_file: z.string() }))
    .query(({ input }) => {
      const doc = knowledgeDocuments.find((d) => d.source_file === input.source_file);
      if (!doc) return [];
      return doc.chunks.map((c) => ({
        id: c.id,
        text: c.text,
        section: c.metadata.section,
        version: c.metadata.version,
        updated_at: c.metadata.updated_at,
      }));
    }),

  costLog: publicProcedure.query(() => ({
    entries: costLog,
    total_usd: costLog.reduce((sum, e) => sum + e.cost_usd, 0),
    call_count: costLog.length,
  })),

  // ---------------------------------------------------------------- CRM Endpoints
  getLeads: publicProcedure.query(async () => {
    const db = await getDb();
    if (db) {
      try {
        const rows = await db.select().from(leads).orderBy(desc(leads.createdAt));
        if (rows.length > 0) return rows;
      } catch (error) {
        console.warn("[Database] Failed to select leads, falling back to memory:", error);
      }
    }
    return leadsInMemory;
  }),

  createLead: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        phone: z.string().min(1),
        email: z.string().email().optional().or(z.literal("")),
        creditScore: z.number().int().min(300).max(900).default(700),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      const email = input.email || null;
      const notes = input.notes || "New prospect lead.";

      if (db) {
        try {
          await db.insert(leads).values({
            name: input.name,
            phone: input.phone,
            email,
            creditScore: input.creditScore,
            notes,
          });
          return { success: true };
        } catch (error) {
          console.warn("[Database] Failed to insert lead, falling back to memory:", error);
        }
      }

      // Memory fallback
      const newId = leadsInMemory.length > 0 ? Math.max(...leadsInMemory.map(l => l.id)) + 1 : 1;
      leadsInMemory.unshift({
        id: newId,
        name: input.name,
        phone: input.phone,
        email: email || "",
        status: "lead",
        creditScore: input.creditScore,
        approvedLimit: null,
        notes,
        lastCallAt: null,
        createdAt: new Date().toISOString(),
      });
      return { success: true };
    }),

  resetCrm: publicProcedure.mutation(async () => {
    const db = await getDb();
    if (db) {
      try {
        await db.delete(callTranscripts);
        await db.delete(calls);
        await db.delete(leads);
        for (const l of INITIAL_MOCK_LEADS) {
          await db.insert(leads).values({
            name: l.name,
            phone: l.phone,
            email: l.email || null,
            status: l.status,
            creditScore: l.creditScore,
            approvedLimit: l.approvedLimit,
            notes: l.notes,
            lastCallAt: l.lastCallAt ? new Date(l.lastCallAt) : null,
          });
        }
        return { success: true };
      } catch (error) {
        console.warn("[Database] Failed to reset DB leads:", error);
      }
    }

    leadsInMemory = [...INITIAL_MOCK_LEADS.map(l => ({ ...l }))];
    callsInMemory = [];
    costLog.length = 0;
    return { success: true };
  }),

  // ---------------------------------------------------------------- Call Dialer Endpoints
  startCall: publicProcedure
    .input(z.object({ leadId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const now = new Date();

      if (db) {
        try {
          await db.insert(calls).values({
            leadId: input.leadId,
            status: "active",
            summary: "Call in progress...",
            overallSentiment: "neutral",
            totalCost: "0.0",
          });

          const rows = await db
            .select({ id: calls.id })
            .from(calls)
            .where(eq(calls.leadId, input.leadId))
            .orderBy(desc(calls.createdAt))
            .limit(1);
          const callId = rows[0]?.id || Math.floor(Math.random() * 100000);

          await db.update(leads).set({ lastCallAt: now }).where(eq(leads.id, input.leadId));

          return { callId };
        } catch (error) {
          console.warn("[Database] Failed to start call, falling back to memory:", error);
        }
      }

      // Memory Fallback
      const callId = callsInMemory.length + 1;
      callsInMemory.push({
        id: callId,
        leadId: input.leadId,
        status: "active",
        summary: "Call in progress...",
        overallSentiment: "neutral",
        totalCost: 0.0,
        createdAt: now.toISOString(),
        transcript: [],
      });

      const lead = leadsInMemory.find(l => l.id === input.leadId);
      if (lead) {
        lead.lastCallAt = now.toISOString();
      }

      // Initialize FastAPI LangGraph State
      try {
        await fetch("http://127.0.0.1:8000/call/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ call_id: callId }),
        });
      } catch (err) {
        console.warn("[FastAPI] Failed to start call:", err);
      }

      return { callId };
    }),

  processCallTurn: publicProcedure
    .input(
      z.object({
        callId: z.number(),
        speaker: z.enum(["customer", "agent"]),
        text: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const { callId, speaker, text } = input;
      const db = await getDb();

      let callObj: any = null;
      let transcriptCount = 0;

      if (db) {
        try {
          const rows = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
          if (rows.length > 0) callObj = rows[0];
        } catch (err) {
          console.warn("[Database] Failed to find call:", err);
        }
      } else {
        callObj = callsInMemory.find(c => c.id === callId);
      }

      if (!callObj) {
        throw new Error(`Call session ${callId} not found.`);
      }

      let intent = "";
      let sentiment = "";
      let answer = "";
      let sources: any[] = [];
      let nbaSuggestion = "";
      let isViolated = false;
      let cost = 0.0;
      let costEntries: any[] = [];

      if (speaker === "customer") {
        try {
          const response = await fetch("http://127.0.0.1:8000/call/turn", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              call_id: callId,
              transcript_text: text,
            }),
          });
          
          if (!response.ok) {
            throw new Error(`FastAPI returned ${response.status}`);
          }
          
          const data = await response.json();
          intent = data.intent;
          nbaSuggestion = data.suggestion;
          answer = data.retrieved_facts && data.retrieved_facts.length > 0 ? data.retrieved_facts[0] : "";
          isViolated = data.compliance_flag;
          cost = data.cost_usd;
          
          const pyEntry = logEntry("langgraph_agent", "mixed", cost, text.slice(0, 80));
          costEntries.push(pyEntry);
          
          if (isViolated) {
            nbaSuggestion = `[human_judgment_required] ${nbaSuggestion}`;
          }
        } catch (err) {
          console.error("FastAPI backend error:", err);
          intent = "error";
          nbaSuggestion = "Failed to reach AI backend.";
        }
      }

      // Persist turn
      if (db) {
        try {
          await db.insert(callTranscripts).values({
            callId,
            speaker,
            text,
            intent: speaker === "customer" ? intent : null,
            sentiment: speaker === "customer" ? sentiment : null,
            assistantResponse: speaker === "customer" ? (answer + " | NBA: " + nbaSuggestion) : null,
            costUsd: cost.toString(),
          });

          const newCost = (parseFloat(callObj.totalCost || "0") + cost).toFixed(4);
          await db.update(calls).set({ totalCost: newCost }).where(eq(calls.id, callId));
        } catch (err) {
          console.warn("[Database] Failed to persist call turn, using in-memory log:", err);
        }
      } else {
        transcriptCount = callObj.transcript.length + 1;
        callObj.transcript.push({
          id: transcriptCount,
          speaker,
          text,
          intent,
          sentiment,
          assistantResponse: answer,
          nbaSuggestion,
          complianceFlag: isViolated,
          costUsd: cost,
          createdAt: new Date().toISOString(),
        });
        callObj.totalCost += cost;
      }

      return {
        speaker,
        text,
        intent,
        sentiment,
        answer,
        sources,
        nbaSuggestion,
        complianceFlag: isViolated,
        cost,
        costEntries,
      };
    }),

  endCall: publicProcedure
    .input(
      z.object({
        callId: z.number(),
        overrideStatus: z.enum(["lead", "objection", "kyc_pending", "converted", "lost"]).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      let callObj: any = null;
      let leadId = 0;
      let transcript: any[] = [];

      if (db) {
        try {
          const callRows = await db.select().from(calls).where(eq(calls.id, input.callId)).limit(1);
          if (callRows.length > 0) {
            callObj = callRows[0];
            leadId = callObj.leadId;
            transcript = await db
              .select()
              .from(callTranscripts)
              .where(eq(callTranscripts.callId, input.callId));
          }
        } catch (err) {
          console.warn("[Database] Failed to get call for ending:", err);
        }
      } else {
        callObj = callsInMemory.find(c => c.id === input.callId);
        if (callObj) {
          leadId = callObj.leadId;
          transcript = callObj.transcript;
        }
      }

      if (!callObj) {
        throw new Error("Call session not found.");
      }

      // Analyze transcript to update Lead status and summary
      let finalStatus: "lead" | "objection" | "kyc_pending" | "converted" | "lost" = "lead";
      let summary = "Customer asked questions about the product.";
      let approvedLimit: number | null = null;

      const intents = transcript.map((t) => t.intent).filter(Boolean);
      const sentiments = transcript.map((t) => t.sentiment).filter(Boolean);

      const hasObjection = intents.includes("objection");
      const hasKyc = intents.includes("kyc_question");
      const hasConvert = intents.includes("ready_to_convert");

      if (hasConvert) {
        finalStatus = "converted";
        approvedLimit = 45000;
        summary = "Customer agreed to the terms and initiated onboarding. Approved for ₹45,000 credit limit.";
      } else if (hasKyc) {
        finalStatus = "kyc_pending";
        summary = "Customer requested KYC documentation details. Onboarding link sent.";
      } else if (hasObjection) {
        finalStatus = "objection";
        summary = "Customer raised objections regarding fees and data safety. Responses were provided.";
      }

      if (input.overrideStatus) {
        finalStatus = input.overrideStatus;
        if (finalStatus === "converted") {
          approvedLimit = 45000;
          summary = "Customer converted via agent override. Onboarding successful.";
        } else if (finalStatus === "lost") {
          summary = "Call ended. Customer is not interested.";
        }
      }

      // Determine overall sentiment
      let overallSentiment = "neutral";
      const negatives = sentiments.filter((s) => s === "negative").length;
      const positives = sentiments.filter((s) => s === "positive").length;
      if (negatives > positives) overallSentiment = "negative";
      else if (positives > negatives) overallSentiment = "positive";

      if (db) {
        try {
          await db
            .update(calls)
            .set({
              status: "completed",
              summary,
              overallSentiment,
            })
            .where(eq(calls.id, input.callId));

          await db
            .update(leads)
            .set({
              status: finalStatus,
              approvedLimit,
              notes: summary,
            })
            .where(eq(leads.id, leadId));
        } catch (err) {
          console.warn("[Database] Failed to write call completion:", err);
        }
      } else {
        callObj.status = "completed";
        callObj.summary = summary;
        callObj.overallSentiment = overallSentiment;

        const leadObj = leadsInMemory.find((l) => l.id === leadId);
        if (leadObj) {
          leadObj.status = finalStatus;
          leadObj.approvedLimit = approvedLimit;
          leadObj.notes = summary;
        }
      }

      // End FastAPI Call
      try {
        await fetch("http://127.0.0.1:8000/call/end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ call_id: input.callId }),
        });
      } catch (err) {
        console.warn("[FastAPI] Failed to end call:", err);
      }

      return {
        success: true,
        status: finalStatus,
        summary,
        approvedLimit,
      };
    }),
};
