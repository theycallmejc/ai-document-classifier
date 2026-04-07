import {
  DynamoDBClient,
  PutItemCommand,
  ScanCommand,
  DeleteItemCommand,
} from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { logger } from "../utils/logger";
import { VectorDocument, RetrievedDocument } from "../models/types";

const TABLE_NAME =
  process.env.VECTOR_STORE_TABLE || "ai-doc-classifier-vectors";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

/**
 * DynamoDB-backed vector store with in-Lambda cosine similarity search.
 *
 * Architecture note: This is appropriate for datasets up to ~10K documents.
 * For larger scale, replace the Scan + in-memory ranking with an
 * OpenSearch k-NN index or Amazon Aurora pgvector.
 */
export class VectorStoreService {
  private client: DynamoDBClient;

  constructor() {
    this.client = new DynamoDBClient({ region: AWS_REGION });
  }

  /** Upsert a document + its embedding into the vector store. */
  async upsert(doc: VectorDocument): Promise<void> {
    logger.info("Upserting document to vector store", {
      documentId: doc.documentId,
      embeddingDimensions: doc.embedding.length,
    });

    const command = new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall({
        documentId: doc.documentId,
        content: doc.content,
        embedding: JSON.stringify(doc.embedding),
        metadata: JSON.stringify(doc.metadata ?? {}),
        category: doc.category ?? "OTHER",
        indexedAt: new Date().toISOString(),
      }),
    });

    await this.client.send(command);
    logger.info("Document indexed successfully", { documentId: doc.documentId });
  }

  /**
   * Retrieve the top-K most similar documents using cosine similarity.
   * Embeddings from Titan V2 with `normalize: true` are L2-normalised,
   * so cosine similarity equals the dot product.
   */
  async similaritySearch(
    queryEmbedding: number[],
    topK = 5
  ): Promise<RetrievedDocument[]> {
    logger.info("Running similarity search", { topK });

    const result = await this.client.send(new ScanCommand({ TableName: TABLE_NAME }));
    const items = (result.Items ?? []).map((item) => unmarshall(item));

    const scored: RetrievedDocument[] = items.map((item) => ({
      documentId: item.documentId as string,
      content: item.content as string,
      similarity: cosineSimilarity(
        queryEmbedding,
        JSON.parse(item.embedding as string) as number[]
      ),
      metadata: JSON.parse(item.metadata as string) as Record<string, unknown>,
      category: item.category as string,
    }));

    scored.sort((a, b) => b.similarity - a.similarity);
    const topResults = scored.slice(0, topK);

    logger.info("Similarity search complete", {
      totalDocs: items.length,
      returned: topResults.length,
      topScore: topResults[0]?.similarity ?? 0,
    });

    return topResults;
  }

  /** Remove a document from the vector store. */
  async delete(documentId: string): Promise<void> {
    await this.client.send(
      new DeleteItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ documentId }),
      })
    );
    logger.info("Document removed from vector store", { documentId });
  }
}

/** Dot-product cosine similarity (works on L2-normalised vectors). */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
