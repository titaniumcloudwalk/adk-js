/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {
  CustomMetricEvaluator,
  PathBasedCustomMetricEvaluator,
  createCustomEvaluator,
  createPathBasedCustomEvaluator,
  getMetricFunction,
  type CustomEvalFunction,
  type FullCustomEvalFunction,
} from '../../src/evaluation/custom_metric_evaluator.js';
import {EvalStatus, createEvalMetric} from '../../src/evaluation/eval_metrics.js';
import type {Invocation, ConversationScenario} from '../../src/evaluation/eval_case.js';
import type {EvaluationResult} from '../../src/evaluation/evaluator.js';

describe('CustomMetricEvaluator', () => {
  describe('constructor', () => {
    it('creates evaluator with name, function, and default threshold', () => {
      const evalFn: CustomEvalFunction = async () => ({score: 0.8});
      const evaluator = new CustomMetricEvaluator('test_metric', evalFn);
      expect(evaluator.name).toBe('test_metric');
    });

    it('creates evaluator with custom threshold', () => {
      const evalFn: CustomEvalFunction = async () => ({score: 0.8});
      const evaluator = new CustomMetricEvaluator('test_metric', evalFn, 0.9);
      expect(evaluator.name).toBe('test_metric');
    });
  });

  describe('evaluateInvocations', () => {
    it('evaluates invocations and returns results', async () => {
      const evalFn: CustomEvalFunction = async (actual, expected) => ({
        score: actual.invocationId === expected?.invocationId ? 1.0 : 0.5,
        rationale: 'Test rationale',
      });
      const evaluator = new CustomMetricEvaluator('test_metric', evalFn);

      const actualInvocations: Invocation[] = [
        {
          invocationId: 'inv1',
          userContent: {parts: [{text: 'Hello'}], role: 'user'},
          creationTimestamp: Date.now(),
        },
      ];
      const expectedInvocations: Invocation[] = [
        {
          invocationId: 'inv1',
          userContent: {parts: [{text: 'Hello'}], role: 'user'},
          finalResponse: {parts: [{text: 'Hi'}], role: 'model'},
          creationTimestamp: Date.now(),
        },
      ];

      const result = await evaluator.evaluateInvocations(
        actualInvocations,
        expectedInvocations
      );

      expect(result.overallScore).toBe(1.0);
      expect(result.overallEvalStatus).toBe(EvalStatus.PASSED);
      expect(result.perInvocationResults).toHaveLength(1);
      expect(result.perInvocationResults[0].score).toBe(1.0);
      expect(result.perInvocationResults[0].rationale).toBe('Test rationale');
    });

    it('marks invocation as FAILED when score below threshold', async () => {
      const evalFn: CustomEvalFunction = async () => ({score: 0.3});
      const evaluator = new CustomMetricEvaluator('test_metric', evalFn, 0.5);

      const result = await evaluator.evaluateInvocations([
        {
          invocationId: 'inv1',
          userContent: {parts: [{text: 'Test'}], role: 'user'},
          creationTimestamp: Date.now(),
        },
      ]);

      expect(result.perInvocationResults[0].evalStatus).toBe(EvalStatus.FAILED);
      expect(result.overallEvalStatus).toBe(EvalStatus.FAILED);
    });

    it('handles evaluation errors gracefully', async () => {
      const evalFn: CustomEvalFunction = async () => {
        throw new Error('Evaluation failed');
      };
      const evaluator = new CustomMetricEvaluator('test_metric', evalFn);

      const result = await evaluator.evaluateInvocations([
        {
          invocationId: 'inv1',
          userContent: {parts: [{text: 'Test'}], role: 'user'},
          creationTimestamp: Date.now(),
        },
      ]);

      expect(result.perInvocationResults[0].evalStatus).toBe(EvalStatus.NOT_EVALUATED);
      expect(result.perInvocationResults[0].rationale).toContain('Custom evaluation error');
    });

    it('matches invocations by invocationId', async () => {
      const evalFn: CustomEvalFunction = async (actual, expected) => ({
        score: expected?.finalResponse ? 1.0 : 0.0,
      });
      const evaluator = new CustomMetricEvaluator('test_metric', evalFn);

      const actualInvocations: Invocation[] = [
        {
          invocationId: 'inv2',
          userContent: {parts: [{text: 'Second'}], role: 'user'},
          creationTimestamp: Date.now(),
        },
      ];
      const expectedInvocations: Invocation[] = [
        {
          invocationId: 'inv1',
          userContent: {parts: [{text: 'First'}], role: 'user'},
          creationTimestamp: Date.now(),
        },
        {
          invocationId: 'inv2',
          userContent: {parts: [{text: 'Second'}], role: 'user'},
          finalResponse: {parts: [{text: 'Response'}], role: 'model'},
          creationTimestamp: Date.now(),
        },
      ];

      const result = await evaluator.evaluateInvocations(
        actualInvocations,
        expectedInvocations
      );

      // Should match by invocationId, not index
      expect(result.perInvocationResults[0].score).toBe(1.0);
    });
  });

  describe('createCustomEvaluator', () => {
    it('creates a CustomMetricEvaluator', () => {
      const evalFn: CustomEvalFunction = async () => ({score: 1.0});
      const evaluator = createCustomEvaluator('my_metric', evalFn, 0.7);
      expect(evaluator).toBeInstanceOf(CustomMetricEvaluator);
      expect(evaluator.name).toBe('my_metric');
    });
  });
});

describe('PathBasedCustomMetricEvaluator', () => {
  describe('constructor', () => {
    it('creates evaluator with metric and function path', () => {
      const metric = createEvalMetric('test_metric', 0.5);
      const evaluator = new PathBasedCustomMetricEvaluator(metric, 'my_module.my_function');
      expect(evaluator.name).toBe('test_metric');
    });
  });

  describe('evaluateInvocations', () => {
    it('loads and calls the function with all invocations', async () => {
      // Mock the import mechanism
      const mockResult: EvaluationResult = {
        overallScore: 0.8,
        overallEvalStatus: EvalStatus.PASSED,
        perInvocationResults: [],
      };

      const mockFunction: FullCustomEvalFunction = vi.fn().mockResolvedValue(mockResult);

      // We can't easily mock dynamic imports, so let's test the class behavior
      // by creating a derived class that overrides loadFunction
      class TestPathBasedEvaluator extends PathBasedCustomMetricEvaluator {
        private readonly mockFn: FullCustomEvalFunction;
        constructor(metric: ReturnType<typeof createEvalMetric>, path: string, fn: FullCustomEvalFunction) {
          super(metric, path);
          this.mockFn = fn;
        }
        protected override async loadFunction() {
          return this.mockFn;
        }
      }

      const metric = createEvalMetric('test_metric', 0.5);
      const evaluator = new TestPathBasedEvaluator(metric, 'mock.path', mockFunction);

      const actualInvocations: Invocation[] = [
        {
          invocationId: 'inv1',
          userContent: {parts: [{text: 'Test'}], role: 'user'},
          creationTimestamp: Date.now(),
        },
      ];

      const result = await evaluator.evaluateInvocations(actualInvocations);

      expect(mockFunction).toHaveBeenCalledWith(actualInvocations, undefined, undefined);
      expect(result.overallScore).toBe(0.8);
      expect(result.overallEvalStatus).toBe(EvalStatus.PASSED);
    });

    it('applies threshold from metric', async () => {
      const mockResult: EvaluationResult = {
        overallScore: 0.4, // Below threshold
        perInvocationResults: [],
      };

      const mockFunction: FullCustomEvalFunction = vi.fn().mockResolvedValue(mockResult);

      class TestPathBasedEvaluator extends PathBasedCustomMetricEvaluator {
        private readonly mockFn: FullCustomEvalFunction;
        constructor(metric: ReturnType<typeof createEvalMetric>, path: string, fn: FullCustomEvalFunction) {
          super(metric, path);
          this.mockFn = fn;
        }
        protected override async loadFunction() {
          return this.mockFn;
        }
      }

      const metric = createEvalMetric('test_metric', 0.5); // Threshold is 0.5
      const evaluator = new TestPathBasedEvaluator(metric, 'mock.path', mockFunction);

      const result = await evaluator.evaluateInvocations([]);

      // Should be FAILED because 0.4 < 0.5
      expect(result.overallEvalStatus).toBe(EvalStatus.FAILED);
    });
  });

  describe('createPathBasedCustomEvaluator', () => {
    it('creates a PathBasedCustomMetricEvaluator', () => {
      const metric = createEvalMetric('test_metric', 0.5);
      const evaluator = createPathBasedCustomEvaluator(metric, 'my_module.my_function');
      expect(evaluator).toBeInstanceOf(PathBasedCustomMetricEvaluator);
      expect(evaluator.name).toBe('test_metric');
    });
  });
});

describe('getMetricFunction', () => {
  it('throws error for invalid path format (no dot)', async () => {
    await expect(getMetricFunction('invalid_path')).rejects.toThrow(
      /Invalid custom function path format/
    );
  });

  it('throws error when module cannot be imported', async () => {
    await expect(getMetricFunction('nonexistent.module.function')).rejects.toThrow(
      /Could not import/
    );
  });

  // Note: Testing successful imports would require setting up actual modules,
  // which is complex in a test environment. The error cases above verify the
  // function's error handling behavior.
});
