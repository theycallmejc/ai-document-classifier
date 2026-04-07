import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { DocumentClassifierService } from "../services/classifierService";
import { EmbeddingService } from "../services/embeddingService";
import { VectorStoreService } from "../services/vectorStoreService";
import { S3Service } from "../services/s3Service";
import { logger } from "../utils/logger";
import { IndexRequest, IndexResponse } from "../models/types";

const classifierService = new DocumentClassifierService();
const embeddingService = new EmbeddingService();
const vectorStore = new VectorStoreService();
const s3Service = new S3Service();

/**
 * Lambda handler for document indexing  (POST /index)
 *
 * Pipeline:
 *   1. Fetch document content from S3 or use inline content
 *   2. Classify the document to determine its category (Bedrock Claude)
 *   3. Generate a dense vector embedding (Bedrock Titan Embed V2)
 *   4. Store the document + embedding in DynamoDB
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const requestId = context.awsRequestId;
  logger.info("Document index request received", { requestId });

  try {
    const body = JSON.parse(event.body || "{}") as IndexRequest;

    if (!body.documentId) {
      return errorResponse(400, "documentId is required", requestId);
    }
    if (!body.s3Key && !body.content) {
      return errorResponse(400, "Either s3Key or content is required", requestId);
    }

    let content = body.content;
    if (body.s3Key) {
      logger.info("Fetching document from S3", { s3Key: body.s3Key });
      content = await s3Service.getDocument(body.s3Key);
    }

    if (!content) {
      return errorResponse(404, "Document content could not be retrieved", requestId);
    }

    const startTime = Date.now();

    // Classify and embed in parallel — both are independent Bedrock calls
    const [classification, embedding] = await Promise.all([
      classifierService.classify({ content }),
      embeddingService.embed(content),
    ]);

    await vectorStore.upsert({
      documentId: body.documentId,
      content,
      embedding,
      metadata: body.metadata,
      category: classification.category,
    });

    const response: IndexResponse = {
      documentId: body.documentId,
      success: true,
      embeddingDimensions: embedding.length,
      category: classification.category,
      processingTimeMs: Date.now() - startTime,
    };

    logger.info("Document indexed successfully", {
      requestId,
      documentId: body.documentId,
      category: classification.category,
      dims: embedding.length,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error("Indexing failed", { requestId, error });
    return errorResponse(500, "Internal indexing error", requestId);
  }
};

const errorResponse = (
  statusCode: number,
  message: string,
  requestId: string
): APIGatewayProxyResult => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ error: message, requestId }),
});
