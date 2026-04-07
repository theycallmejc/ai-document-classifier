import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { logger } from "../utils/logger";

const EMBEDDING_MODEL_ID =
  process.env.EMBEDDING_MODEL_ID || "amazon.titan-embed-text-v2:0";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

// Titan Embed Text V2 supports up to 8,192 tokens (~32K chars); we stay safe.
const MAX_INPUT_CHARS = 8000;

export class EmbeddingService {
  private client: BedrockRuntimeClient;

  constructor() {
    this.client = new BedrockRuntimeClient({ region: AWS_REGION });
  }

  /**
   * Generate a dense vector embedding for the given text using
   * Amazon Titan Embed Text V2 via AWS Bedrock.
   *
   * Returns a 512-dimensional float32 vector, L2-normalised.
   */
  async embed(text: string): Promise<number[]> {
    const truncated = text.substring(0, MAX_INPUT_CHARS);

    logger.info("Generating embedding", {
      modelId: EMBEDDING_MODEL_ID,
      inputLength: truncated.length,
    });

    const command = new InvokeModelCommand({
      modelId: EMBEDDING_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        inputText: truncated,
        dimensions: 512,   // Titan V2 supports 256 | 512 | 1024
        normalize: true,   // L2-normalise → cosine sim == dot product
      }),
    });

    const response = await this.client.send(command);
    const body = JSON.parse(new TextDecoder().decode(response.body));

    logger.info("Embedding generated", {
      dimensions: body.embedding.length,
      inputTokenCount: body.inputTextTokenCount,
    });

    return body.embedding as number[];
  }
}
