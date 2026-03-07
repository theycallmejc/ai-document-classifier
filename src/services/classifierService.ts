import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { logger } from "../utils/logger";
import {
  ClassifyInput,
  ClassificationResult,
  DocumentCategory,
} from "../models/types";

const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-haiku-20240307-v1:0";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

export class DocumentClassifierService {
  private client: BedrockRuntimeClient;

  constructor() {
    this.client = new BedrockRuntimeClient({ region: AWS_REGION });
  }

  async classify(input: ClassifyInput): Promise<ClassificationResult> {
    const startTime = Date.now();

    const prompt = this.buildClassificationPrompt(input.content, input.documentType);

    logger.info("Invoking Bedrock for classification", { modelId: BEDROCK_MODEL_ID });

    const command = new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    const response = await this.client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const rawText = responseBody.content[0].text;

    const parsed = this.parseClassificationResponse(rawText);
    const processingTimeMs = Date.now() - startTime;

    logger.info("Bedrock classification response parsed", {
      category: parsed.category,
      confidence: parsed.confidence,
      processingTimeMs,
    });

    return {
      ...parsed,
      processingTimeMs,
      modelId: BEDROCK_MODEL_ID,
    };
  }

  private buildClassificationPrompt(content: string, documentType?: string): string {
    const typeHint = documentType ? `Document type hint: ${documentType}` : "";

    return `You are a document classification expert. Analyze the following document and classify it.

${typeHint}

Document content:
"""
${content.substring(0, 4000)}
"""

Respond ONLY with a valid JSON object in this exact format:
{
  "category": "one of: INVOICE | CONTRACT | REPORT | EMAIL | FORM | LEGAL | TECHNICAL | OTHER",
  "confidence": 0.0 to 1.0,
  "subCategories": ["array", "of", "relevant", "sub-tags"],
  "extractedEntities": {
    "dates": [],
    "organizations": [],
    "amounts": [],
    "keyTerms": []
  },
  "reasoning": "brief explanation of classification"
}`;
  }

  private parseClassificationResponse(rawText: string): Omit<
    ClassificationResult,
    "processingTimeMs" | "modelId"
  > {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        category: parsed.category as DocumentCategory,
        confidence: Number(parsed.confidence),
        subCategories: parsed.subCategories || [],
        extractedEntities: parsed.extractedEntities || {},
      };
    } catch (error) {
      logger.error("Failed to parse Bedrock response", { rawText, error });
      return {
        category: "OTHER",
        confidence: 0,
        subCategories: [],
        extractedEntities: {},
      };
    }
  }
}
