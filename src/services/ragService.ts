import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { EmbeddingService } from "./embeddingService";
import { VectorStoreService } from "./vectorStoreService";
import { logger } from "../utils/logger";
import { RAGQueryRequest, RAGQueryResponse, RetrievedDocument } from "../models/types";

const GENERATION_MODEL_ID =
  process.env.GENERATION_MODEL_ID ||
  "anthropic.claude-3-5-sonnet-20241022-v2:0";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

/**
 * RAGService orchestrates the full Retrieval-Augmented Generation pipeline:
 *
 *   1. Embed the user query  (Titan Embed Text V2)
 *   2. Retrieve top-K documents from the vector store  (DynamoDB + cosine sim)
 *   3. Synthesise an answer grounded in the retrieved context  (Claude Sonnet)
 *
 * This is a standard "naive RAG" architecture — a solid baseline for demos
 * and production systems with small-to-medium corpora.
 */
export class RAGService {
  private embeddingService: EmbeddingService;
  private vectorStore: VectorStoreService;
  private bedrockClient: BedrockRuntimeClient;

  constructor(
    embeddingService?: EmbeddingService,
    vectorStore?: VectorStoreService
  ) {
    this.embeddingService = embeddingService ?? new EmbeddingService();
    this.vectorStore = vectorStore ?? new VectorStoreService();
    this.bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });
  }

  async query(request: RAGQueryRequest): Promise<RAGQueryResponse> {
    const startTime = Date.now();
    const topK = request.topK ?? 5;

    // ── Step 1: Embed the query ──────────────────────────────────────────────
    logger.info("RAG pipeline: embedding query", { query: request.query });
    const queryEmbedding = await this.embeddingService.embed(request.query);

    // ── Step 2: Retrieve relevant documents ─────────────────────────────────
    const retrievedDocs = await this.vectorStore.similaritySearch(
      queryEmbedding,
      topK
    );

    const avgSim =
      retrievedDocs.reduce((s, d) => s + d.similarity, 0) /
      (retrievedDocs.length || 1);

    logger.info("RAG pipeline: retrieval complete", {
      retrieved: retrievedDocs.length,
      avgSimilarity: avgSim.toFixed(3),
    });

    // ── Step 3: Generate grounded answer ────────────────────────────────────
    const answer = await this.generateAnswer(request.query, retrievedDocs);

    return {
      query: request.query,
      answer,
      retrievedDocuments: retrievedDocs,
      processingTimeMs: Date.now() - startTime,
      modelId: GENERATION_MODEL_ID,
    };
  }

  private async generateAnswer(
    query: string,
    context: RetrievedDocument[]
  ): Promise<string> {
    const contextBlock = context
      .map(
        (doc, i) =>
          `[Document ${i + 1}]` +
          (doc.category ? ` (category: ${doc.category})` : "") +
          ` | similarity: ${doc.similarity.toFixed(3)}\n` +
          doc.content.substring(0, 1500)
      )
      .join("\n\n---\n\n");

    const prompt = `You are a precise document assistant. Answer the user's question using ONLY the provided documents.
If the documents lack sufficient information, state that clearly rather than guessing.

<documents>
${contextBlock}
</documents>

<question>
${query}
</question>

Instructions:
- Ground every claim in the documents above.
- Cite documents by their [Document N] label when relevant.
- Be concise and factual.`;

    logger.info("RAG pipeline: invoking generation model", {
      modelId: GENERATION_MODEL_ID,
      contextDocuments: context.length,
    });

    const command = new InvokeModelCommand({
      modelId: GENERATION_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const response = await this.bedrockClient.send(command);
    const body = JSON.parse(new TextDecoder().decode(response.body));

    logger.info("RAG pipeline: generation complete");
    return body.content[0].text as string;
  }
}
