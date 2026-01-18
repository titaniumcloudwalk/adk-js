/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Response evaluator using ROUGE-based matching.
 *
 * Evaluates response similarity using ROUGE-1 (unigram overlap) scoring.
 */

import {type Invocation, type ConversationScenario, getTextFromContent} from './eval_case.js';
import {
  type EvaluationResult,
  type PerInvocationResult,
  Evaluator,
  computeAverageScore,
  computeOverallStatus,
} from './evaluator.js';
import {EvalStatus} from './eval_metrics.js';
import {PREBUILT_METRIC_NAMES} from './constants.js';

/**
 * Evaluator for response matching using ROUGE-1 similarity.
 *
 * ROUGE-1 measures unigram overlap between the actual and expected response.
 * This provides a simple but effective measure of content similarity.
 */
export class ResponseEvaluator extends Evaluator {
  private readonly threshold: number;

  /**
   * Creates a new ResponseEvaluator.
   *
   * @param threshold - Pass/fail threshold (default 0.5)
   */
  constructor(threshold: number = 0.5) {
    super(PREBUILT_METRIC_NAMES.RESPONSE_MATCH_SCORE);
    this.threshold = threshold;
  }

  async evaluateInvocations(
    actualInvocations: Invocation[],
    expectedInvocations?: Invocation[],
    _conversationScenario?: ConversationScenario
  ): Promise<EvaluationResult> {
    if (!expectedInvocations || expectedInvocations.length === 0) {
      return {
        overallEvalStatus: EvalStatus.NOT_EVALUATED,
        perInvocationResults: [],
        errorMessage: 'No expected invocations provided for response evaluation',
      };
    }

    const perInvocationResults: PerInvocationResult[] = [];

    // Match invocations by ID or position
    for (let i = 0; i < actualInvocations.length; i++) {
      const actual = actualInvocations[i];
      const expected = expectedInvocations.find(
        (e) => e.invocationId === actual.invocationId
      ) ?? expectedInvocations[i];

      if (!expected) {
        perInvocationResults.push({
          actualInvocation: actual,
          score: 0,
          evalStatus: EvalStatus.NOT_EVALUATED,
          rationale: 'No matching expected invocation found',
        });
        continue;
      }

      const actualText = getTextFromContent(actual.finalResponse);
      const expectedText = getTextFromContent(expected.finalResponse);

      if (!expectedText) {
        perInvocationResults.push({
          actualInvocation: actual,
          expectedInvocation: expected,
          score: actualText ? 0 : 1,
          evalStatus: actualText ? EvalStatus.FAILED : EvalStatus.PASSED,
          rationale: actualText
            ? 'Expected no response but got one'
            : 'No response expected and none provided',
        });
        continue;
      }

      const score = this.computeRouge1Score(actualText, expectedText);

      perInvocationResults.push({
        actualInvocation: actual,
        expectedInvocation: expected,
        score,
        evalStatus: score >= this.threshold ? EvalStatus.PASSED : EvalStatus.FAILED,
        rationale: `ROUGE-1 F1 score: ${score.toFixed(3)}`,
      });
    }

    const overallScore = computeAverageScore(perInvocationResults);
    const overallStatus = computeOverallStatus(
      perInvocationResults,
      this.threshold,
      overallScore
    );

    return {
      overallScore,
      overallEvalStatus: overallStatus,
      perInvocationResults,
    };
  }

  /**
   * Computes ROUGE-1 F1 score between two texts.
   *
   * ROUGE-1 measures unigram overlap:
   * - Precision: overlap / actual_tokens
   * - Recall: overlap / expected_tokens
   * - F1: 2 * precision * recall / (precision + recall)
   *
   * @param actualText - The actual response text
   * @param expectedText - The expected response text
   * @returns F1 score between 0 and 1
   */
  private computeRouge1Score(actualText: string, expectedText: string): number {
    const actualTokens = this.tokenize(actualText);
    const expectedTokens = this.tokenize(expectedText);

    if (actualTokens.length === 0 && expectedTokens.length === 0) {
      return 1.0;
    }

    if (actualTokens.length === 0 || expectedTokens.length === 0) {
      return 0.0;
    }

    const actualSet = new Set(actualTokens);
    const expectedSet = new Set(expectedTokens);

    let overlap = 0;
    for (const token of actualSet) {
      if (expectedSet.has(token)) {
        overlap++;
      }
    }

    const precision = overlap / actualSet.size;
    const recall = overlap / expectedSet.size;

    if (precision + recall === 0) {
      return 0.0;
    }

    const f1 = (2 * precision * recall) / (precision + recall);
    return f1;
  }

  /**
   * Tokenizes text into lowercase words.
   *
   * @param text - The text to tokenize
   * @returns Array of tokens
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0);
  }
}
