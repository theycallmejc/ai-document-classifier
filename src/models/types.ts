export type DocumentCategory =
  | "INVOICE"
  | "CONTRACT"
  | "REPORT"
  | "EMAIL"
  | "FORM"
  | "LEGAL"
  | "TECHNICAL"
  | "OTHER";

export interface ClassificationRequest {
  s3Key?: string;
  content?: string;
  documentType?: string;
  metadata?: Record<string, string>;
}

export interface ClassificationResponse {
  requestId: string;
  category: DocumentCategory;
  confidence: number;
  subCategories: string[];
  extractedEntities: ExtractedEntities;
  processingTimeMs: number;
  modelId: string;
}

export interface ExtractedEntities {
  dates?: string[];
  organizations?: string[];
  amounts?: string[];
  keyTerms?: string[];
}

export interface ClassifyInput {
  content: string;
  documentType?: string;
  metadata?: Record<string, string>;
}

export interface ClassificationResult {
  category: DocumentCategory;
  confidence: number;
  subCategories: string[];
  extractedEntities: ExtractedEntities;
  processingTimeMs: number;
  modelId: string;
}

// ── RAG Pipeline Types ────────────────────────────────────────────────────────

export interface VectorDocument {
  documentId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
  category?: DocumentCategory;
}

export interface IndexRequest {
  documentId: string;
  s3Key?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface IndexResponse {
  documentId: string;
  success: boolean;
  embeddingDimensions: number;
  category: DocumentCategory;
  processingTimeMs: number;
}

export interface RAGQueryRequest {
  query: string;
  topK?: number;
}

export interface RetrievedDocument {
  documentId: string;
  content: string;
  similarity: number;
  metadata?: Record<string, unknown>;
  category?: string;
}

export interface RAGQueryResponse {
  query: string;
  answer: string;
  retrievedDocuments: RetrievedDocument[];
  processingTimeMs: number;
  modelId: string;
}
