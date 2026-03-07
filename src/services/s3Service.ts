import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { logger } from "../utils/logger";

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET || "";

export class S3Service {
  private client: S3Client;

  constructor() {
    this.client = new S3Client({ region: AWS_REGION });
  }

  async getDocument(s3Key: string): Promise<string> {
    logger.info("Fetching document from S3", { bucket: DOCUMENTS_BUCKET, key: s3Key });

    const command = new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`Document not found: ${s3Key}`);
    }

    const content = await response.Body.transformToString("utf-8");
    logger.info("Document fetched successfully", { s3Key, size: content.length });

    return content;
  }
}
