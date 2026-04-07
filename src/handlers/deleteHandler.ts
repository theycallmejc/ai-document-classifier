import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { VectorStoreService } from "../services/vectorStoreService";
import { logger } from "../utils/logger";

const vectorStore = new VectorStoreService();

/**
 * Lambda handler for document deletion  (DELETE /documents/{documentId})
 *
 * Removes a document and its embedding from the DynamoDB vector store.
 * The source document in S3 is NOT deleted — only the RAG index entry.
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const requestId = context.awsRequestId;
  const documentId = event.pathParameters?.documentId;

  logger.info("Document delete request received", { requestId, documentId });

  if (!documentId) {
    return errorResponse(400, "documentId path parameter is required", requestId);
  }

  try {
    await vectorStore.delete(documentId);

    logger.info("Document deleted from vector store", { requestId, documentId });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
      body: JSON.stringify({
        documentId,
        deleted: true,
        message: "Document removed from the RAG index.",
      }),
    };
  } catch (error) {
    logger.error("Delete failed", { requestId, documentId, error });
    return errorResponse(500, "Internal delete error", requestId);
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
