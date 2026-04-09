import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";
import { JobFitService } from "../services/jobFitService";
import { logger } from "../utils/logger";
import { JobFitRequest, JobFitResponse } from "../models/types";

const jobFitService = new JobFitService();

/**
 * Lambda handler for job fit evaluation (inspired by career-ops 6-block scoring)
 *
 * POST /evaluate
 * Body: { jobDescription: string, resumeText: string }
 *
 * Returns a structured fit report with:
 *   - Overall grade (A–F) and APPLY / MAYBE / SKIP recommendation
 *   - 6 scored dimensions: role alignment, skills match, level fit,
 *     compensation signals, personalization, interview readiness
 *   - Top strengths, key gaps, tailoring tips, interview focus areas
 */
export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const requestId = context.awsRequestId;
  logger.info("Job fit evaluation request received", { requestId });

  try {
    const body = JSON.parse(event.body || "{}") as JobFitRequest;

    if (!body.jobDescription || !body.resumeText) {
      return errorResponse(400, "Both jobDescription and resumeText are required", requestId);
    }

    if (body.jobDescription.trim().length < 50) {
      return errorResponse(400, "jobDescription is too short — provide the full posting", requestId);
    }

    if (body.resumeText.trim().length < 50) {
      return errorResponse(400, "resumeText is too short — provide the full resume", requestId);
    }

    const result = await jobFitService.evaluate({
      jobDescription: body.jobDescription,
      resumeText: body.resumeText,
    });

    logger.info("Job fit evaluation completed", {
      requestId,
      overallGrade: result.overallGrade,
      overallScore: result.overallScore,
      recommendation: result.recommendation,
    });

    const response: JobFitResponse = { requestId, ...result };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
      body: JSON.stringify(response),
    };
  } catch (error) {
    logger.error("Job fit evaluation failed", { requestId, error });
    return errorResponse(500, "Internal evaluation error", requestId);
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
