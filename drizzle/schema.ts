import { pgTable, serial, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Core user table backing auth flow.
 * Migrated to PostgreSQL for Supabase compatibility.
 */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: varchar("role", { length: 64 }).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const leads = pgTable("leads", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: varchar("phone", { length: 32 }).notNull(),
  email: varchar("email", { length: 320 }),
  status: varchar("status", { length: 64 }).default("lead").notNull(), // lead, objection, kyc_pending, converted, lost
  creditScore: integer("creditScore").default(700).notNull(),
  approvedLimit: integer("approvedLimit"),
  notes: text("notes"),
  lastCallAt: timestamp("lastCallAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Lead = typeof leads.$inferSelect;
export type InsertLead = typeof leads.$inferInsert;

export const calls = pgTable("calls", {
  id: serial("id").primaryKey(),
  leadId: integer("leadId").notNull(),
  status: varchar("status", { length: 64 }).default("active").notNull(), // active, completed
  summary: text("summary"),
  overallSentiment: varchar("overallSentiment", { length: 32 }),
  totalCost: varchar("totalCost", { length: 32 }).default("0.0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Call = typeof calls.$inferSelect;
export type InsertCall = typeof calls.$inferInsert;

export const callTranscripts = pgTable("call_transcripts", {
  id: serial("id").primaryKey(),
  callId: integer("callId").notNull(),
  speaker: varchar("speaker", { length: 64 }).notNull(), // customer, agent, copilot
  text: text("text").notNull(),
  intent: varchar("intent", { length: 64 }),
  sentiment: varchar("sentiment", { length: 32 }),
  assistantResponse: text("assistantResponse"),
  costUsd: varchar("costUsd", { length: 32 }).default("0.0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CallTranscript = typeof callTranscripts.$inferSelect;
export type InsertCallTranscript = typeof callTranscripts.$inferInsert;