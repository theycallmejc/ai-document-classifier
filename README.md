# 🤖 AI Document Classifier — AWS Bedrock + Lambda + TypeScript

[![CI](https://github.com/theycallmejc/ai-document-classifier/actions/workflows/ci.yml/badge.svg)](https://github.com/theycallmejc/ai-document-classifier/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript)](https://typescriptlang.org)
[![AWS Bedrock](https://img.shields.io/badge/AWS-Bedrock%20%7C%20Lambda%20%7C%20S3-FF9900?logo=amazon-aws)](https://aws.amazon.com/bedrock)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A production-grade, serverless document classification system powered by **AWS Bedrock (Claude)**, **Lambda**, and **API Gateway**. Upload any document to S3 and receive an instant AI-powered classification with confidence scores, extracted entities, and sub-categories.

---

## 🏗️ Architecture

```
                    ┌──────────────────────────────────────────┐
                    │             AWS Cloud                     │
                    │                                           │
  Client ──POST───▶ │  API Gateway (HTTP API)                  │
  /classify         │       │                                   │
                    │       ▼                                   │
                    │  Lambda (Node 20 / TypeScript)            │
                    │       │              │                    │
                    │       ▼              ▼                    │
                    │   S3 Bucket    AWS Bedrock                │
                    │  (Documents)   (Claude Haiku)             │
                    │                     │                     │
                    │                     ▼                     │
                    │            Classification Result          │
                    │         + Confidence + Entities           │
                    └──────────────────────────────────────────┘
```

## ✨ Features

- **AI-Powered Classification** — Uses AWS Bedrock (Claude Haiku) to classify documents into 8 categories with confidence scores
- **Entity Extraction** — Automatically extracts dates, organizations, monetary amounts, and key terms
- **S3 Integration** — Accepts S3 keys or raw document content via API
- **Serverless** — Zero infrastructure management, scales to zero, pay-per-invocation
- **TypeScript** — Fully typed codebase with strict mode enabled
- **Structured Logging** — JSON logs optimized for CloudWatch Insights queries
- **Infrastructure as Code** — Complete Terraform for Lambda + API Gateway + S3 + IAM
- **CI/CD** — GitHub Actions pipeline with build, test coverage, and auto-deploy

---

## 📁 Project Structure

```
ai-document-classifier/
├── src/
│   ├── handlers/
│   │   └── classifyHandler.ts      # Lambda entry point
│   ├── services/
│   │   ├── classifierService.ts    # AWS Bedrock integration
│   │   └── s3Service.ts            # S3 document fetching
│   ├── models/
│   │   └── types.ts                # TypeScript interfaces
│   └── utils/
│       └── logger.ts               # Structured JSON logger
├── tests/
│   ├── unit/
│   │   └── classifierService.test.ts
│   └── integration/
├── infra/terraform/
│   └── main.tf                     # Lambda + API GW + S3 + IAM
├── .github/workflows/
│   └── ci.yml                      # Build → Test → Deploy
├── package.json
└── tsconfig.json
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js >= 20
- AWS CLI configured
- AWS Bedrock access enabled in your account (us-east-1)

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
# Package Lambda
npm run package

# Deploy infrastructure
cd infra/terraform
terraform init
terraform apply
```

---

## 📡 API Usage

### Classify a document from S3

```bash
curl -X POST https://<api-id>.execute-api.us-east-1.amazonaws.com/dev/classify \
  -H "Content-Type: application/json" \
  -d '{
    "s3Key": "documents/invoice-jan-2024.txt"
  }'
```

### Classify raw content directly

```bash
curl -X POST https://<api-id>.execute-api.us-east-1.amazonaws.com/dev/classify \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Invoice #12345 from Acme Corp. Amount due: $1,500. Payment due: 2024-01-15"
  }'
```

### Response

```json
{
  "requestId": "abc-123-xyz",
  "category": "INVOICE",
  "confidence": 0.95,
  "subCategories": ["vendor-invoice", "accounts-payable"],
  "extractedEntities": {
    "dates": ["2024-01-15"],
    "organizations": ["Acme Corp"],
    "amounts": ["$1,500"],
    "keyTerms": ["payment due", "invoice number"]
  },
  "processingTimeMs": 1243,
  "modelId": "anthropic.claude-3-haiku-20240307-v1:0"
}
```

---

## 📊 Supported Document Categories

| Category | Examples |
|---|---|
| `INVOICE` | Vendor invoices, billing statements |
| `CONTRACT` | Service agreements, NDAs, SOWs |
| `REPORT` | Financial reports, status updates |
| `EMAIL` | Business correspondence |
| `FORM` | Tax forms, applications |
| `LEGAL` | Court documents, compliance filings |
| `TECHNICAL` | Architecture docs, API specs |
| `OTHER` | Unrecognized document types |

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage
```

Coverage thresholds enforced: **80% lines, 80% functions**

---

## 📈 Real-World Context

This project is based on production patterns used at **Infosys** for enterprise document classification workflows integrating AWS Bedrock and SageMaker. It demonstrates:
- LLM integration in serverless architectures
- Prompt engineering for structured JSON output
- Error handling and graceful fallback for AI responses
- Infrastructure-as-code for ML workloads

---

## 🤝 Contributing

Pull requests welcome. Open an issue first for major changes.

---

## 📄 License

[MIT](LICENSE)

---

> Built by [Jwala Chaubey](https://linkedin.com/in/iamjwalachaubey) — Platform & DevOps Engineer | AWS Bedrock | TypeScript | Serverless | MLOps
