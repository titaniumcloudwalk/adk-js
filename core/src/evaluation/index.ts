/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Evaluation Framework
 *
 * This module provides a comprehensive evaluation framework for ADK agents,
 * including support for multiple evaluation criteria, eval sets, and results management.
 */

// Core types
export {
  createInvocation,
  createEvalCase,
  createEvalCaseWithScenario,
  getToolCalls,
  getToolNames,
  getTextFromContent,
} from './eval_case.js';
export type {
  EvalCase,
  Invocation,
  IntermediateData,
  InvocationEvents,
  SessionInput,
  AppDetails,
  ToolCall,
  ToolResponse,
  ConversationScenario,
  StaticConversation,
} from './eval_case.js';

// Eval set
export {
  createEvalSet,
  addEvalCaseToSet,
  removeEvalCaseFromSet,
  findEvalCase,
  updateEvalCaseInSet,
  getEvalCaseCount,
} from './eval_set.js';
export type {EvalSet} from './eval_set.js';

// Metrics
export {
  EvalStatus,
  ToolTrajectoryMatchType,
  createEvalMetric,
  createLlmAsJudgeCriterion,
  createRubricsBasedCriterion,
  createToolTrajectoryCriterion,
  createHallucinationsCriterion,
} from './eval_metrics.js';
export type {
  EvalMetric,
  BaseCriterion,
  LlmAsAJudgeCriterion,
  RubricsBasedCriterion,
  HallucinationsCriterion,
  ToolTrajectoryCriterion,
  LlmBackedUserSimulatorCriterion,
  Criterion,
  JudgeModelOptions,
} from './eval_metrics.js';

// Rubrics
export {
  createRubric,
  createRubricScore,
  aggregateRubricScores,
} from './eval_rubrics.js';
export type {
  Rubric,
  RubricScore,
  RubricContent,
} from './eval_rubrics.js';

// Results
export {
  createEvalCaseResult,
  createEvalSetResult,
  computeEvalSetSummary,
  createPassedMetricResult,
  createFailedMetricResult,
  createNotEvaluatedMetricResult,
} from './eval_result.js';
export type {
  EvalCaseResult,
  EvalSetResult,
  EvalMetricResult,
  EvalMetricResultPerInvocation,
  EvalSetResultSummary,
} from './eval_result.js';

// Evaluator base
export {
  Evaluator,
  createPassedResult,
  createFailedResult,
  createErrorResult,
  computeAverageScore,
  computeOverallStatus,
  createPerInvocationResult,
} from './evaluator.js';
export type {
  EvaluationResult,
  PerInvocationResult,
} from './evaluator.js';

// Config
export {
  createEvalConfig,
  validateEvalConfig,
  getMetricNames,
  findMetric,
} from './eval_config.js';
export type {EvalConfig} from './eval_config.js';

// Managers
export {EvalSetsManager} from './eval_sets_manager.js';
export {EvalSetResultsManager} from './eval_set_results_manager.js';
export {InMemoryEvalSetsManager} from './in_memory_eval_sets_manager.js';
export {LocalEvalSetsManager} from './local_eval_sets_manager.js';
export {LocalEvalSetResultsManager} from './local_eval_set_results_manager.js';

// Evaluators
export {MetricEvaluatorRegistry, PrebuiltMetrics} from './metric_evaluator_registry.js';
export {TrajectoryEvaluator} from './trajectory_evaluator.js';
export {ResponseEvaluator} from './response_evaluator.js';
export {LlmAsJudge, parseScoreFromText} from './llm_as_judge.js';
export type {AutoRaterScore} from './llm_as_judge.js';
export {RubricBasedEvaluator} from './rubric_based_evaluator.js';
export {FinalResponseMatchV2Evaluator} from './final_response_match_v2.js';
export {RubricBasedFinalResponseQualityV1Evaluator} from './rubric_based_final_response_quality_v1.js';
export {RubricBasedToolUseQualityV1Evaluator} from './rubric_based_tool_use_quality_v1.js';
export {HallucinationsV1Evaluator} from './hallucinations_v1.js';
export {SafetyEvaluatorV1, SAFETY_CATEGORIES} from './safety_evaluator.js';
export {CustomMetricEvaluator, createCustomEvaluator} from './custom_metric_evaluator.js';
export type {CustomEvalFunction} from './custom_metric_evaluator.js';

// Agent evaluator
export {AgentEvaluator, createAgentEvaluator} from './agent_evaluator.js';
export type {AgentEvaluatorOptions, EvalCaseRunResult} from './agent_evaluator.js';

// User Simulation
export {
  UserSimulator,
  StaticUserSimulator,
  LlmBackedUserSimulator,
} from './simulation/index.js';
export {createStaticUserSimulator} from './simulation/static_user_simulator.js';
export type {
  UserSimulatorContext,
  UserSimulatorResult,
} from './simulation/user_simulator.js';

// Constants
export {
  PREBUILT_METRIC_NAMES,
  DEFAULT_NUM_SAMPLES,
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_METRIC_THRESHOLD,
  DEFAULT_JUDGE_MODEL,
  RUBRIC_TYPES,
} from './constants.js';
