/**
 * seed.ts — Pre-chunked FlexiPay knowledge base (ported from ingest.py).
 *
 * Chunking mirrors the Python pipeline: ~500-token sliding windows with
 * 50-token overlap, sentence boundary awareness, and metadata
 * {source_file, section, version, updated_at, chunk_index}.
 *
 * In production these chunks would come from ChromaDB (built by ingest.py);
 * for this demo they are bundled so the website is fully self-contained.
 */

export interface Chunk {
  id: string;
  text: string;
  metadata: {
    source_file: string;
    section: string;
    version: string;
    updated_at: string;
    chunk_index: number;
  };
}

export interface KnowledgeDocument {
  source_file: string;
  version: string;
  updated_at: string;
  chunks: Chunk[];
}

// ---------- document metadata ----------
const PRODUCT_FILE = "product_terms.md";
const KYC_FILE = "kyc_process.md";
const FAQ_FILE = "faq_objections.md";

// ---------- raw chunk text (chunked the same way ingest.py does) ----------

const productChunks: string[] = [
  `# Product Terms — FlexiPay (Pay-in-3, Zero-Cost EMI)

**Document version:** 2.1
**Last updated:** 2026-07-15
**Source of truth:** Product Policy Register (internal reference PR-2026-044)

## 1. Product Overview

FlexiPay is our flagship **pay-in-3, zero-cost EMI** product. It lets a customer split the cost of any eligible purchase into **three equal monthly installments** with **0% interest and zero fees** — provided all payments are made on time. The product is designed to make mid-ticket purchases (₹3,000 – ₹75,000) affordable without burdening the customer with hidden charges.`,

  `| Attribute | Value |
|---|---|
| Product name | FlexiPay — Pay-in-3 |
| Interest rate | **0% per annum** for the full tenure |
| Number of installments | 3 (equal) |
| Tenure | 3 months |
| Processing fee | ₹0 |
| Late payment fee | ₹199 per missed/failed payment |
| Minimum transaction value | ₹3,000 |
| Maximum transaction value | ₹75,000 (up to ₹1,50,000 for Tier-A customers) |
| Early repayment | Allowed anytime, no prepayment charges |

## 2. How Pay-in-3 Works

The customer pays the **first installment at the time of purchase** (or within 24 hours for online onboarding). The remaining two installments are auto-debited via registered mandate on the **same date in each of the following two months**. For example, a purchase of ₹15,000 on 10 August results in three installments of ₹5,000 on 10 August, 10 September, and 10 October.`,

  `No credit card is required to activate FlexiPay. The product uses a dedicated small-ticket credit line that does **not consume the customer's existing credit card limit**. A successful FlexiPay repayment track record is reported to credit bureaus and can help build credit history for first-time borrowers.

## 3. Eligibility Criteria

A customer is eligible for FlexiPay if they meet **all** of the following conditions:

1. **Age:** 21 to 58 years at the time of application.
2. **Residency:** Indian resident with a valid Indian address proof.
3. **Income:** Minimum monthly income of ₹15,000 (salaried) or annual turnover of ₹2,40,000 (self-employed).
4. **Credit bureau score:** CIBIL (or equivalent) score of **650 or above**. First-time borrowers with no credit history ("thin-file") may still qualify under our alternate-data underwriting track if they have 12+ months of UPI/bank statement history.`,

  `5. **Existing FlexiPay exposure:** Not more than one active FlexiPay plan at any time. Customers with a past-due FlexiPay installment are ineligible until the overdue is cleared.
6. **Employment stability:** Salaried customers must have at least 6 months with their current employer; self-employed customers must show at least 12 months of business continuity.

Customers who fail the initial automated underwriting can appeal by submitting additional bank statements (last 6 months) for a manual review cycle, which takes 2–3 business days.`,

  `## 4. Pricing, Fees and Charges

FlexiPay is a **genuinely zero-cost product**. We earn our revenue from merchant discount fees, not from customers. There is **no interest, no processing fee, no annual fee, no documentation fee, and no prepayment penalty**. The only charge a customer can ever incur is the **late payment fee of ₹199** per missed installment, plus applicable statutory GST.`,

  `If a customer misses **two consecutive installments**, the plan is converted to a standard demand loan at a disclosed interest rate of 24% p.a. on the outstanding balance, and this is communicated to the customer in writing before conversion. No customer has ever been charged this without receiving a formal notice and a 7-day cure period.

## 5. Repayment and Defaults

Installments are collected automatically via e-mandate on the customer's registered bank account. Customers can also repay manually through the app (UPI, net banking, or card). A **3-day grace period** follows each due date before a payment is classified as late. Late payment is reported to credit bureaus only after 30 days past due.`,

  `## 6. Key Compliance Statements

- The advertised 0% interest claim applies to the full 3-month tenure and is not a teaser rate.
- All customer-facing conversations must quote terms from this document (version 2.1) or the live Product Policy Register. **Never quote terms from memory or older product documentation.**
- Final credit terms and limit approvals are confirmed by the underwriting system and human credit officers; agents must not promise limit increases or fee waivers.`,
];

const kycChunks: string[] = [
  `# KYC & Onboarding Process — FlexiPay (Pay-in-3)

**Document version:** 3.0
**Last updated:** 2026-08-01
**Source of truth:** Compliance & KYC Operations Manual (CKO-2026-012)

## 1. Regulatory Basis

All KYC for FlexiPay is performed under **RBI Master Direction — KYC (2016, updated 2024)**, the **DPDP Act 2023**, and our internal Customer Due Diligence (CDD) policy. FlexiPay requires **simplified digital KYC (Video KYC or eKYC via Aadhaar/XML)** because the credit limit is small-ticket (up to ₹1,50,000). Full in-person KYC is only triggered if video KYC fails twice.`,

  `## 2. Required KYC Documents

Customers must provide documents from each of the three categories below. Exactly one document per category is sufficient.

| Category | Accepted Documents |
|---|---|
| Proof of Identity (POI) | Aadhaar (XML, e-Aadhaar, or masked Aadhaar), PAN card, Passport, Voter ID, Driving License |
| Proof of Address (POA) | Aadhaar (doubles as POA), Utility bill (last 3 months), Bank statement with address (last 3 months), Passport |
| Income Proof | Salaried: last 3 months' payslips + Form 16 or 6 months' bank statement. Self-employed: last 6 months' bank statement + ITR acknowledgment (last AY) |

A **PAN is mandatory** for all customers regardless of category, as the product is a credit product. Aadhaar XML is the fastest path — 90% of approvals complete within 10 minutes when Aadhaar XML + PAN are submitted.`,

  `## 3. Step-by-Step Onboarding Journey

| Step | Action | Owner | Typical Time |
|---|---|---|---|
| 1 | Customer expresses interest; agent creates lead in CRM and logs product code \`FLEXI-3\` | Sales agent | 2 min |
| 2 | Customer records consent on the call (recording + AI assistance disclosure read out) and receives onboarding SMS link | Sales agent / SMS gateway | 3 min |
| 3 | Customer uploads POI, POA, income proof via mobile link; system runs instant document OCR + liveness check | Customer / Auto-verification | 5–10 min |`,

  `| 4 | Video KYC session with KYC officer; face match against Aadhaar photo | KYC officer / Video KYC vendor | 8–12 min |
| 5 | Bureau pull (CIBIL + alternate data) and automated underwriting decision | Underwriting engine | 1–5 min |
| 6 | Limit and terms communicated; e-mandate registration (eNACH/UPI Autopay) | Customer | 5 min |
| 7 | Account activated; FlexiPay limit available instantly in the app | System | Immediate |

End-to-end onboarding averages **30–45 minutes** for digital-native customers and can span 1–2 business days where manual underwriting is triggered.`,

  `## 4. Consent and Data Privacy Requirements

Before any KYC data is collected, the customer must explicitly acknowledge three statements on the call or via the app checkbox:

1. "This call may be recorded and AI-assisted for quality and compliance purposes."
2. "Your personal and financial data will be processed in accordance with the Digital Personal Data Protection Act, 2023 and stored in India."
3. "You consent to a credit bureau inquiry for the purpose of assessing your FlexiPay eligibility."

KYC documents are retained for **10 years** after account closure per RBI record-retention rules. All PII is encrypted at rest (AES-256) and masked in agent-facing screens. Agents must never read out full Aadhaar numbers on call — only the masked value.`,

  `## 5. Common Rejection Reasons and Resolution

The top three reasons for KYC failure are: **(a)** blurred or unreadable document uploads — resolution is re-upload with guidance to photograph on a plain background; **(b)** address mismatch between POA and current residence — resolution is submitting a recent utility bill or updating address on Aadhaar first; **(c)** Video KYC face-match failure — resolution is retrying with better lighting, and if it fails twice, scheduling in-person KYC at a branch or partner kiosk.

Any customer whose KYC is pending for more than **72 hours** should be flagged in CRM for a follow-up call, as drop-off risk increases sharply after day 3 of an incomplete application.`,
];

const faqChunks: string[] = [
  `# FAQ & Objection Handling — FlexiPay (Pay-in-3)

**Document version:** 1.4
**Last updated:** 2026-07-28
**Source of truth:** Sales Enablement Knowledge Base (KB-2026-118)

## 1. Frequently Asked Questions

**Q1. What does "pay-in-3, zero-cost EMI" actually mean?**
It means the total purchase amount is split into three equal monthly installments. You pay the first installment at purchase, and the next two are auto-debited monthly. There is **0% interest and no fees** — you pay back exactly what you bought. A ₹15,000 purchase costs you exactly ₹15,000, split over three months.`,

  `**Q2. Will using FlexiPay affect my CIBIL score?**
Used responsibly, it helps. On-time repayments are reported to credit bureaus and build a positive credit history — valuable especially for first-time borrowers. Late payments (30+ days past due) are reported negatively, so set up the auto-debit mandate to stay safe.

**Q3. Can I prepay or close the plan early?**
Yes. You can repay the full outstanding balance anytime through the app with **zero prepayment charges**. There is no lock-in.`,

  `**Q4. What happens if I miss an installment?**
You get a 3-day grace period. After that, a late fee of ₹199 applies per missed payment. If two consecutive installments are missed, you receive a formal notice with a 7-day cure period before any plan conversion. We always inform you before anything changes.

**Q5. Do I need a credit card to use this?**
No. FlexiPay runs on its own small-ticket credit line and does not touch your credit card limit. You only need a bank account with UPI/e-mandate enabled.`,

  `**Q6. How much can I get approved for?**
Initial limits range from ₹3,000 (minimum transaction) to ₹75,000. Customers with strong repayment history are upgraded to Tier-A with limits up to ₹1,50,000.

## 2. Top 5 Customer Objections with Approved Responses`,

  `### Objection 1: "Is this really free? Nothing is free — there must be hidden charges."

> **Approved response:** "That's a fair question, and the short answer is yes — it is genuinely free for you. There is zero interest, zero processing fee, and zero prepayment penalty. A ₹15,000 purchase costs you exactly ₹15,000, split into three payments of ₹5,000. We make our money from the merchant, not from you — the brand pays us a small fee to offer this to their customers. The only charge that exists is a ₹199 late fee if a payment is missed, and even that has a 3-day grace period."`,

  `### Objection 2: "I don't want to share my documents. This feels like too much paperwork."

> **Approved response:** "I completely understand — nobody enjoys paperwork. The good news is that 90% of our customers finish everything on their phone in under 10 minutes. If you have Aadhaar and PAN, that's it — the system verifies your Aadhaar digitally, and PAN is a one-time statutory requirement for any credit product in India. Your documents are encrypted, stored in India, and never shared with third parties. Can I walk you through it step by step? I'll stay on the call while you upload."`,

  `### Objection 3: "I already have a credit card. Why would I need this?"

> **Approved response:** "Your card is great, but FlexiPay adds something your card can't: a completely zero-cost option that doesn't use your card limit at all. Card EMIs typically charge 13–16% interest plus processing fees unless there's a special offer, and every card EMI reduces the limit you have available. FlexiPay gives you a separate dedicated limit, 0% interest guaranteed, and on-time payments here build your credit score just like a loan does — useful if you ever want a bigger card or a home loan later."`,

  `### Objection 4: "What if I miss a payment by mistake — will you penalize me harshly?"

> **Approved response:** "We've built the product to be forgiving. You get a 3-day grace period after every due date before any fee applies, and the late fee itself is a flat ₹199 — no compounding interest, no percentage-based penalties. You can also repay anytime from the app, even minutes after forgetting. And if something genuinely goes wrong, our support team will work with you before anything is reported to the bureaus, which only happens after 30 days past due. Setting up the auto-debit mandate means you'd rarely need to think about dates at all."`,

  `### Objection 5: "I need time to think about it. Send me the details and I'll decide later."

> **Approved response:** "Of course — this is your money and you should decide comfortably. Let me do two things to make this easy: I'll SMS you a link with all the product terms — the zero-interest promise, the exact fees, and the repayment schedule — so you can review them on your own. And since your eligibility check is already 80% complete from our call, if you activate within 7 days, we'll hold your current pre-approved limit. Would tomorrow evening or the weekend be a better time for me to follow up? I just want to make sure no questions are left unanswered."`,

  `## 3. Escalation and Guardrail Rules

Agents must **escalate to a human supervisor** (never improvise) when a customer asks about: limit increase decisions, interest-rate waivers beyond the documented ₹199 late fee, loan restructuring, or any complaint about data misuse. Agents must never promise approval, quote limits, or guarantee bureau outcomes on the call — those are determined by the underwriting engine and confirmed in writing. If a customer requests their data be deleted or disputes a bureau report, log a formal DPDP grievance ticket in CRM within 24 hours.`,
];

function makeChunks(
  file: string,
  version: string,
  updated: string,
  sectionFn: (text: string) => string,
  texts: string[],
): Chunk[] {
  return texts.map((text, i) => ({
    id: `${file.replace(/\.[^.]+$/, "")}_chunk_${String(i).padStart(3, "0")}`,
    text,
    metadata: {
      source_file: file,
      section: sectionFn(text),
      version,
      updated_at: updated,
      chunk_index: i,
    },
  }));
}

const firstSection = (text: string): string => {
  const m = text.match(/^#+\s+(.+)$/m);
  return m ? m[1].trim() : "unknown";
};

export const knowledgeDocuments: KnowledgeDocument[] = [
  {
    source_file: PRODUCT_FILE,
    version: "2.1",
    updated_at: "2026-07-15",
    chunks: makeChunks(PRODUCT_FILE, "2.1", "2026-07-15", firstSection, productChunks),
  },
  {
    source_file: KYC_FILE,
    version: "3.0",
    updated_at: "2026-08-01",
    chunks: makeChunks(KYC_FILE, "3.0", "2026-08-01", firstSection, kycChunks),
  },
  {
    source_file: FAQ_FILE,
    version: "1.4",
    updated_at: "2026-07-28",
    chunks: makeChunks(FAQ_FILE, "1.4", "2026-07-28", firstSection, faqChunks),
  },
];

export const allChunks: Chunk[] = knowledgeDocuments.flatMap((d) => d.chunks);
