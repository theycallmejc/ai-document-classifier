import { EmbeddingService } from "../../src/services/embeddingService";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

jest.mock("@aws-sdk/client-bedrock-runtime");

const mockSend = jest.fn();
(BedrockRuntimeClient as jest.Mock).mockImplementation(() => ({ send: mockSend }));

const MOCK_EMBEDDING = Array.from({ length: 512 }, (_, i) => i / 512);

function mockBedrockEmbedResponse(embedding: number[]) {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({ embedding, inputTextTokenCount: 10 })
    ),
  };
}

describe("EmbeddingService", () => {
  let service: EmbeddingService;

  beforeEach(() => {
    service = new EmbeddingService();
    jest.clearAllMocks();
  });

  it("should return a 512-dimensional embedding vector", async () => {
    mockSend.mockResolvedValueOnce(mockBedrockEmbedResponse(MOCK_EMBEDDING));

    const result = await service.embed("This is a test document.");

    expect(result).toHaveLength(512);
    expect(result[0]).toBeCloseTo(0, 4);
  });

  it("should pass the correct model ID and payload to Bedrock", async () => {
    mockSend.mockResolvedValueOnce(mockBedrockEmbedResponse(MOCK_EMBEDDING));

    await service.embed("Hello world");

    const callArgs = mockSend.mock.calls[0][0].input;
    expect(callArgs.modelId).toContain("titan-embed");
    const body = JSON.parse(new TextDecoder().decode(callArgs.body));
    expect(body.dimensions).toBe(512);
    expect(body.normalize).toBe(true);
  });

  it("should truncate input text longer than 8000 characters", async () => {
    mockSend.mockResolvedValueOnce(mockBedrockEmbedResponse(MOCK_EMBEDDING));

    const longText = "a".repeat(10_000);
    await service.embed(longText);

    const callArgs = mockSend.mock.calls[0][0].input;
    const body = JSON.parse(new TextDecoder().decode(callArgs.body));
    expect(body.inputText.length).toBe(8000);
  });

  it("should propagate Bedrock errors to the caller", async () => {
    mockSend.mockRejectedValueOnce(new Error("Bedrock throttled"));

    await expect(service.embed("test")).rejects.toThrow("Bedrock throttled");
  });
});
