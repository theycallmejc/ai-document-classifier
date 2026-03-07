import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { DocumentClassifierService } from "../services/classifierService";
import { S3Service } from "../services/s3Service";
import { logger } from "../utils/logger";
import { ClassificationRequest, ClassificationResponse } from "../models/types";

const classifierService = new DocumentClassifierService();
const s3Service = new S3Service();

/**
 * Lambda handler for document classification
 * Accepts: S3 key or base64 encoded document content
 * Returns: Classification result with confidence scores
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const requestId = context.awsRequestId;
  logger.info("Document classification request received", { requestId });

  try {
    const body = JSON.parse(event.body || "{}") as ClassificationRequest;

    if (!body.s3Key && !body.content) {
      return errorResponse(400, "Either s3Key or content is required", requestId);
    }

    // Fetch document from S3 if s3Key provided
    let documentContent = body.content;
    if (body.s3Key) {
      logger.info("Fetching document from S3", { s3Key: body.s3Key });
      documentContent = await s3Service.getDocument(body.s3Key);
    }

    if (!documentContent) {
      return errorResponse(404, "Document content could not be retrieved", requestId);
    }

    // Classify document using AWS Bedrock
    const result = await classifierService.classify({
      content: documentContent,
      documentType: body.documentType,
      metadata: body.metadata,
    });

    logger.info("Classification completed", {
      requestId,
      category: result.category,
      confidence: result.confidence,
    });

    const response: ClassificationResponse = {
      requestId,
      category: result.category,
      confidence: result.confidence,
      subCategories: result.subCategories,
      extractedEntities: result.extractedEntities,
      processingTimeMs: result.processingTimeMs,
      modelId: result.modelId,
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error("Classification failed", { requestId, error });
    return errorResponse(500, "Internal classification error", requestId);
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
