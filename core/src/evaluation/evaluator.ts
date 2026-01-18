/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Base evaluator interface and result types.
 *
 * Evaluators are responsible for scoring agent responses
 * against expected outputs or criteria.
 */

import {type Invocation, type ConversationScenario} from './eval_case.js';
import {type EvalStatus} from './eval_metrics.js';
import {type RubricScore} from './eval_rubrics.js';

/**
 * Result for a single invocation evaluation.
 */
export interface PerInvocationResult {
  /**
   * The actual invocation that was evaluated.
   */
  actualInvocation: Invocation;

  /**
   * The expected invocation (if available for comparison).
   */
  expectedInvocation?: Invocation;

  /**
   * Numeric score for this invocation (typically 0-1).
   */
  score?: number;

  /**
   * Pass/fail status for this invocation.
   */
  evalStatus: EvalStatus;

  /**
   * Optional rubric scores for detailed feedback.
   */
  rubricScores?: RubricScore[];

  /**
   * Optional rationale explaining the score.
   */
  rationale?: string;
}

/**
 * Overall result of an evaluation across all invocations.
 */
export interface EvaluationResult {
  /**
   * Overall score across all invocations (typically 0-1).
   */
  overallScore?: number;

  /**
   * Overall pass/fail status.
   */
  overallEvalStatus: EvalStatus;

  /**
   * Results for each individual invocation.
   */
  perInvocationResults: PerInvocationResult[];

  /**
   * Optional overall rubric scores (aggregated across invocations).
   */
  overallRubricScores?: RubricScore[];

  /**
   * Optional error message if evaluation failed.
   */
  errorMessage?: string;
}

/**
 * Abstract base class for all evaluators.
 *
 * Evaluators implement different evaluation strategies
 * (deterministic, LLM-based, rubric-based, etc.).
 */
export abstract class Evaluator {
  /**
   * Name of this evaluator.
   */
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Evaluates a list of invocations.
   *
   * @param actualInvocations - The actual agent responses to evaluate
   * @param expectedInvocations - Optional expected responses for comparison
   * @param conversationScenario - Optional scenario context
   * @returns Evaluation results
   */
  abstract evaluateInvocations(
    actualInvocations: Invocation[],
    expectedInvocations?: Invocation[],
    conversationScenario?: ConversationScenario
  ): Promise<EvaluationResult>;
}

/**
 * Creates a passed evaluation result.
 *
 * @param score - The score achieved
 * @param perInvocationResults - Results for each invocation
 * @returns An EvaluationResult instance
 */
export function createPassedResult(
  score: number,
  perInvocationResults: PerInvocationResult[]
): EvaluationResult {
  return {
    overallScore: score,
    overallEvalStatus: 'PASSED' as EvalStatus,
    perInvocationResults,
  };
}

/**
 * Creates a failed evaluation result.
 *
 * @param score - The score achieved
 * @param perInvocationResults - Results for each invocation
 * @returns An EvaluationResult instance
 */
export function createFailedResult(
  score: number,
  perInvocationResults: PerInvocationResult[]
): EvaluationResult {
  return {
    overallScore: score,
    overallEvalStatus: 'FAILED' as EvalStatus,
    perInvocationResults,
  };
}

/**
 * Creates an error evaluation result.
 *
 * @param errorMessage - The error message
 * @returns An EvaluationResult instance
 */
export function createErrorResult(errorMessage: string): EvaluationResult {
  return {
    overallEvalStatus: 'NOT_EVALUATED' as EvalStatus,
    perInvocationResults: [],
    errorMessage,
  };
}

/**
 * Computes the average score from per-invocation results.
 *
 * @param results - The per-invocation results
 * @returns Average score, or undefined if no valid scores
 */
export function computeAverageScore(results: PerInvocationResult[]): number | undefined {
  const validScores = results.filter((r) => r.score !== undefined);
  if (validScores.length === 0) {
    return undefined;
  }
  return validScores.reduce((sum, r) => sum + (r.score ?? 0), 0) / validScores.length;
}

/**
 * Determines overall status from per-invocation results.
 *
 * @param results - The per-invocation results
 * @param threshold - Score threshold for passing
 * @param averageScore - Pre-computed average score
 * @returns Overall status
 */
export function computeOverallStatus(
  results: PerInvocationResult[],
  threshold: number,
  averageScore?: number
): EvalStatus {
  if (results.length === 0) {
    return 'NOT_EVALUATED' as EvalStatus;
  }

  const allNotEvaluated = results.every((r) => r.evalStatus === 'NOT_EVALUATED');
  if (allNotEvaluated) {
    return 'NOT_EVALUATED' as EvalStatus;
  }

  const score = averageScore ?? computeAverageScore(results);
  if (score === undefined) {
    return 'NOT_EVALUATED' as EvalStatus;
  }

  return score >= threshold ? ('PASSED' as EvalStatus) : ('FAILED' as EvalStatus);
}

/**
 * Creates a per-invocation result from scores.
 *
 * @param actualInvocation - The actual invocation
 * @param score - The score
 * @param threshold - Pass/fail threshold
 * @param expectedInvocation - Optional expected invocation
 * @param rationale - Optional rationale
 * @returns A PerInvocationResult instance
 */
export function createPerInvocationResult(
  actualInvocation: Invocation,
  score: number,
  threshold: number,
  expectedInvocation?: Invocation,
  rationale?: string
): PerInvocationResult {
  return {
    actualInvocation,
    expectedInvocation,
    score,
    evalStatus: score >= threshold ? ('PASSED' as EvalStatus) : ('FAILED' as EvalStatus),
    rationale,
  };
}
