/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Evaluation result types.
 *
 * These types capture the results of running evaluations,
 * including per-invocation and overall scores.
 */

import {type EvalStatus} from './eval_metrics.js';
import {type RubricScore} from './eval_rubrics.js';

/**
 * Result of a single metric evaluation for one invocation.
 */
export interface EvalMetricResult {
  /**
   * Name of the metric that was evaluated.
   */
  metricName: string;

  /**
   * Numeric score for this metric (typically 0-1).
   */
  score?: number;

  /**
   * Pass/fail status based on threshold.
   */
  evalStatus: EvalStatus;

  /**
   * The threshold that was used for pass/fail determination.
   */
  threshold: number;

  /**
   * Optional rubric scores if using rubric-based evaluation.
   */
  rubricScores?: RubricScore[];

  /**
   * Optional explanation or rationale for the score.
   */
  rationale?: string;

  /**
   * Optional error message if evaluation failed.
   */
  errorMessage?: string;
}

/**
 * Metric results for a specific invocation.
 */
export interface EvalMetricResultPerInvocation {
  /**
   * ID of the invocation these results are for.
   */
  invocationId: string;

  /**
   * Metric results for this invocation.
   */
  metricResults: EvalMetricResult[];
}

/**
 * Result of evaluating a single eval case.
 */
export interface EvalCaseResult {
  /**
   * ID of the eval case that was evaluated.
   */
  evalCaseId: string;

  /**
   * Overall metric results aggregated across all invocations.
   */
  overallEvalMetricResults: EvalMetricResult[];

  /**
   * Per-invocation metric results for detailed analysis.
   */
  evalMetricResultPerInvocation: EvalMetricResultPerInvocation[];

  /**
   * Timestamp when this result was created (ms since epoch).
   */
  creationTimestamp: number;

  /**
   * Optional error message if the entire eval case failed.
   */
  errorMessage?: string;
}

/**
 * Result of evaluating an entire eval set.
 */
export interface EvalSetResult {
  /**
   * Unique identifier for this result.
   */
  evalSetResultId: string;

  /**
   * ID of the eval set that was evaluated.
   */
  evalSetId: string;

  /**
   * Results for each eval case in the set.
   */
  evalCaseResults: EvalCaseResult[];

  /**
   * Timestamp when this result was created (ms since epoch).
   */
  creationTimestamp: number;

  /**
   * Optional summary statistics.
   */
  summary?: EvalSetResultSummary;
}

/**
 * Summary statistics for an eval set result.
 */
export interface EvalSetResultSummary {
  /**
   * Total number of eval cases.
   */
  totalCases: number;

  /**
   * Number of cases that passed all metrics.
   */
  passedCases: number;

  /**
   * Number of cases that failed at least one metric.
   */
  failedCases: number;

  /**
   * Number of cases that couldn't be evaluated.
   */
  notEvaluatedCases: number;

  /**
   * Average score per metric across all cases.
   */
  averageScorePerMetric: Record<string, number>;
}

/**
 * Creates a new EvalCaseResult instance.
 *
 * @param evalCaseId - ID of the eval case
 * @param overallEvalMetricResults - Overall metric results
 * @param evalMetricResultPerInvocation - Per-invocation results
 * @returns A new EvalCaseResult instance
 */
export function createEvalCaseResult(
  evalCaseId: string,
  overallEvalMetricResults: EvalMetricResult[],
  evalMetricResultPerInvocation: EvalMetricResultPerInvocation[] = []
): EvalCaseResult {
  return {
    evalCaseId,
    overallEvalMetricResults,
    evalMetricResultPerInvocation,
    creationTimestamp: Date.now(),
  };
}

/**
 * Creates a new EvalSetResult instance.
 *
 * @param evalSetResultId - Unique ID for this result
 * @param evalSetId - ID of the eval set
 * @param evalCaseResults - Results for each case
 * @returns A new EvalSetResult instance
 */
export function createEvalSetResult(
  evalSetResultId: string,
  evalSetId: string,
  evalCaseResults: EvalCaseResult[]
): EvalSetResult {
  return {
    evalSetResultId,
    evalSetId,
    evalCaseResults,
    creationTimestamp: Date.now(),
    summary: computeEvalSetSummary(evalCaseResults),
  };
}

/**
 * Computes summary statistics for eval case results.
 *
 * @param evalCaseResults - The results to summarize
 * @returns Summary statistics
 */
export function computeEvalSetSummary(evalCaseResults: EvalCaseResult[]): EvalSetResultSummary {
  const totalCases = evalCaseResults.length;
  let passedCases = 0;
  let failedCases = 0;
  let notEvaluatedCases = 0;

  const scoresByMetric: Record<string, number[]> = {};

  for (const result of evalCaseResults) {
    const allPassed = result.overallEvalMetricResults.every(
      (r) => r.evalStatus === 'PASSED'
    );
    const anyFailed = result.overallEvalMetricResults.some(
      (r) => r.evalStatus === 'FAILED'
    );
    const allNotEvaluated = result.overallEvalMetricResults.every(
      (r) => r.evalStatus === 'NOT_EVALUATED'
    );

    if (allNotEvaluated || result.errorMessage) {
      notEvaluatedCases++;
    } else if (allPassed) {
      passedCases++;
    } else if (anyFailed) {
      failedCases++;
    }

    // Collect scores per metric
    for (const metricResult of result.overallEvalMetricResults) {
      if (metricResult.score !== undefined) {
        if (!scoresByMetric[metricResult.metricName]) {
          scoresByMetric[metricResult.metricName] = [];
        }
        scoresByMetric[metricResult.metricName].push(metricResult.score);
      }
    }
  }

  // Compute averages
  const averageScorePerMetric: Record<string, number> = {};
  for (const [metricName, scores] of Object.entries(scoresByMetric)) {
    if (scores.length > 0) {
      averageScorePerMetric[metricName] =
        scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  }

  return {
    totalCases,
    passedCases,
    failedCases,
    notEvaluatedCases,
    averageScorePerMetric,
  };
}

/**
 * Creates a metric result for a passed evaluation.
 *
 * @param metricName - Name of the metric
 * @param score - The score achieved
 * @param threshold - The threshold used
 * @returns An EvalMetricResult instance
 */
export function createPassedMetricResult(
  metricName: string,
  score: number,
  threshold: number
): EvalMetricResult {
  return {
    metricName,
    score,
    evalStatus: 'PASSED' as EvalStatus,
    threshold,
  };
}

/**
 * Creates a metric result for a failed evaluation.
 *
 * @param metricName - Name of the metric
 * @param score - The score achieved
 * @param threshold - The threshold used
 * @returns An EvalMetricResult instance
 */
export function createFailedMetricResult(
  metricName: string,
  score: number,
  threshold: number
): EvalMetricResult {
  return {
    metricName,
    score,
    evalStatus: 'FAILED' as EvalStatus,
    threshold,
  };
}

/**
 * Creates a metric result for an evaluation that couldn't be performed.
 *
 * @param metricName - Name of the metric
 * @param threshold - The threshold used
 * @param errorMessage - Reason evaluation couldn't be performed
 * @returns An EvalMetricResult instance
 */
export function createNotEvaluatedMetricResult(
  metricName: string,
  threshold: number,
  errorMessage?: string
): EvalMetricResult {
  return {
    metricName,
    evalStatus: 'NOT_EVALUATED' as EvalStatus,
    threshold,
    errorMessage,
  };
}
