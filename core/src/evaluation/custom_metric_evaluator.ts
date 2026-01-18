/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Custom metric evaluator.
 *
 * Allows users to define custom evaluation functions.
 */

import {type Invocation, type ConversationScenario} from './eval_case.js';
import {
  type EvaluationResult,
  type PerInvocationResult,
  Evaluator,
  computeAverageScore,
  computeOverallStatus,
} from './evaluator.js';
import {EvalStatus} from './eval_metrics.js';

/**
 * Custom evaluation function signature.
 *
 * @param actualInvocation - The actual invocation to evaluate
 * @param expectedInvocation - Optional expected invocation for comparison
 * @returns Evaluation score (0-1) and optional rationale
 */
export type CustomEvalFunction = (
  actualInvocation: Invocation,
  expectedInvocation?: Invocation
) => Promise<{score: number; rationale?: string}>;

/**
 * Evaluator that uses a custom evaluation function.
 *
 * Allows users to define their own evaluation logic while
 * integrating with the framework's aggregation and reporting.
 */
export class CustomMetricEvaluator extends Evaluator {
  private readonly evalFunction: CustomEvalFunction;
  private readonly threshold: number;

  /**
   * Creates a new CustomMetricEvaluator.
   *
   * @param name - Name of this metric
   * @param evalFunction - The custom evaluation function
   * @param threshold - Pass/fail threshold (default 0.5)
   */
  constructor(
    name: string,
    evalFunction: CustomEvalFunction,
    threshold: number = 0.5
  ) {
    super(name);
    this.evalFunction = evalFunction;
    this.threshold = threshold;
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
        const result = await this.evalFunction(actual, expected);

        perInvocationResults.push({
          actualInvocation: actual,
          expectedInvocation: expected,
          score: result.score,
          evalStatus: result.score >= this.threshold
            ? EvalStatus.PASSED
            : EvalStatus.FAILED,
          rationale: result.rationale,
        });
      } catch (error) {
        perInvocationResults.push({
          actualInvocation: actual,
          expectedInvocation: expected,
          evalStatus: EvalStatus.NOT_EVALUATED,
          rationale: `Custom evaluation error: ${error}`,
        });
      }
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
}

/**
 * Creates a custom metric evaluator from a function.
 *
 * @param name - Name of the metric
 * @param evalFunction - The evaluation function
 * @param threshold - Pass/fail threshold
 * @returns A new CustomMetricEvaluator
 */
export function createCustomEvaluator(
  name: string,
  evalFunction: CustomEvalFunction,
  threshold: number = 0.5
): CustomMetricEvaluator {
  return new CustomMetricEvaluator(name, evalFunction, threshold);
}
