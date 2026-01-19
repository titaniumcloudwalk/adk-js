/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Evaluation metric types and criterion definitions.
 *
 * These types define the configuration for different evaluation approaches
 * including LLM-as-judge, rubric-based, and deterministic evaluations.
 */

import {type Rubric} from './eval_rubrics.js';

/**
 * Status of an evaluation.
 */
export enum EvalStatus {
  /** Evaluation passed the threshold. */
  PASSED = 'PASSED',
  /** Evaluation failed the threshold. */
  FAILED = 'FAILED',
  /** Evaluation was not performed (e.g., missing data). */
  NOT_EVALUATED = 'NOT_EVALUATED',
}

/**
 * Match types for tool trajectory evaluation.
 */
export enum ToolTrajectoryMatchType {
  /** Tools must match exactly in order. */
  EXACT = 'EXACT',
  /** Tools must appear in order but may have extras. */
  IN_ORDER = 'IN_ORDER',
  /** All expected tools must appear but order doesn't matter. */
  ANY_ORDER = 'ANY_ORDER',
}

/**
 * Judge model options for LLM-based evaluation.
 */
export interface JudgeModelOptions {
  /** The model name/ID to use as judge. */
  model?: string;

  /** Number of samples to take for majority voting. */
  numSamples?: number;

  /** Temperature for the judge model. */
  temperature?: number;

  /** Maximum output tokens for judge responses. */
  maxOutputTokens?: number;
}

/**
 * Base criterion interface for all evaluation criteria.
 */
export interface BaseCriterion {
  /** Type discriminator for the criterion. */
  type: string;
}

/**
 * Criterion for LLM-as-judge based evaluation.
 */
export interface LlmAsAJudgeCriterion extends BaseCriterion {
  type: 'llm_as_a_judge';

  /** Options for the judge model. */
  judgeModelOptions?: JudgeModelOptions;
}

/**
 * Criterion for rubric-based evaluation.
 */
export interface RubricsBasedCriterion extends BaseCriterion {
  type: 'rubrics_based';

  /** Options for the judge model. */
  judgeModelOptions?: JudgeModelOptions;

  /** List of rubrics to evaluate against. */
  rubrics: Rubric[];
}

/**
 * Criterion for hallucination detection.
 */
export interface HallucinationsCriterion extends BaseCriterion {
  type: 'hallucinations';

  /** Options for the judge model. */
  judgeModelOptions?: JudgeModelOptions;

  /** Whether to perform sentence-level segmentation. */
  sentenceSegmentation?: boolean;
}

/**
 * Criterion for tool trajectory evaluation.
 */
export interface ToolTrajectoryCriterion extends BaseCriterion {
  type: 'tool_trajectory';

  /** How to match tool calls against expected trajectory. */
  matchType: ToolTrajectoryMatchType;
}

/**
 * Criterion for LLM-backed user simulator quality evaluation.
 */
export interface LlmBackedUserSimulatorCriterion extends BaseCriterion {
  type: 'llm_backed_user_simulator';

  /** Options for the judge model. */
  judgeModelOptions?: JudgeModelOptions;
}

/**
 * Union type for all criterion types.
 */
export type Criterion =
  | LlmAsAJudgeCriterion
  | RubricsBasedCriterion
  | HallucinationsCriterion
  | ToolTrajectoryCriterion
  | LlmBackedUserSimulatorCriterion;

/**
 * Configuration for an evaluation metric.
 *
 * A metric defines what aspect of agent behavior to evaluate
 * and how to evaluate it.
 */
export interface EvalMetric {
  /**
   * Name of the metric (e.g., "tool_trajectory_avg_score").
   */
  metricName: string;

  /**
   * Threshold for pass/fail determination.
   * Scores >= threshold pass, scores < threshold fail.
   */
  threshold: number;

  /**
   * Optional criterion configuration for this metric.
   * Different metrics use different criterion types.
   */
  criterion?: Criterion;

  /**
   * Optional path to a custom evaluation function.
   * Used for custom metrics defined outside the framework.
   */
  customFunctionPath?: string;
}

/**
 * Creates a new EvalMetric instance.
 *
 * @param metricName - Name of the metric
 * @param threshold - Pass/fail threshold (default 0.5)
 * @param criterion - Optional criterion configuration
 * @param customFunctionPath - Optional custom function path
 * @returns A new EvalMetric instance
 */
export function createEvalMetric(
  metricName: string,
  threshold: number = 0.5,
  criterion?: Criterion,
  customFunctionPath?: string
): EvalMetric {
  return {
    metricName,
    threshold,
    criterion,
    customFunctionPath,
  };
}

/**
 * Creates an LLM-as-a-judge criterion.
 *
 * @param judgeModelOptions - Options for the judge model
 * @returns An LlmAsAJudgeCriterion instance
 */
export function createLlmAsJudgeCriterion(
  judgeModelOptions?: JudgeModelOptions
): LlmAsAJudgeCriterion {
  return {
    type: 'llm_as_a_judge',
    judgeModelOptions,
  };
}

/**
 * Creates a rubrics-based criterion.
 *
 * @param rubrics - List of rubrics to evaluate against
 * @param judgeModelOptions - Options for the judge model
 * @returns A RubricsBasedCriterion instance
 */
export function createRubricsBasedCriterion(
  rubrics: Rubric[],
  judgeModelOptions?: JudgeModelOptions
): RubricsBasedCriterion {
  return {
    type: 'rubrics_based',
    judgeModelOptions,
    rubrics,
  };
}

/**
 * Creates a tool trajectory criterion.
 *
 * @param matchType - How to match tool calls
 * @returns A ToolTrajectoryCriterion instance
 */
export function createToolTrajectoryCriterion(
  matchType: ToolTrajectoryMatchType = ToolTrajectoryMatchType.EXACT
): ToolTrajectoryCriterion {
  return {
    type: 'tool_trajectory',
    matchType,
  };
}

/**
 * Creates a hallucinations criterion.
 *
 * @param judgeModelOptions - Options for the judge model
 * @param sentenceSegmentation - Whether to segment by sentence
 * @returns A HallucinationsCriterion instance
 */
export function createHallucinationsCriterion(
  judgeModelOptions?: JudgeModelOptions,
  sentenceSegmentation: boolean = true
): HallucinationsCriterion {
  return {
    type: 'hallucinations',
    judgeModelOptions,
    sentenceSegmentation,
  };
}

/**
 * Interval definition for metric values.
 */
export interface Interval {
  minValue?: number;
  maxValue?: number;
}

/**
 * Information about metric value ranges.
 */
export interface MetricValueInfo {
  interval?: Interval;
}

/**
 * Metric information including name, description, and value ranges.
 */
export interface MetricInfo {
  metricName: string;
  description?: string;
  metricValueInfo?: MetricValueInfo;
}

/**
 * Code configuration for custom metrics.
 */
export interface CodeConfig {
  /** Path to the custom metric function (e.g., "my_module.my_function") */
  name: string;

  /** Optional arguments (not supported for custom metrics). */
  args?: unknown;
}

/**
 * Configuration for a custom metric.
 *
 * This follows the Python ADK pattern for specifying custom metrics
 * in evaluation config files.
 */
export interface CustomMetricConfig {
  /**
   * Code config for the custom metric, used to locate the custom metric function.
   */
  codeConfig: CodeConfig;

  /**
   * Optional metric info for the custom metric.
   */
  metricInfo?: MetricInfo;

  /**
   * Description for the custom metric (used if metricInfo not provided).
   */
  description?: string;
}

/**
 * Creates a default MetricInfo for a metric.
 *
 * @param metricName - Name of the metric
 * @param description - Optional description
 * @returns A MetricInfo with default interval [0, 1]
 */
export function createDefaultMetricInfo(
  metricName: string,
  description?: string
): MetricInfo {
  return {
    metricName,
    description,
    metricValueInfo: {
      interval: {minValue: 0.0, maxValue: 1.0},
    },
  };
}
