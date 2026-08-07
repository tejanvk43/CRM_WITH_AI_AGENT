# KYC & Onboarding Process — FlexiPay (Pay-in-3)

**Document version:** 3.0
**Last updated:** 2026-08-01
**Source of truth:** Compliance & KYC Operations Manual (CKO-2026-012)

## 1. Regulatory Basis

All KYC for FlexiPay is performed under **RBI Master Direction — KYC (2016, updated 2024)**, the **DPDP Act 2023**, and our internal Customer Due Diligence (CDD) policy. FlexiPay requires **simplified digital KYC (Video KYC or eKYC via Aadhaar/XML)** because the credit limit is small-ticket (up to ₹1,50,000). Full in-person KYC is only triggered if video KYC fails twice.

## 2. Required KYC Documents

Customers must provide documents from each of the three categories below. Exactly one document per category is sufficient.

| Category | Accepted Documents |
|---|---|
| Proof of Identity (POI) | Aadhaar (XML, e-Aadhaar, or masked Aadhaar), PAN card, Passport, Voter ID, Driving License |
| Proof of Address (POA) | Aadhaar (doubles as POA), Utility bill (last 3 months), Bank statement with address (last 3 months), Passport |
| Income Proof | Salaried: last 3 months' payslips + Form 16 or 6 months' bank statement. Self-employed: last 6 months' bank statement + ITR acknowledgment (last AY) |

A **PAN is mandatory** for all customers regardless of category, as the product is a credit product. Aadhaar XML is the fastest path — 90% of approvals complete within 10 minutes when Aadhaar XML + PAN are submitted.

## 3. Step-by-Step Onboarding Journey

| Step | Action | Owner | Typical Time |
|---|---|---|---|
| 1 | Customer expresses interest; agent creates lead in CRM and logs product code `FLEXI-3` | Sales agent | 2 min |
| 2 | Customer records consent on the call (recording + AI assistance disclosure read out) and receives onboarding SMS link | Sales agent / SMS gateway | 3 min |
| 3 | Customer uploads POI, POA, income proof via mobile link; system runs instant document OCR + liveness check | Customer / Auto-verification | 5–10 min |
| 4 | Video KYC session with KYC officer; face match against Aadhaar photo | KYC officer / Video KYC vendor | 8–12 min |
| 5 | Bureau pull (CIBIL + alternate data) and automated underwriting decision | Underwriting engine | 1–5 min |
| 6 | Limit and terms communicated; e-mandate registration (eNACH/UPI Autopay) | Customer | 5 min |
| 7 | Account activated; FlexiPay limit available instantly in the app | System | Immediate |

End-to-end onboarding averages **30–45 minutes** for digital-native customers and can span 1–2 business days where manual underwriting is triggered.

## 4. Consent and Data Privacy Requirements

Before any KYC data is collected, the customer must explicitly acknowledge three statements on the call or via the app checkbox:

1. "This call may be recorded and AI-assisted for quality and compliance purposes."
2. "Your personal and financial data will be processed in accordance with the Digital Personal Data Protection Act, 2023 and stored in India."
3. "You consent to a credit bureau inquiry for the purpose of assessing your FlexiPay eligibility."

KYC documents are retained for **10 years** after account closure per RBI record-retention rules. All PII is encrypted at rest (AES-256) and masked in agent-facing screens. Agents must never read out full Aadhaar numbers on call — only the masked value.

## 5. Common Rejection Reasons and Resolution

The top three reasons for KYC failure are: **(a)** blurred or unreadable document uploads — resolution is re-upload with guidance to photograph on a plain background; **(b)** address mismatch between POA and current residence — resolution is submitting a recent utility bill or updating address on Aadhaar first; **(c)** Video KYC face-match failure — resolution is retrying with better lighting, and if it fails twice, scheduling in-person KYC at a branch or partner kiosk.

Any customer whose KYC is pending for more than **72 hours** should be flagged in CRM for a follow-up call, as drop-off risk increases sharply after day 3 of an incomplete application.
