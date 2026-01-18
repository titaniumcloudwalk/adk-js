/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Evaluation framework constants.
 */

/**
 * Names of prebuilt evaluation metrics.
 */
export const PREBUILT_METRIC_NAMES = {
  TOOL_TRAJECTORY_AVG_SCORE: 'tool_trajectory_avg_score',
  RESPONSE_EVALUATION_SCORE: 'response_evaluation_score',
  RESPONSE_MATCH_SCORE: 'response_match_score',
  SAFETY_V1: 'safety_v1',
  FINAL_RESPONSE_MATCH_V2: 'final_response_match_v2',
  RUBRIC_BASED_FINAL_RESPONSE_QUALITY_V1: 'rubric_based_final_response_quality_v1',
  HALLUCINATIONS_V1: 'hallucinations_v1',
  RUBRIC_BASED_TOOL_USE_QUALITY_V1: 'rubric_based_tool_use_quality_v1',
  PER_TURN_USER_SIMULATOR_QUALITY_V1: 'per_turn_user_simulator_quality_v1',
} as const;

/**
 * Default number of samples for LLM-as-judge evaluators.
 */
export const DEFAULT_NUM_SAMPLES = 3;

/**
 * Default similarity threshold for response matching.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.8;

/**
 * Default threshold for metrics.
 */
export const DEFAULT_METRIC_THRESHOLD = 0.5;

/**
 * State key prefix for evaluation data.
 */
export const EVAL_STATE_PREFIX = '__eval__';

/**
 * Key for storing tool calls in intermediate data.
 */
export const TOOL_CALLS_KEY = 'tool_calls';

/**
 * Key for storing tool responses in intermediate data.
 */
export const TOOL_RESPONSES_KEY = 'tool_responses';

/**
 * Default model for LLM-as-judge evaluators.
 */
export const DEFAULT_JUDGE_MODEL = 'gemini-2.0-flash';

/**
 * Rubric types.
 */
export const RUBRIC_TYPES = {
  FINAL_RESPONSE_QUALITY: 'FINAL_RESPONSE_QUALITY',
  TOOL_USE_QUALITY: 'TOOL_USE_QUALITY',
  HALLUCINATION: 'HALLUCINATION',
  SAFETY: 'SAFETY',
} as const;
