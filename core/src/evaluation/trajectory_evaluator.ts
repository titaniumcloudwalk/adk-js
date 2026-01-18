/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tool trajectory evaluator.
 *
 * Evaluates whether an agent's tool usage matches expected tool calls.
 */

import {type Invocation, type ConversationScenario, getToolNames} from './eval_case.js';
import {
  type EvaluationResult,
  type PerInvocationResult,
  Evaluator,
  computeAverageScore,
  computeOverallStatus,
} from './evaluator.js';
import {type ToolTrajectoryCriterion, ToolTrajectoryMatchType, EvalStatus} from './eval_metrics.js';
import {PREBUILT_METRIC_NAMES} from './constants.js';

/**
 * Evaluator for tool trajectory matching.
 *
 * Compares the actual tool calls made by an agent against expected tool calls.
 * Supports three match types:
 * - EXACT: Tools must match exactly in order
 * - IN_ORDER: Expected tools must appear in order (may have extras)
 * - ANY_ORDER: All expected tools must appear (order doesn't matter)
 */
export class TrajectoryEvaluator extends Evaluator {
  private readonly matchType: ToolTrajectoryMatchType;
  private readonly threshold: number;

  /**
   * Creates a new TrajectoryEvaluator.
   *
   * @param criterion - The trajectory criterion configuration
   * @param threshold - Pass/fail threshold (default 0.5)
   */
  constructor(
    criterion?: ToolTrajectoryCriterion,
    threshold: number = 0.5
  ) {
    super(PREBUILT_METRIC_NAMES.TOOL_TRAJECTORY_AVG_SCORE);
    this.matchType = criterion?.matchType ?? ToolTrajectoryMatchType.EXACT;
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
        errorMessage: 'No expected invocations provided for trajectory evaluation',
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

      const actualToolNames = getToolNames(actual);
      const expectedToolNames = getToolNames(expected);

      const {score, rationale} = this.compareToolTrajectories(
        actualToolNames,
        expectedToolNames
      );

      perInvocationResults.push({
        actualInvocation: actual,
        expectedInvocation: expected,
        score,
        evalStatus: score >= this.threshold ? EvalStatus.PASSED : EvalStatus.FAILED,
        rationale,
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
   * Compares actual vs expected tool trajectories.
   *
   * @param actual - Actual tool names called
   * @param expected - Expected tool names
   * @returns Score and rationale
   */
  private compareToolTrajectories(
    actual: string[],
    expected: string[]
  ): {score: number; rationale: string} {
    if (expected.length === 0) {
      // No tools expected - pass if no tools called
      if (actual.length === 0) {
        return {score: 1.0, rationale: 'No tools expected and none called'};
      }
      return {
        score: 0.0,
        rationale: `No tools expected but ${actual.length} tools called: ${actual.join(', ')}`,
      };
    }

    switch (this.matchType) {
      case ToolTrajectoryMatchType.EXACT:
        return this.exactMatch(actual, expected);
      case ToolTrajectoryMatchType.IN_ORDER:
        return this.inOrderMatch(actual, expected);
      case ToolTrajectoryMatchType.ANY_ORDER:
        return this.anyOrderMatch(actual, expected);
      default:
        return {score: 0, rationale: `Unknown match type: ${this.matchType}`};
    }
  }

  /**
   * Exact match: tools must match exactly in order and count.
   */
  private exactMatch(
    actual: string[],
    expected: string[]
  ): {score: number; rationale: string} {
    if (actual.length !== expected.length) {
      return {
        score: 0.0,
        rationale: `Tool count mismatch: expected ${expected.length}, got ${actual.length}`,
      };
    }

    for (let i = 0; i < expected.length; i++) {
      if (actual[i] !== expected[i]) {
        return {
          score: 0.0,
          rationale: `Tool mismatch at position ${i}: expected '${expected[i]}', got '${actual[i]}'`,
        };
      }
    }

    return {score: 1.0, rationale: 'All tools match exactly'};
  }

  /**
   * In-order match: expected tools must appear in sequence.
   */
  private inOrderMatch(
    actual: string[],
    expected: string[]
  ): {score: number; rationale: string} {
    let expectedIdx = 0;

    for (const tool of actual) {
      if (expectedIdx < expected.length && tool === expected[expectedIdx]) {
        expectedIdx++;
      }
    }

    if (expectedIdx === expected.length) {
      return {score: 1.0, rationale: 'All expected tools found in order'};
    }

    const missing = expected.slice(expectedIdx);
    return {
      score: 0.0,
      rationale: `Missing tools in order: ${missing.join(', ')}`,
    };
  }

  /**
   * Any-order match: all expected tools must appear (order doesn't matter).
   */
  private anyOrderMatch(
    actual: string[],
    expected: string[]
  ): {score: number; rationale: string} {
    const actualSet = new Set(actual);
    const missing: string[] = [];

    for (const tool of expected) {
      if (!actualSet.has(tool)) {
        missing.push(tool);
      }
    }

    if (missing.length === 0) {
      return {score: 1.0, rationale: 'All expected tools found'};
    }

    return {
      score: 0.0,
      rationale: `Missing tools: ${missing.join(', ')}`,
    };
  }
}
