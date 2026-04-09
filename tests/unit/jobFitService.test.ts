import { JobFitService } from "../../src/services/jobFitService";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

jest.mock("@aws-sdk/client-bedrock-runtime");

const mockSend = jest.fn();
(BedrockRuntimeClient as jest.Mock).mockImplementation(() => ({ send: mockSend }));

const SAMPLE_JOB = `
Senior Software Engineer — Platform
We are looking for a Senior Software Engineer to join our Platform team.
Requirements: 5+ years of TypeScript/Node.js experience, AWS (Lambda, DynamoDB, S3),
strong understanding of distributed systems and REST APIs. Experience with AI/ML pipelines a plus.
Compensation: $180k–$220k + equity. Remote-friendly.
`;

const SAMPLE_RESUME = `
Jane Doe | jane@example.com | github.com/janedoe
Senior Engineer at Acme (4 years) — TypeScript, Node.js, AWS Lambda, DynamoDB, S3.
Built a document processing pipeline handling 1M+ docs/day.
Led migration from monolith to serverless microservices. Strong REST API design skills.
BS Computer Science, State University.
`;

function mockBedrockResponse(json: object) {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({ content: [{ text: JSON.stringify(json) }] })
    ),
  };
}

const MOCK_EVAL_RESPONSE = {
  overallGrade: "B+",
  overallScore: 85,
  recommendation: "APPLY",
  dimensions: {
    roleAlignment:       { grade: "A",  score: 90, notes: "Strong match in platform engineering." },
    skillsMatch:         { grade: "B+", score: 86, notes: "TypeScript, Lambda, DynamoDB all present." },
    levelFit:            { grade: "B",  score: 80, notes: "4 years vs 5+ required; close enough." },
    compensationSignals: { grade: "A",  score: 92, notes: "Stated $180–220k range aligns well." },
    personalization:     { grade: "B+", score: 84, notes: "Document pipeline experience is a direct hook." },
    interviewReadiness:  { grade: "B",  score: 78, notes: "Strong technical base; prep system design." },
  },
  topStrengths: [
    "Hands-on AWS serverless experience (Lambda, DynamoDB, S3)",
    "Led large-scale migration to microservices",
    "Direct experience with high-volume document pipelines",
  ],
  keyGaps: [
    "Slightly below 5-year threshold; frame leadership impact instead",
    "No explicit ML/AI pipeline experience mentioned",
  ],
  tailoringTips: [
    "Open with the 1M docs/day pipeline stat — directly mirrors their platform scale",
    "Highlight the monolith-to-serverless migration as strategic leadership",
    "Add a bullet about AI/ML tooling exposure if any exists",
  ],
  interviewFocus: [
    "System design: serverless at scale, cold start mitigation",
    "DynamoDB data modelling and query patterns",
    "STAR story: how you led the microservices migration",
  ],
};

describe("JobFitService", () => {
  let service: JobFitService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JobFitService();
  });

  it("should return a structured fit report for a well-matched candidate", async () => {
    mockSend.mockResolvedValueOnce(mockBedrockResponse(MOCK_EVAL_RESPONSE));

    const result = await service.evaluate({
      jobDescription: SAMPLE_JOB,
      resumeText: SAMPLE_RESUME,
    });

    expect(result.overallGrade).toBe("B+");
    expect(result.overallScore).toBe(85);
    expect(result.recommendation).toBe("APPLY");
    expect(result.processingTimeMs).toBeGreaterThan(0);
    expect(result.modelId).toContain("claude");
  });

  it("should return all 6 dimension scores", async () => {
    mockSend.mockResolvedValueOnce(mockBedrockResponse(MOCK_EVAL_RESPONSE));

    const result = await service.evaluate({
      jobDescription: SAMPLE_JOB,
      resumeText: SAMPLE_RESUME,
    });

    expect(result.dimensions.roleAlignment.grade).toBe("A");
    expect(result.dimensions.skillsMatch.score).toBe(86);
    expect(result.dimensions.levelFit.notes).toBeTruthy();
    expect(result.dimensions.compensationSignals.grade).toBe("A");
    expect(result.dimensions.personalization.score).toBe(84);
    expect(result.dimensions.interviewReadiness.grade).toBe("B");
  });

  it("should return strengths, gaps, tailoring tips, and interview focus", async () => {
    mockSend.mockResolvedValueOnce(mockBedrockResponse(MOCK_EVAL_RESPONSE));

    const result = await service.evaluate({
      jobDescription: SAMPLE_JOB,
      resumeText: SAMPLE_RESUME,
    });

    expect(result.topStrengths).toHaveLength(3);
    expect(result.keyGaps.length).toBeGreaterThanOrEqual(1);
    expect(result.tailoringTips).toHaveLength(3);
    expect(result.interviewFocus).toHaveLength(3);
  });

  it("should return SKIP recommendation for a poor match", async () => {
    const poorMatch = {
      ...MOCK_EVAL_RESPONSE,
      overallGrade: "D",
      overallScore: 45,
      recommendation: "SKIP",
    };
    mockSend.mockResolvedValueOnce(mockBedrockResponse(poorMatch));

    const result = await service.evaluate({
      jobDescription: SAMPLE_JOB,
      resumeText: "No relevant experience at all.",
    });

    expect(result.recommendation).toBe("SKIP");
    expect(result.overallScore).toBe(45);
  });

  it("should return a safe fallback when Bedrock response is unparseable", async () => {
    mockSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({ content: [{ text: "Sorry, I cannot help with that." }] })
      ),
    });

    const result = await service.evaluate({
      jobDescription: SAMPLE_JOB,
      resumeText: SAMPLE_RESUME,
    });

    expect(result.overallGrade).toBe("F");
    expect(result.recommendation).toBe("SKIP");
    expect(result.keyGaps[0]).toContain("Evaluation failed");
  });

  it("should propagate Bedrock errors", async () => {
    mockSend.mockRejectedValueOnce(new Error("Bedrock throttled"));

    await expect(
      service.evaluate({ jobDescription: SAMPLE_JOB, resumeText: SAMPLE_RESUME })
    ).rejects.toThrow("Bedrock throttled");
  });
});
