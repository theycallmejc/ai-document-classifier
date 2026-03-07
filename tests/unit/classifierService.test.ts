import { DocumentClassifierService } from "../../src/services/classifierService";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

// Mock AWS Bedrock
jest.mock("@aws-sdk/client-bedrock-runtime");

const mockSend = jest.fn();
(BedrockRuntimeClient as jest.Mock).mockImplementation(() => ({
  send: mockSend,
}));

describe("DocumentClassifierService", () => {
  let service: DocumentClassifierService;

  beforeEach(() => {
    service = new DocumentClassifierService();
    jest.clearAllMocks();
  });

  it("should classify an invoice document correctly", async () => {
    const mockBedrockResponse = {
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [
            {
              text: JSON.stringify({
                category: "INVOICE",
                confidence: 0.95,
                subCategories: ["vendor-invoice", "accounts-payable"],
                extractedEntities: {
                  dates: ["2024-01-15"],
                  organizations: ["Acme Corp"],
                  amounts: ["$1,500.00"],
                  keyTerms: ["payment due", "invoice number"],
                },
                reasoning: "Document contains invoice number, payment terms, and amounts",
              }),
            },
          ],
        })
      ),
    };

    mockSend.mockResolvedValueOnce(mockBedrockResponse);

    const result = await service.classify({
      content: "Invoice #12345 from Acme Corp. Amount due: $1,500.00. Payment due: 2024-01-15",
    });

    expect(result.category).toBe("INVOICE");
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.subCategories).toContain("vendor-invoice");
    expect(result.modelId).toBeDefined();
    expect(result.processingTimeMs).toBeGreaterThan(0);
  });

  it("should classify a contract document", async () => {
    const mockBedrockResponse = {
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [
            {
              text: JSON.stringify({
                category: "CONTRACT",
                confidence: 0.92,
                subCategories: ["service-agreement"],
                extractedEntities: {
                  dates: ["2024-06-01"],
                  organizations: ["Party A", "Party B"],
                  amounts: [],
                  keyTerms: ["terms and conditions", "obligations"],
                },
                reasoning: "Document contains legal terms, parties, and obligations",
              }),
            },
          ],
        })
      ),
    };

    mockSend.mockResolvedValueOnce(mockBedrockResponse);

    const result = await service.classify({
      content: "This Service Agreement is entered into between Party A and Party B...",
    });

    expect(result.category).toBe("CONTRACT");
    expect(result.confidence).toBeGreaterThan(0.85);
  });

  it("should handle Bedrock API errors gracefully", async () => {
    mockSend.mockRejectedValueOnce(new Error("Bedrock API timeout"));

    await expect(
      service.classify({ content: "Some document content" })
    ).rejects.toThrow("Bedrock API timeout");
  });

  it("should fallback to OTHER when response cannot be parsed", async () => {
    const mockBedrockResponse = {
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ text: "I cannot classify this document." }],
        })
      ),
    };

    mockSend.mockResolvedValueOnce(mockBedrockResponse);

    const result = await service.classify({ content: "Unparseable content" });

    expect(result.category).toBe("OTHER");
    expect(result.confidence).toBe(0);
  });
});
