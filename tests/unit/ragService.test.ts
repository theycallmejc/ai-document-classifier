import { RAGService } from "../../src/services/ragService";
import { EmbeddingService } from "../../src/services/embeddingService";
import { VectorStoreService } from "../../src/services/vectorStoreService";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

jest.mock("@aws-sdk/client-bedrock-runtime");
jest.mock("../../src/services/embeddingService");
jest.mock("../../src/services/vectorStoreService");

const mockBedrockSend = jest.fn();
(BedrockRuntimeClient as jest.Mock).mockImplementation(() => ({
  send: mockBedrockSend,
}));

const MOCK_EMBEDDING = new Array(512).fill(0.1);

const MOCK_DOCS = [
  {
    documentId: "doc-1",
    content: "Invoice #12345 from Acme Corp. Total due: $1,500.",
    similarity: 0.92,
    metadata: {},
    category: "INVOICE",
  },
  {
    documentId: "doc-2",
    content: "Service agreement between Party A and Party B, effective June 2024.",
    similarity: 0.78,
    metadata: {},
    category: "CONTRACT",
  },
];

function mockGenerationResponse(text: string) {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({ content: [{ text }] })
    ),
  };
}

describe("RAGService", () => {
  let ragService: RAGService;
  let mockEmbedding: jest.Mocked<EmbeddingService>;
  let mockVectorStore: jest.Mocked<VectorStoreService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmbedding = new EmbeddingService() as jest.Mocked<EmbeddingService>;
    mockVectorStore = new VectorStoreService() as jest.Mocked<VectorStoreService>;
    ragService = new RAGService(mockEmbedding, mockVectorStore);
  });

  it("should execute the full embed → retrieve → generate pipeline", async () => {
    mockEmbedding.embed.mockResolvedValueOnce(MOCK_EMBEDDING);
    mockVectorStore.similaritySearch.mockResolvedValueOnce(MOCK_DOCS);
    mockBedrockSend.mockResolvedValueOnce(
      mockGenerationResponse("Based on [Document 1], the invoice total is $1,500.")
    );

    const result = await ragService.query({ query: "What is the invoice total?" });

    expect(result.answer).toContain("$1,500");
    expect(result.retrievedDocuments).toHaveLength(2);
    expect(result.retrievedDocuments[0].similarity).toBe(0.92);
    expect(result.processingTimeMs).toBeGreaterThan(0);
    expect(result.modelId).toContain("claude");
  });

  it("should pass topK to the vector store", async () => {
    mockEmbedding.embed.mockResolvedValueOnce(MOCK_EMBEDDING);
    mockVectorStore.similaritySearch.mockResolvedValueOnce([MOCK_DOCS[0]]);
    mockBedrockSend.mockResolvedValueOnce(mockGenerationResponse("Answer."));

    await ragService.query({ query: "Find the invoice", topK: 1 });

    expect(mockVectorStore.similaritySearch).toHaveBeenCalledWith(MOCK_EMBEDDING, 1);
  });

  it("should use the query embedding when calling the vector store", async () => {
    const specificEmbedding = new Array(512).fill(0.42);
    mockEmbedding.embed.mockResolvedValueOnce(specificEmbedding);
    mockVectorStore.similaritySearch.mockResolvedValueOnce(MOCK_DOCS);
    mockBedrockSend.mockResolvedValueOnce(mockGenerationResponse("Answer."));

    await ragService.query({ query: "contracts signed in 2024" });

    expect(mockVectorStore.similaritySearch).toHaveBeenCalledWith(
      specificEmbedding,
      5  // default topK
    );
  });

  it("should propagate embedding errors", async () => {
    mockEmbedding.embed.mockRejectedValueOnce(new Error("Embedding failed"));

    await expect(ragService.query({ query: "test" })).rejects.toThrow(
      "Embedding failed"
    );
  });

  it("should propagate generation errors", async () => {
    mockEmbedding.embed.mockResolvedValueOnce(MOCK_EMBEDDING);
    mockVectorStore.similaritySearch.mockResolvedValueOnce(MOCK_DOCS);
    mockBedrockSend.mockRejectedValueOnce(new Error("Generation model unavailable"));

    await expect(ragService.query({ query: "test" })).rejects.toThrow(
      "Generation model unavailable"
    );
  });
});
