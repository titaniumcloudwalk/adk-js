/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Metric evaluator registry.
 *
 * Factory for creating evaluators from metric configurations.
 */

import {type EvalMetric, type Criterion} from './eval_metrics.js';
import {type Evaluator} from './evaluator.js';
import {TrajectoryEvaluator} from './trajectory_evaluator.js';
import {ResponseEvaluator} from './response_evaluator.js';
import {FinalResponseMatchV2Evaluator} from './final_response_match_v2.js';
import {RubricBasedFinalResponseQualityV1Evaluator} from './rubric_based_final_response_quality_v1.js';
import {RubricBasedToolUseQualityV1Evaluator} from './rubric_based_tool_use_quality_v1.js';
import {HallucinationsV1Evaluator} from './hallucinations_v1.js';
import {SafetyEvaluatorV1} from './safety_evaluator.js';
import {CustomMetricEvaluator, type CustomEvalFunction} from './custom_metric_evaluator.js';
import {PREBUILT_METRIC_NAMES} from './constants.js';

/**
 * Enum of prebuilt metric names for type safety.
 */
export const PrebuiltMetrics = PREBUILT_METRIC_NAMES;

/**
 * Type for evaluator factory functions.
 */
type EvaluatorFactory = (metric: EvalMetric) => Evaluator;

/**
 * Registry for mapping metric names to evaluator factories.
 *
 * Supports both prebuilt metrics and custom registered evaluators.
 */
export class MetricEvaluatorRegistry {
  private static readonly factories: Map<string, EvaluatorFactory> = new Map();
  private static readonly customFunctions: Map<string, CustomEvalFunction> = new Map();
  private static initialized = false;

  /**
   * Initializes the registry with prebuilt evaluators.
   */
  private static initialize(): void {
    if (this.initialized) return;

    // Register prebuilt evaluators
    this.factories.set(
      PREBUILT_METRIC_NAMES.TOOL_TRAJECTORY_AVG_SCORE,
      (metric) => new TrajectoryEvaluator(
        metric.criterion?.type === 'tool_trajectory' ? metric.criterion : undefined,
        metric.threshold
      )
    );

    this.factories.set(
      PREBUILT_METRIC_NAMES.RESPONSE_MATCH_SCORE,
      (metric) => new ResponseEvaluator(metric.threshold)
    );

    this.factories.set(
      PREBUILT_METRIC_NAMES.FINAL_RESPONSE_MATCH_V2,
      (metric) => new FinalResponseMatchV2Evaluator(
        metric.criterion?.type === 'llm_as_a_judge' ? metric.criterion : undefined,
        metric.threshold
      )
    );

    this.factories.set(
      PREBUILT_METRIC_NAMES.RUBRIC_BASED_FINAL_RESPONSE_QUALITY_V1,
      (metric) => {
        if (metric.criterion?.type !== 'rubrics_based') {
          throw new Error(
            `${PREBUILT_METRIC_NAMES.RUBRIC_BASED_FINAL_RESPONSE_QUALITY_V1} requires a rubrics_based criterion`
          );
        }
        return new RubricBasedFinalResponseQualityV1Evaluator(metric.criterion, metric.threshold);
      }
    );

    this.factories.set(
      PREBUILT_METRIC_NAMES.RUBRIC_BASED_TOOL_USE_QUALITY_V1,
      (metric) => {
        if (metric.criterion?.type !== 'rubrics_based') {
          throw new Error(
            `${PREBUILT_METRIC_NAMES.RUBRIC_BASED_TOOL_USE_QUALITY_V1} requires a rubrics_based criterion`
          );
        }
        return new RubricBasedToolUseQualityV1Evaluator(metric.criterion, metric.threshold);
      }
    );

    this.factories.set(
      PREBUILT_METRIC_NAMES.HALLUCINATIONS_V1,
      (metric) => new HallucinationsV1Evaluator(
        metric.criterion?.type === 'hallucinations' ? metric.criterion : undefined,
        metric.threshold
      )
    );

    this.factories.set(
      PREBUILT_METRIC_NAMES.SAFETY_V1,
      (metric) => new SafetyEvaluatorV1(metric.threshold)
    );

    this.initialized = true;
  }

  /**
   * Gets an evaluator for a metric.
   *
   * @param metric - The metric configuration
   * @returns The evaluator instance
   * @throws Error if no evaluator is found for the metric
   */
  static getEvaluator(metric: EvalMetric): Evaluator {
    this.initialize();

    // Check for prebuilt metric
    const factory = this.factories.get(metric.metricName);
    if (factory) {
      return factory(metric);
    }

    // Check for custom function
    const customFunction = this.customFunctions.get(metric.metricName);
    if (customFunction) {
      return new CustomMetricEvaluator(metric.metricName, customFunction, metric.threshold);
    }

    // Check if custom function path is provided
    if (metric.customFunctionPath) {
      throw new Error(
        `Custom function path '${metric.customFunctionPath}' specified but not loaded. ` +
        `Register the function using MetricEvaluatorRegistry.registerCustomFunction().`
      );
    }

    throw new Error(
      `No evaluator found for metric '${metric.metricName}'. ` +
      `Available prebuilt metrics: ${Object.values(PREBUILT_METRIC_NAMES).join(', ')}`
    );
  }

  /**
   * Registers a custom evaluator factory.
   *
   * @param metricName - The metric name to register
   * @param factory - The factory function
   */
  static registerEvaluator(metricName: string, factory: EvaluatorFactory): void {
    this.initialize();
    this.factories.set(metricName, factory);
  }

  /**
   * Registers a custom evaluation function.
   *
   * @param metricName - The metric name to register
   * @param evalFunction - The custom evaluation function
   */
  static registerCustomFunction(metricName: string, evalFunction: CustomEvalFunction): void {
    this.initialize();
    this.customFunctions.set(metricName, evalFunction);
  }

  /**
   * Checks if a metric is registered.
   *
   * @param metricName - The metric name to check
   * @returns True if registered
   */
  static hasMetric(metricName: string): boolean {
    this.initialize();
    return this.factories.has(metricName) || this.customFunctions.has(metricName);
  }

  /**
   * Gets all registered metric names.
   *
   * @returns Array of metric names
   */
  static getRegisteredMetrics(): string[] {
    this.initialize();
    const names = new Set([...this.factories.keys(), ...this.customFunctions.keys()]);
    return Array.from(names);
  }

  /**
   * Clears all custom registrations (for testing).
   */
  static clearCustomRegistrations(): void {
    // Only clear custom registrations, keep prebuilt
    this.customFunctions.clear();
    // Re-initialize to ensure prebuilt are present
    this.initialized = false;
    this.initialize();
  }
}
