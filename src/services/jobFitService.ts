import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { logger } from "../utils/logger";
import {
  JobFitRequest,
  JobFitResult,
  FitDimension,
  FitGrade,
  FitRecommendation,
} from "../models/types";

const GENERATION_MODEL_ID =
  process.env.GENERATION_MODEL_ID ||
  "anthropic.claude-3-5-sonnet-20241022-v2:0";
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

export class JobFitService {
  private client: BedrockRuntimeClient;

  constructor() {
    this.client = new BedrockRuntimeClient({ region: AWS_REGION });
  }

  async evaluate(input: JobFitRequest): Promise<JobFitResult> {
    const startTime = Date.now();

    logger.info("Starting job fit evaluation", { modelId: GENERATION_MODEL_ID });

    const prompt = this.buildEvaluationPrompt(input);

    const command = new InvokeModelCommand({
      modelId: GENERATION_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const response = await this.client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const rawText: string = responseBody.content[0].text;

    const parsed = this.parseEvaluationResponse(rawText);
    const processingTimeMs = Date.now() - startTime;

    logger.info("Job fit evaluation complete", {
      overallGrade: parsed.overallGrade,
      recommendation: parsed.recommendation,
      processingTimeMs,
    });

    return { ...parsed, processingTimeMs, modelId: GENERATION_MODEL_ID };
  }

  private buildEvaluationPrompt(input: JobFitRequest): string {
    return `You are an expert career coach and AI recruiter. Evaluate how well the candidate's resume fits the job description using a structured 6-block scoring framework inspired by top executive recruiters.

<job_description>
${input.jobDescription.substring(0, 3000)}
</job_description>

<resume>
${input.resumeText.substring(0, 3000)}
</resume>

Score the candidate across 6 dimensions. For each, provide a grade (A, A-, B+, B, B-, C+, C, C-, D, or F), a numeric score (0–100), and a 1-2 sentence note.

Dimensions:
1. roleAlignment     – How closely does this role match the candidate's background, trajectory, and stated goals?
2. skillsMatch       – Overlap between required/preferred skills and candidate's demonstrated skills.
3. levelFit          – Is the seniority level appropriate? (over/under-qualified signals are negatives)
4. compensationSignals – Based on signals in the posting (title, company stage, perks), is compensation likely a good match?
5. personalization   – How much tailoring can be done? Are there shared values, mission alignment, or specific talking points?
6. interviewReadiness – How prepared would this candidate be for a standard interview loop for this role?

Also provide:
- topStrengths: 3 specific strengths that make this candidate competitive
- keyGaps: up to 3 specific gaps or weaknesses to address
- tailoringTips: 3 concrete suggestions to customize the resume/cover letter for this role
- interviewFocus: 3 topics or story areas to prepare for the interview

Compute an overallScore (weighted average: roleAlignment 25%, skillsMatch 30%, levelFit 20%, compensationSignals 5%, personalization 10%, interviewReadiness 10%).
Map overallScore to overallGrade: 93+=A, 90+=A-, 87+=B+, 83+=B, 80+=B-, 77+=C+, 73+=C, 70+=C-, 60+=D, else F.
Set recommendation: APPLY if score >= 75, MAYBE if 55–74, SKIP if < 55.

Respond ONLY with a valid JSON object in this exact format:
{
  "overallGrade": "B+",
  "overallScore": 85,
  "recommendation": "APPLY",
  "dimensions": {
    "roleAlignment":        { "grade": "A",  "score": 88, "notes": "..." },
    "skillsMatch":          { "grade": "B+", "score": 86, "notes": "..." },
    "levelFit":             { "grade": "A-", "score": 90, "notes": "..." },
    "compensationSignals":  { "grade": "B",  "score": 75, "notes": "..." },
    "personalization":      { "grade": "B+", "score": 83, "notes": "..." },
    "interviewReadiness":   { "grade": "B",  "score": 78, "notes": "..." }
  },
  "topStrengths":   ["...", "...", "..."],
  "keyGaps":        ["...", "..."],
  "tailoringTips":  ["...", "...", "..."],
  "interviewFocus": ["...", "...", "..."]
}`;
  }

  private parseEvaluationResponse(
    rawText: string
  ): Omit<JobFitResult, "processingTimeMs" | "modelId"> {
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in response");

      const p = JSON.parse(jsonMatch[0]);

      const dim = (key: string): FitDimension => ({
        grade: p.dimensions[key]?.grade as FitGrade,
        score: Number(p.dimensions[key]?.score ?? 0),
        notes: String(p.dimensions[key]?.notes ?? ""),
      });

      return {
        overallGrade: p.overallGrade as FitGrade,
        overallScore: Number(p.overallScore ?? 0),
        recommendation: p.recommendation as FitRecommendation,
        dimensions: {
          roleAlignment: dim("roleAlignment"),
          skillsMatch: dim("skillsMatch"),
          levelFit: dim("levelFit"),
          compensationSignals: dim("compensationSignals"),
          personalization: dim("personalization"),
          interviewReadiness: dim("interviewReadiness"),
        },
        topStrengths: Array.isArray(p.topStrengths) ? p.topStrengths : [],
        keyGaps: Array.isArray(p.keyGaps) ? p.keyGaps : [],
        tailoringTips: Array.isArray(p.tailoringTips) ? p.tailoringTips : [],
        interviewFocus: Array.isArray(p.interviewFocus) ? p.interviewFocus : [],
      };
    } catch (error) {
      logger.error("Failed to parse job fit evaluation response", { rawText, error });
      const fallback: FitDimension = { grade: "F", score: 0, notes: "Parse error" };
      return {
        overallGrade: "F",
        overallScore: 0,
        recommendation: "SKIP",
        dimensions: {
          roleAlignment: fallback,
          skillsMatch: fallback,
          levelFit: fallback,
          compensationSignals: fallback,
          personalization: fallback,
          interviewReadiness: fallback,
        },
        topStrengths: [],
        keyGaps: ["Evaluation failed — please retry"],
        tailoringTips: [],
        interviewFocus: [],
      };
    }
  }
}
