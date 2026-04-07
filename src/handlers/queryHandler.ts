import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { RAGService } from "../services/ragService";
import { logger } from "../utils/logger";
import { RAGQueryRequest } from "../models/types";

const ragService = new RAGService();

/**
 * Lambda handler for RAG queries  (POST /query)
 *
 * Full pipeline:
 *   1. Embed the user query  (Titan Embed Text V2)
 *   2. Retrieve top-K semantically similar documents  (DynamoDB + cosine sim)
 *   3. Generate a grounded answer  (Claude Sonnet via Bedrock)
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const requestId = context.awsRequestId;
  logger.info("RAG query request received", { requestId });

  try {
    const body = JSON.parse(event.body || "{}") as RAGQueryRequest;

    if (!body.query || body.query.trim().length === 0) {
      return errorResponse(400, "query is required and must not be empty", requestId);
    }

    if (body.topK !== undefined && (body.topK < 1 || body.topK > 20)) {
      return errorResponse(400, "topK must be between 1 and 20", requestId);
    }

    const result = await ragService.query(body);

    logger.info("RAG query completed", {
      requestId,
      retrieved: result.retrievedDocuments.length,
      processingTimeMs: result.processingTimeMs,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      body: JSON.stringify({ requestId, ...result }),
    };
  } catch (error) {
    logger.error("RAG query failed", { requestId, error });
    return errorResponse(500, "Internal query error", requestId);
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
