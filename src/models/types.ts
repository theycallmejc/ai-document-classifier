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
