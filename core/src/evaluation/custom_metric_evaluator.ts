/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Custom metric evaluator.
 *
 * Allows users to define custom evaluation functions, either directly
 * or by loading them from a module path.
 */

import {type Invocation, type ConversationScenario} from './eval_case.js';
import {
  type EvaluationResult,
  type PerInvocationResult,
  Evaluator,
  computeAverageScore,
  computeOverallStatus,
} from './evaluator.js';
import {type EvalMetric, EvalStatus} from './eval_metrics.js';

/**
 * Custom evaluation function signature (per-invocation).
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
 * Custom evaluation function signature (full invocations).
 * This signature matches the Python implementation which receives all
 * invocations at once.
 *
 * @param actualInvocations - The actual invocations to evaluate
 * @param expectedInvocations - Optional expected invocations for comparison
 * @param conversationScenario - Optional conversation scenario
 * @returns An EvaluationResult
 */
export type FullCustomEvalFunction = (
  actualInvocations: Invocation[],
  expectedInvocations?: Invocation[],
  conversationScenario?: ConversationScenario
) => Promise<EvaluationResult> | EvaluationResult;

/**
 * Loads a custom metric function from a module path.
 *
 * The path should be in the format "module.path.functionName" where:
 * - module.path is the module to import (resolved relative to cwd)
 * - functionName is the exported function name
 *
 * @param customFunctionPath - The path to the custom metric function
 * @returns The loaded function
 * @throws Error if the function cannot be loaded
 */
export async function getMetricFunction(
  customFunctionPath: string
): Promise<FullCustomEvalFunction> {
  try {
    // Split the path into module and function parts
    const lastDotIndex = customFunctionPath.lastIndexOf('.');
    if (lastDotIndex === -1) {
      throw new Error(
        `Invalid custom function path format: ${customFunctionPath}. ` +
        `Expected format: "module.path.functionName"`
      );
    }

    const modulePath = customFunctionPath.substring(0, lastDotIndex);
    const functionName = customFunctionPath.substring(lastDotIndex + 1);

    // Convert module path to file path (e.g., "my.custom.metrics" -> "./my/custom/metrics")
    const filePath = modulePath.replace(/\./g, '/');

    // Try to import the module
    let module: Record<string, unknown>;
    try {
      // First try as a relative path from cwd
      module = await import(`${process.cwd()}/${filePath}.js`);
    } catch {
      try {
        // Try with .ts extension
        module = await import(`${process.cwd()}/${filePath}.ts`);
      } catch {
        try {
          // Try as a package name
          module = await import(modulePath);
        } catch {
          throw new Error(
            `Could not import module from path: ${modulePath}. ` +
            `Tried: ${filePath}.js, ${filePath}.ts, and package ${modulePath}`
          );
        }
      }
    }

    // Get the function from the module
    const metricFunction = module[functionName] as FullCustomEvalFunction | undefined;
    if (!metricFunction || typeof metricFunction !== 'function') {
      throw new Error(
        `Function '${functionName}' not found in module '${modulePath}'. ` +
        `Available exports: ${Object.keys(module).join(', ')}`
      );
    }

    return metricFunction;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not import custom metric function from ${customFunctionPath}: ${errorMessage}`
    );
  }
}

/**
 * Gets evaluation status based on score and threshold.
 */
function getEvalStatus(score: number | undefined, threshold: number): EvalStatus {
  if (score === undefined) {
    return EvalStatus.NOT_EVALUATED;
  }
  return score >= threshold ? EvalStatus.PASSED : EvalStatus.FAILED;
}

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

/**
 * Evaluator that loads a custom evaluation function from a module path.
 *
 * This follows the Python ADK pattern where custom metrics can be specified
 * in config files using a path like "my_module.my_function".
 */
export class PathBasedCustomMetricEvaluator extends Evaluator {
  private readonly evalMetric: EvalMetric;
  private readonly customFunctionPath: string;
  private metricFunction?: FullCustomEvalFunction;

  /**
   * Creates a new PathBasedCustomMetricEvaluator.
   *
   * @param evalMetric - The evaluation metric configuration
   * @param customFunctionPath - Path to the custom metric function (e.g., "my_module.my_function")
   */
  constructor(evalMetric: EvalMetric, customFunctionPath: string) {
    super(evalMetric.metricName);
    this.evalMetric = evalMetric;
    this.customFunctionPath = customFunctionPath;
  }

  /**
   * Lazily loads the metric function.
   */
  private async loadFunction(): Promise<FullCustomEvalFunction> {
    if (!this.metricFunction) {
      this.metricFunction = await getMetricFunction(this.customFunctionPath);
    }
    return this.metricFunction;
  }

  async evaluateInvocations(
    actualInvocations: Invocation[],
    expectedInvocations?: Invocation[],
    conversationScenario?: ConversationScenario
  ): Promise<EvaluationResult> {
    const metricFunction = await this.loadFunction();

    // Call the custom function with all invocations (Python pattern)
    let evalResult = await metricFunction(
      actualInvocations,
      expectedInvocations,
      conversationScenario
    );

    // Ensure overallEvalStatus is set based on threshold
    evalResult = {
      ...evalResult,
      overallEvalStatus: getEvalStatus(evalResult.overallScore, this.evalMetric.threshold),
    };

    return evalResult;
  }
}

/**
 * Creates a path-based custom metric evaluator.
 *
 * @param evalMetric - The evaluation metric configuration
 * @param customFunctionPath - Path to the custom metric function
 * @returns A new PathBasedCustomMetricEvaluator
 */
export function createPathBasedCustomEvaluator(
  evalMetric: EvalMetric,
  customFunctionPath: string
): PathBasedCustomMetricEvaluator {
  return new PathBasedCustomMetricEvaluator(evalMetric, customFunctionPath);
}
