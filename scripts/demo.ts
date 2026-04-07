#!/usr/bin/env ts-node
/**
 * RAG Pipeline Demo
 * =================
 * Indexes 5 sample documents, runs 3 RAG queries, then cleans up.
 *
 * Usage:
 *   BASE_URL=https://<api-id>.execute-api.us-east-1.amazonaws.com/dev \
 *     npx ts-node scripts/demo.ts
 *
 * Or against a local SAM / serverless-offline server:
 *   BASE_URL=http://localhost:3000 npx ts-node scripts/demo.ts
 */

const BASE_URL = process.env.BASE_URL;

if (!BASE_URL) {
  console.error("❌  BASE_URL environment variable is required.");
  console.error("    Example: BASE_URL=https://<api>.execute-api.us-east-1.amazonaws.com/dev");
  process.exit(1);
}

// ── Sample documents ──────────────────────────────────────────────────────────

const SAMPLE_DOCUMENTS = [
  {
    id: "demo-invoice-jan",
    content: `INVOICE #INV-2024-001
Vendor: Acme Software Solutions
Bill To: TechCorp Inc.
Date: January 15, 2024
Due Date: February 14, 2024

Services Rendered:
  - Cloud infrastructure consulting (40 hrs @ $150/hr): $6,000.00
  - Security audit and remediation:                     $2,500.00

Subtotal: $8,500.00
Tax (8%): $680.00
Total Due: $9,180.00

Payment terms: Net 30. Late fee: 1.5%/month after due date.`,
  },
  {
    id: "demo-invoice-mar",
    content: `INVOICE #INV-2024-042
Vendor: DataPipeline Corp
Bill To: FinanceHub Ltd.
Date: March 3, 2024
Due Date: April 2, 2024

Services:
  - ETL pipeline development (Q1):    $14,000.00
  - Data quality monitoring setup:     $3,200.00
  - Documentation & training:          $1,800.00

Total Due: $19,000.00
Payment: Wire transfer to account ending 4821.`,
  },
  {
    id: "demo-nda-acme",
    content: `NON-DISCLOSURE AGREEMENT

This Agreement is entered into as of February 1, 2024, between:
  Party A: Acme Software Solutions ("Disclosing Party")
  Party B: TechCorp Inc. ("Receiving Party")

1. CONFIDENTIAL INFORMATION
   Receiving Party agrees to keep all technical specifications, pricing,
   and roadmap information strictly confidential for a period of 3 years.

2. EXCLUSIONS
   Obligations do not apply to information that is publicly available.

3. GOVERNING LAW
   This Agreement shall be governed by the laws of the State of California.

Signed: [Acme Rep]  Date: 2024-02-01
Signed: [TechCorp Rep]  Date: 2024-02-01`,
  },
  {
    id: "demo-report-q1",
    content: `Q1 2024 FINANCIAL SUMMARY REPORT
Prepared by: Finance Department
Date: April 5, 2024

REVENUE
  Product sales:        $4,250,000
  Services:             $1,800,000
  Total Revenue:        $6,050,000

EXPENSES
  Payroll:              $2,100,000
  Infrastructure:         $340,000
  Marketing:              $280,000
  Total Expenses:       $2,720,000

NET INCOME:             $3,330,000
Year-over-year growth:  +18.4%

Key highlights: Cloud migration completed in March reduced infrastructure
costs by 22% compared to Q1 2023.`,
  },
  {
    id: "demo-email-incident",
    content: `FROM: alice.smith@techcorp.com
TO: security-team@techcorp.com
DATE: March 22, 2024 09:14 AM
SUBJECT: Urgent: Suspected phishing attempt — action required

Team,

We received a suspicious email this morning impersonating our CEO. The email
requested an urgent wire transfer of $50,000 to an external account.

The email originated from ceo@techc0rp.com (note: zero, not letter O).

Actions taken so far:
  1. Email quarantined by our mail gateway.
  2. Affected employee notified and credentials reset.
  3. IT notified to block the sender domain.

Please review the attached headers and advise on further steps.

Alice Smith
Head of IT Security`,
  },
];

// ── Sample queries ────────────────────────────────────────────────────────────

const DEMO_QUERIES = [
  {
    label: "Invoice lookup",
    query: "Which invoices are due in 2024 and what are their totals?",
    topK: 3,
  },
  {
    label: "Security incident",
    query: "Was there a phishing or security incident? What happened?",
    topK: 2,
  },
  {
    label: "Financial performance",
    query: "What was the net income and revenue growth in Q1 2024?",
    topK: 2,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(section: string, msg: string) {
  console.log(`\n${"─".repeat(60)}\n  ${section}\n${"─".repeat(60)}\n${msg}`);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} → HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

async function del(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE ${path} → HTTP ${res.status}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log("  AI Document Classifier + RAG Pipeline — Demo");
  console.log(`  Target: ${BASE_URL}`);
  console.log(`${"═".repeat(60)}`);

  // ── Step 1: Index documents ─────────────────────────────────────────────
  log("STEP 1 / 3 — Indexing documents", `Uploading ${SAMPLE_DOCUMENTS.length} sample documents...`);

  const indexed: string[] = [];
  for (const doc of SAMPLE_DOCUMENTS) {
    process.stdout.write(`  Indexing "${doc.id}" ... `);
    const result = await post<{ documentId: string; category: string; embeddingDimensions: number; processingTimeMs: number }>(
      "/index",
      { documentId: doc.id, content: doc.content }
    );
    console.log(`✓  category=${result.category}  dims=${result.embeddingDimensions}  (${result.processingTimeMs}ms)`);
    indexed.push(doc.id);
  }

  console.log(`\n  ${indexed.length} documents indexed.`);

  // ── Step 2: RAG Queries ─────────────────────────────────────────────────
  log("STEP 2 / 3 — Running RAG queries", "");

  for (const q of DEMO_QUERIES) {
    console.log(`\n  [${q.label}]`);
    console.log(`  Query: "${q.query}"`);
    console.log(`  topK:  ${q.topK}`);

    const result = await post<{
      answer: string;
      retrievedDocuments: Array<{ documentId: string; similarity: number; category?: string }>;
      processingTimeMs: number;
      modelId: string;
    }>("/query", { query: q.query, topK: q.topK });

    console.log(`\n  Answer:\n  ${result.answer.replace(/\n/g, "\n  ")}`);
    console.log(`\n  Retrieved (top ${result.retrievedDocuments.length}):`);
    for (const doc of result.retrievedDocuments) {
      console.log(`    • ${doc.documentId}  sim=${doc.similarity.toFixed(3)}  category=${doc.category ?? "—"}`);
    }
    console.log(`\n  Model: ${result.modelId}  |  Time: ${result.processingTimeMs}ms`);
  }

  // ── Step 3: Cleanup ─────────────────────────────────────────────────────
  log("STEP 3 / 3 — Cleanup", "Removing demo documents from vector store...");

  for (const id of indexed) {
    process.stdout.write(`  Deleting "${id}" ... `);
    await del(`/documents/${id}`);
    console.log("✓");
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log("  Demo complete.");
  console.log(`${"═".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("\n❌  Demo failed:", err.message);
  process.exit(1);
});
