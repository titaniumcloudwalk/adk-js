/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LLM-as-judge base evaluator.
 *
 * Abstract base class for evaluators that use an LLM to judge responses.
 */

import {type Invocation, type ConversationScenario, getTextFromContent} from './eval_case.js';
import {
  type EvaluationResult,
  type PerInvocationResult,
  Evaluator,
  computeAverageScore,
  computeOverallStatus,
} from './evaluator.js';
import {type JudgeModelOptions, EvalStatus} from './eval_metrics.js';
import {type RubricScore} from './eval_rubrics.js';
import {DEFAULT_JUDGE_MODEL, DEFAULT_NUM_SAMPLES} from './constants.js';
import {type BaseLlm} from '../models/base_llm.js';
import {LLMRegistry} from '../models/registry.js';
import {type LlmRequest} from '../models/llm_request.js';
import {logger} from '../utils/logger.js';

/**
 * Score result from auto-rater.
 */
export interface AutoRaterScore {
  /** Numeric score (typically 0-1 or 1-5 scale). */
  score: number;

  /** Optional rationale for the score. */
  rationale?: string;

  /** Optional rubric scores for detailed feedback. */
  rubricScores?: RubricScore[];
}

/**
 * Abstract base class for LLM-based evaluators.
 *
 * Provides the framework for:
 * - Formatting prompts for the judge LLM
 * - Sampling multiple responses
 * - Aggregating scores via majority voting
 */
export abstract class LlmAsJudge extends Evaluator {
  protected readonly judgeModel: string;
  protected readonly numSamples: number;
  protected readonly temperature: number;
  protected readonly maxOutputTokens: number;
  protected readonly threshold: number;

  private llm?: BaseLlm;

  /**
   * Creates a new LlmAsJudge evaluator.
   *
   * @param name - Name of this evaluator
   * @param judgeModelOptions - Configuration for the judge model
   * @param threshold - Pass/fail threshold
   */
  constructor(
    name: string,
    judgeModelOptions?: JudgeModelOptions,
    threshold: number = 0.5
  ) {
    super(name);
    this.judgeModel = judgeModelOptions?.model ?? DEFAULT_JUDGE_MODEL;
    this.numSamples = judgeModelOptions?.numSamples ?? DEFAULT_NUM_SAMPLES;
    this.temperature = judgeModelOptions?.temperature ?? 0.0;
    this.maxOutputTokens = judgeModelOptions?.maxOutputTokens ?? 1024;
    this.threshold = threshold;
  }

  /**
   * Gets or creates the LLM instance for judging.
   */
  protected getLlm(): BaseLlm {
    if (!this.llm) {
      this.llm = LLMRegistry.newLlm(this.judgeModel);
    }
    return this.llm;
  }

  /**
   * Formats the prompt for the auto-rater.
   *
   * @param actualInvocation - The actual invocation to evaluate
   * @param expectedInvocation - Optional expected invocation for comparison
   * @returns The formatted prompt string
   */
  abstract formatAutoRaterPrompt(
    actualInvocation: Invocation,
    expectedInvocation?: Invocation
  ): string;

  /**
   * Converts the auto-rater response to a score.
   *
   * @param response - The raw LLM response text
   * @returns The parsed score
   */
  abstract convertAutoRaterResponseToScore(response: string): AutoRaterScore;

  /**
   * Aggregates multiple samples for a single invocation.
   *
   * Default implementation uses majority voting.
   *
   * @param samples - Array of scores from multiple samples
   * @param actualInvocation - The actual invocation
   * @param expectedInvocation - Optional expected invocation
   * @returns Aggregated per-invocation result
   */
  aggregatePerInvocationSamples(
    samples: AutoRaterScore[],
    actualInvocation: Invocation,
    expectedInvocation?: Invocation
  ): PerInvocationResult {
    if (samples.length === 0) {
      return {
        actualInvocation,
        expectedInvocation,
        evalStatus: EvalStatus.NOT_EVALUATED,
        rationale: 'No samples collected',
      };
    }

    // Simple average for numeric scores
    const avgScore = samples.reduce((sum, s) => sum + s.score, 0) / samples.length;

    // Collect all rationales
    const rationales = samples
      .map((s) => s.rationale)
      .filter((r): r is string => r !== undefined);
    const combinedRationale = rationales.length > 0
      ? `Average of ${samples.length} samples: ${rationales[0]}`
      : `Average score from ${samples.length} samples`;

    // Aggregate rubric scores using majority vote
    const aggregatedRubricScores = this.aggregateRubricScores(samples);

    return {
      actualInvocation,
      expectedInvocation,
      score: avgScore,
      evalStatus: avgScore >= this.threshold ? EvalStatus.PASSED : EvalStatus.FAILED,
      rationale: combinedRationale,
      rubricScores: aggregatedRubricScores,
    };
  }

  /**
   * Aggregates rubric scores from multiple samples using majority voting.
   */
  protected aggregateRubricScores(samples: AutoRaterScore[]): RubricScore[] | undefined {
    // Collect all rubric scores by rubric ID
    const scoresByRubric: Map<string, RubricScore[]> = new Map();

    for (const sample of samples) {
      if (sample.rubricScores) {
        for (const rubricScore of sample.rubricScores) {
          if (!scoresByRubric.has(rubricScore.rubricId)) {
            scoresByRubric.set(rubricScore.rubricId, []);
          }
          scoresByRubric.get(rubricScore.rubricId)!.push(rubricScore);
        }
      }
    }

    if (scoresByRubric.size === 0) {
      return undefined;
    }

    // Aggregate each rubric using average
    const aggregated: RubricScore[] = [];
    for (const [rubricId, scores] of scoresByRubric) {
      const validScores = scores.filter((s) => s.score !== undefined);
      const avgScore = validScores.length > 0
        ? validScores.reduce((sum, s) => sum + (s.score ?? 0), 0) / validScores.length
        : undefined;

      const rationales = scores.map((s) => s.rationale).filter(Boolean);

      aggregated.push({
        rubricId,
        score: avgScore,
        rationale: rationales[0], // Take first rationale as representative
      });
    }

    return aggregated;
  }

  /**
   * Summarizes results across all invocations.
   *
   * Default implementation uses mean aggregation.
   *
   * @param results - Per-invocation results
   * @returns Overall evaluation result
   */
  aggregateInvocationResults(results: PerInvocationResult[]): EvaluationResult {
    const overallScore = computeAverageScore(results);
    const overallStatus = computeOverallStatus(results, this.threshold, overallScore);

    return {
      overallScore,
      overallEvalStatus: overallStatus,
      perInvocationResults: results,
    };
  }

  async evaluateInvocations(
    actualInvocations: Invocation[],
    expectedInvocations?: Invocation[],
    _conversationScenario?: ConversationScenario
  ): Promise<EvaluationResult> {
    const perInvocationResults: PerInvocationResult[] = [];

    for (let i = 0; i < actualInvocations.length; i++) {
      const actual = actualInvocations[i];
      const expected = expectedInvocations?.find(
        (e) => e.invocationId === actual.invocationId
      ) ?? expectedInvocations?.[i];

      try {
        const result = await this.evaluateSingleInvocation(actual, expected);
        perInvocationResults.push(result);
      } catch (error) {
        logger.warn(`Error evaluating invocation ${actual.invocationId}: ${error}`);
        perInvocationResults.push({
          actualInvocation: actual,
          expectedInvocation: expected,
          evalStatus: EvalStatus.NOT_EVALUATED,
          rationale: `Evaluation error: ${error}`,
        });
      }
    }

    return this.aggregateInvocationResults(perInvocationResults);
  }

  /**
   * Evaluates a single invocation by sampling the judge LLM.
   */
  protected async evaluateSingleInvocation(
    actualInvocation: Invocation,
    expectedInvocation?: Invocation
  ): Promise<PerInvocationResult> {
    const prompt = this.formatAutoRaterPrompt(actualInvocation, expectedInvocation);
    const samples: AutoRaterScore[] = [];

    const llm = this.getLlm();

    for (let i = 0; i < this.numSamples; i++) {
      try {
        const request: LlmRequest = {
          contents: [
            {
              role: 'user',
              parts: [{text: prompt}],
            },
          ],
          toolsDict: {},
          liveConnectConfig: {},
        };

        // generateContentAsync is an async generator, collect the last response
        let lastResponse;
        for await (const response of llm.generateContentAsync(request, false)) {
          lastResponse = response;
        }

        if (lastResponse?.content) {
          const responseText = getTextFromContent(lastResponse.content);
          if (responseText) {
            const score = this.convertAutoRaterResponseToScore(responseText);
            samples.push(score);
          }
        }
      } catch (error) {
        logger.warn(`Sample ${i + 1} failed: ${error}`);
      }
    }

    return this.aggregatePerInvocationSamples(
      samples,
      actualInvocation,
      expectedInvocation
    );
  }
}

/**
 * Parses a numeric score from LLM response text.
 *
 * Looks for patterns like:
 * - "Score: 0.85"
 * - "Rating: 4/5"
 * - Just a number "0.9"
 *
 * @param text - The text to parse
 * @returns Parsed score, or undefined if not found
 */
export function parseScoreFromText(text: string): number | undefined {
  // Try "Score: X" pattern
  const scoreMatch = text.match(/score[:\s]+([0-9]*\.?[0-9]+)/i);
  if (scoreMatch) {
    return parseFloat(scoreMatch[1]);
  }

  // Try "X/Y" pattern
  const fractionMatch = text.match(/([0-9]+)\s*\/\s*([0-9]+)/);
  if (fractionMatch) {
    const num = parseInt(fractionMatch[1]);
    const denom = parseInt(fractionMatch[2]);
    if (denom > 0) {
      return num / denom;
    }
  }

  // Try standalone number
  const numberMatch = text.match(/^[^0-9]*([0-9]*\.?[0-9]+)/);
  if (numberMatch) {
    const value = parseFloat(numberMatch[1]);
    // Assume 0-1 or 0-5 scale
    if (value > 1 && value <= 5) {
      return value / 5;
    }
    if (value <= 1) {
      return value;
    }
  }

  return undefined;
}
