/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Evaluation configuration type.
 *
 * Defines which metrics to evaluate and their configurations.
 */

import {type EvalMetric} from './eval_metrics.js';

/**
 * Configuration for running an evaluation.
 *
 * Specifies which metrics to evaluate and any global evaluation settings.
 */
export interface EvalConfig {
  /**
   * List of metrics to evaluate.
   */
  metrics: EvalMetric[];

  /**
   * Optional number of times to repeat each eval case (for variance measurement).
   */
  numRepeats?: number;

  /**
   * Optional maximum number of parallel evaluations.
   */
  maxParallelEvaluations?: number;

  /**
   * Optional flag to continue on individual metric failures.
   */
  continueOnError?: boolean;

  /**
   * Optional timeout for each evaluation in milliseconds.
   */
  timeoutMs?: number;
}

/**
 * Creates a new EvalConfig instance.
 *
 * @param metrics - List of metrics to evaluate
 * @param options - Optional configuration options
 * @returns A new EvalConfig instance
 */
export function createEvalConfig(
  metrics: EvalMetric[],
  options?: {
    numRepeats?: number;
    maxParallelEvaluations?: number;
    continueOnError?: boolean;
    timeoutMs?: number;
  }
): EvalConfig {
  return {
    metrics,
    numRepeats: options?.numRepeats,
    maxParallelEvaluations: options?.maxParallelEvaluations,
    continueOnError: options?.continueOnError,
    timeoutMs: options?.timeoutMs,
  };
}

/**
 * Validates an EvalConfig.
 *
 * @param config - The config to validate
 * @throws Error if the config is invalid
 */
export function validateEvalConfig(config: EvalConfig): void {
  if (!config.metrics || config.metrics.length === 0) {
    throw new Error('EvalConfig must have at least one metric');
  }

  for (const metric of config.metrics) {
    if (!metric.metricName) {
      throw new Error('Each metric must have a metricName');
    }
    if (metric.threshold < 0 || metric.threshold > 1) {
      throw new Error(
        `Metric ${metric.metricName} has invalid threshold: ${metric.threshold}. Must be between 0 and 1.`
      );
    }
  }

  if (config.numRepeats !== undefined && config.numRepeats < 1) {
    throw new Error('numRepeats must be at least 1');
  }

  if (config.maxParallelEvaluations !== undefined && config.maxParallelEvaluations < 1) {
    throw new Error('maxParallelEvaluations must be at least 1');
  }

  if (config.timeoutMs !== undefined && config.timeoutMs < 1000) {
    throw new Error('timeoutMs must be at least 1000ms');
  }
}

/**
 * Gets metric names from an EvalConfig.
 *
 * @param config - The config to extract from
 * @returns Array of metric names
 */
export function getMetricNames(config: EvalConfig): string[] {
  return config.metrics.map((m) => m.metricName);
}

/**
 * Finds a metric by name in an EvalConfig.
 *
 * @param config - The config to search
 * @param metricName - The name to find
 * @returns The metric, or undefined if not found
 */
export function findMetric(config: EvalConfig, metricName: string): EvalMetric | undefined {
  return config.metrics.find((m) => m.metricName === metricName);
}
