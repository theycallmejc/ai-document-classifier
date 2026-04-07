# AI Document Classifier + RAG Pipeline

[![CI](https://github.com/theycallmejc/ai-document-classifier/actions/workflows/ci.yml/badge.svg)](https://github.com/theycallmejc/ai-document-classifier/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript)](https://typescriptlang.org)
[![AWS Bedrock](https://img.shields.io/badge/AWS-Bedrock%20%7C%20Lambda%20%7C%20DynamoDB-FF9900?logo=amazon-aws)](https://aws.amazon.com/bedrock)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A production-grade, serverless AI system combining **document classification** and a full **Retrieval-Augmented Generation (RAG) pipeline** — all on AWS, all in TypeScript.

Upload documents, ask questions, get grounded answers. No hallucinations. No persistent servers.

---

## What This Demonstrates (for an AI Engineer role)

| Skill | Where it shows up |
|---|---|
| LLM integration & prompt engineering | `classifierService.ts`, `ragService.ts` |
| Embedding models & semantic search | `embeddingService.ts`, `vectorStoreService.ts` |
| RAG architecture (naive → production path) | Full pipeline in `ragService.ts` |
| Serverless / cloud-native ML | Lambda + API Gateway + DynamoDB + Bedrock |
| Infrastructure as Code | `infra/terraform/main.tf` |
| TypeScript strict mode + type safety | All source files |
| Structured logging & observability | `logger.ts` + CloudWatch JSON |
| Testing strategy for AI systems | Unit tests with mocked AWS clients |
| CI/CD for ML workloads | `.github/workflows/ci.yml` |

---

## Architecture

```
                         ┌─────────────────────────────────────────────────┐
                         │                    AWS Cloud                     │
                         │                                                  │
  ── CLASSIFY ──────────▶│  POST /classify                                 │
                         │      │                                           │
                         │      ▼                                           │
                         │  Lambda (classifyHandler)                        │
                         │      │              │                            │
                         │      ▼              ▼                            │
                         │  S3 Bucket    Bedrock: Claude Haiku              │
                         │ (documents)   (classification + entity extract)  │
                         │                                                  │
  ── INDEX ─────────────▶│  POST /index                                    │
                         │      │                                           │
                         │      ▼                                           │
                         │  Lambda (indexHandler)                           │
                         │      │         │          │                      │
                         │      ▼         ▼          ▼                      │
                         │    S3       Bedrock:   Bedrock:                  │
                         │  (fetch)    Claude     Titan Embed V2            │
                         │           (classify)   (512-d embedding)         │
                         │                              │                   │
                         │                              ▼                   │
                         │                         DynamoDB                 │
                         │                       (vector store)             │
                         │                                                  │
  ── QUERY (RAG) ───────▶│  POST /query                                    │
                         │      │                                           │
                         │      ▼                                           │
                         │  Lambda (queryHandler)                           │
                         │      │                                           │
                         │   [1] Embed query (Titan Embed V2)               │
                         │      │                                           │
                         │   [2] Cosine similarity search (DynamoDB Scan)   │
                         │      │                                           │
                         │   [3] Generate grounded answer (Claude Sonnet)   │
                         │      │                                           │
                         │      ▼                                           │
                         │  {"answer": "...", "retrievedDocuments": [...]}  │
                         └─────────────────────────────────────────────────┘
```

---

## RAG Pipeline — How It Works

### The Problem RAG Solves

LLMs have a knowledge cutoff and no access to private documents. RAG solves this by retrieving the most relevant documents at query time and conditioning the model's response on them — eliminating hallucination for domain-specific content.

### Step-by-Step

**1. Indexing** (`POST /index`)
- Fetch document from S3 (or accept inline content)
- **Classify** it with Claude Haiku → assigns a `DocumentCategory`
- **Embed** it with Amazon Titan Embed Text V2 → 512-dimensional float vector
- **Store** document + embedding in DynamoDB

**2. Querying** (`POST /query`)
- **Embed** the user's question with the same Titan model (same vector space)
- **Scan** DynamoDB, compute **cosine similarity** between query and all stored embeddings
- **Rank** by similarity, take top-K results
- **Generate** a grounded answer with Claude Sonnet, injecting the retrieved documents as context

### Why Cosine Similarity?

Titan Embed V2 returns L2-normalised vectors (`normalize: true`), so cosine similarity equals the **dot product** — a single multiply-add per dimension, no square roots needed.

### Scaling Path

| Scale | Approach |
|---|---|
| < 10K docs (this repo) | DynamoDB Scan + in-Lambda ranking |
| 10K–1M docs | Amazon OpenSearch Serverless k-NN index |
| > 1M docs | Dedicated vector DB (Pinecone, Weaviate, pgvector) |

---

## Project Structure

```
ai-document-classifier/
├── src/
│   ├── handlers/
│   │   ├── classifyHandler.ts     # POST /classify — classify any document
│   │   ├── indexHandler.ts        # POST /index   — classify + embed + store
│   │   └── queryHandler.ts        # POST /query   — RAG query endpoint
│   ├── services/
│   │   ├── classifierService.ts   # AWS Bedrock Claude — structured classification
│   │   ├── embeddingService.ts    # AWS Bedrock Titan Embed V2 — dense vectors
│   │   ├── vectorStoreService.ts  # DynamoDB — upsert / cosine similarity search
│   │   ├── ragService.ts          # Orchestrates embed → retrieve → generate
│   │   └── s3Service.ts           # S3 document fetching
│   ├── models/
│   │   └── types.ts               # All TypeScript interfaces
│   └── utils/
│       └── logger.ts              # CloudWatch-optimised structured JSON logging
├── tests/
│   └── unit/
│       ├── classifierService.test.ts
│       ├── embeddingService.test.ts
│       └── ragService.test.ts
├── infra/terraform/
│   └── main.tf                    # S3 + DynamoDB + 3x Lambda + API Gateway + IAM
└── .github/workflows/
    └── ci.yml                     # Build → Test → Coverage → Deploy
```

---

## Quick Start

### Prerequisites

- Node.js >= 20
- AWS CLI configured with Bedrock access enabled (`us-east-1`)
- Terraform >= 1.5

### Local Setup

```bash
git clone https://github.com/theycallmejc/ai-document-classifier.git
cd ai-document-classifier
npm install
npm run build
npm test
```

### Deploy to AWS

```bash
npm run package          # TypeScript build → function.zip
cd infra/terraform
terraform init
terraform apply          # provisions S3, DynamoDB, 3 Lambdas, API Gateway
```

---

## API Reference

### POST /classify — Classify a document

```bash
curl -X POST https://<api>/dev/classify \
  -H "Content-Type: application/json" \
  -d '{"content": "Invoice #12345 from Acme Corp. Total: $1,500."}'
```

```json
{
  "requestId": "abc-123",
  "category": "INVOICE",
  "confidence": 0.95,
  "subCategories": ["vendor-invoice"],
  "extractedEntities": {
    "dates": [],
    "organizations": ["Acme Corp"],
    "amounts": ["$1,500"],
    "keyTerms": ["invoice", "total"]
  },
  "processingTimeMs": 843,
  "modelId": "anthropic.claude-3-haiku-20240307-v1:0"
}
```

---

### POST /index — Index a document into the RAG store

```bash
curl -X POST https://<api>/dev/index \
  -H "Content-Type: application/json" \
  -d '{
    "documentId": "invoice-jan-2024",
    "content": "Invoice #12345 from Acme Corp. Total: $1,500. Due: 2024-01-15."
  }'
```

```json
{
  "documentId": "invoice-jan-2024",
  "success": true,
  "embeddingDimensions": 512,
  "category": "INVOICE",
  "processingTimeMs": 1420
}
```

---

### POST /query — Ask a question (RAG)

```bash
curl -X POST https://<api>/dev/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What invoices are due in January 2024?", "topK": 3}'
```

```json
{
  "requestId": "xyz-789",
  "query": "What invoices are due in January 2024?",
  "answer": "Based on [Document 1], Invoice #12345 from Acme Corp for $1,500 is due on 2024-01-15.",
  "retrievedDocuments": [
    {
      "documentId": "invoice-jan-2024",
      "content": "Invoice #12345 from Acme Corp...",
      "similarity": 0.934,
      "category": "INVOICE"
    }
  ],
  "processingTimeMs": 2310,
  "modelId": "anthropic.claude-3-5-sonnet-20241022-v2:0"
}
```

---

## Supported Document Categories

| Category | Examples |
|---|---|
| `INVOICE` | Vendor invoices, billing statements |
| `CONTRACT` | Service agreements, NDAs, SOWs |
| `REPORT` | Financial reports, status updates |
| `EMAIL` | Business correspondence |
| `FORM` | Tax forms, applications |
| `LEGAL` | Court documents, compliance filings |
| `TECHNICAL` | Architecture docs, API specs |
| `OTHER` | Unrecognised types (fallback) |

---

## Models Used

| Model | Provider | Purpose |
|---|---|---|
| `claude-3-haiku-20240307` | Anthropic via Bedrock | Document classification + entity extraction |
| `claude-3-5-sonnet-20241022-v2` | Anthropic via Bedrock | RAG answer generation |
| `titan-embed-text-v2` | Amazon Bedrock | 512-d dense embeddings for semantic search |

---

## Testing

```bash
npm test                 # all unit tests
npm run test:coverage    # coverage report (80% threshold enforced)
```

Tests use Jest with full AWS SDK mocking — no real AWS calls, no API keys needed locally.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AWS_REGION` | `us-east-1` | AWS region |
| `BEDROCK_MODEL_ID` | Claude Haiku | Classification model |
| `GENERATION_MODEL_ID` | Claude Sonnet | RAG generation model |
| `EMBEDDING_MODEL_ID` | Titan Embed V2 | Embedding model |
| `DOCUMENTS_BUCKET` | — | S3 bucket for source docs |
| `VECTOR_STORE_TABLE` | — | DynamoDB table name |
| `LOG_LEVEL` | `info` | Set to `debug` for verbose logs |

---

## License

[MIT](LICENSE)

---

> Built by [Jwala Chaubey](https://linkedin.com/in/iamjwalachaubey) — AI/Platform Engineer | AWS Bedrock | RAG Pipelines | TypeScript | Serverless
