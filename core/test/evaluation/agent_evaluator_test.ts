/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {AgentEvaluator, type AgentEvaluatorOptions} from '../../src/evaluation/agent_evaluator.js';
import {type EvalCase} from '../../src/evaluation/eval_case.js';
import {type EvalConfig} from '../../src/evaluation/eval_config.js';
import {EvalStatus} from '../../src/evaluation/eval_metrics.js';
import {type BaseAgent} from '../../src/agents/base_agent.js';
import {type InvocationContext} from '../../src/agents/invocation_context.js';
import {type Event} from '../../src/events/event.js';

// Create a mock agent that fails to produce responses
class FailingAgent implements BaseAgent {
  readonly name = 'failing-agent';
  readonly description = 'An agent that fails to produce responses';

  async *runAsyncImpl(_ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    // Agent that doesn't yield any events
    return;
  }

  async *runLiveImpl(_ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    return;
  }
}

// Create a mock agent that throws errors
class ErrorThrowingAgent implements BaseAgent {
  readonly name = 'error-agent';
  readonly description = 'An agent that throws errors';

  async *runAsyncImpl(_ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    throw new Error('Agent execution failed');
  }

  async *runLiveImpl(_ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    throw new Error('Agent execution failed');
  }
}

describe('AgentEvaluator', () => {
  const evalConfig: EvalConfig = {
    metrics: [
      {
        metricName: 'response_match_score',
        threshold: 0.5,
      },
      {
        metricName: 'tool_trajectory_avg_score',
        threshold: 0.8,
        matchType: 'EXACT',
      },
    ],
  };

  describe('evaluateCase with null/empty inferences', () => {
    it('should return NOT_EVALUATED when agent generates no invocations', async () => {
      const evalCase: EvalCase = {
        evalId: 'test-case-1',
        conversation: [
          {
            invocationId: 'inv-1',
            userContent: {
              role: 'user',
              parts: [{text: 'Hello'}],
            },
            expectedAgentContent: {
              role: 'model',
              parts: [{text: 'Hi there!'}],
            },
          },
        ],
      };

      // Create evaluator with a mock that returns empty invocations
      const options: AgentEvaluatorOptions = {
        agent: new FailingAgent() as unknown as BaseAgent,
        evalConfig,
      };

      const evaluator = new AgentEvaluator(options);

      // Mock generateInvocations to return empty array
      vi.spyOn(evaluator as unknown as {generateInvocations: () => Promise<[]>}, 'generateInvocations')
        .mockResolvedValue([]);

      const result = await evaluator.evaluateCase(evalCase);

      // Verify NOT_EVALUATED result
      expect(result.evalCaseId).toBe('test-case-1');
      expect(result.errorMessage).toContain('no invocations were generated');
      expect(result.evalMetricResultPerInvocation).toHaveLength(0);

      // Verify each metric has NOT_EVALUATED status
      expect(result.overallEvalMetricResults).toHaveLength(2);
      for (const metricResult of result.overallEvalMetricResults) {
        expect(metricResult.evalStatus).toBe(EvalStatus.NOT_EVALUATED);
        expect(metricResult.errorMessage).toContain('no invocations were generated');
      }
    });

    it('should return NOT_EVALUATED when agent throws error during inference', async () => {
      const evalCase: EvalCase = {
        evalId: 'test-case-2',
        conversation: [
          {
            invocationId: 'inv-1',
            userContent: {
              role: 'user',
              parts: [{text: 'Hello'}],
            },
          },
        ],
      };

      const options: AgentEvaluatorOptions = {
        agent: new ErrorThrowingAgent() as unknown as BaseAgent,
        evalConfig,
      };

      const evaluator = new AgentEvaluator(options);

      // Mock generateInvocations to throw error
      vi.spyOn(evaluator as unknown as {generateInvocations: () => Promise<[]>}, 'generateInvocations')
        .mockRejectedValue(new Error('Agent execution failed'));

      const result = await evaluator.evaluateCase(evalCase);

      // Verify NOT_EVALUATED result
      expect(result.evalCaseId).toBe('test-case-2');
      expect(result.errorMessage).toContain('Case execution error');
      expect(result.evalMetricResultPerInvocation).toHaveLength(0);

      // Verify each metric has NOT_EVALUATED status
      expect(result.overallEvalMetricResults).toHaveLength(2);
      for (const metricResult of result.overallEvalMetricResults) {
        expect(metricResult.evalStatus).toBe(EvalStatus.NOT_EVALUATED);
      }
    });

    it('should return NOT_EVALUATED when generateInvocations returns null', async () => {
      const evalCase: EvalCase = {
        evalId: 'test-case-3',
        conversation: [
          {
            invocationId: 'inv-1',
            userContent: {
              role: 'user',
              parts: [{text: 'Hello'}],
            },
          },
        ],
      };

      const options: AgentEvaluatorOptions = {
        agent: new FailingAgent() as unknown as BaseAgent,
        evalConfig,
      };

      const evaluator = new AgentEvaluator(options);

      // Mock generateInvocations to return null (cast to any to simulate undefined behavior)
      vi.spyOn(evaluator as unknown as {generateInvocations: () => Promise<null>}, 'generateInvocations')
        .mockResolvedValue(null as unknown as []);

      const result = await evaluator.evaluateCase(evalCase);

      // Verify NOT_EVALUATED result
      expect(result.evalCaseId).toBe('test-case-3');
      expect(result.errorMessage).toContain('no invocations were generated');
      expect(result.overallEvalMetricResults).toHaveLength(2);
      for (const metricResult of result.overallEvalMetricResults) {
        expect(metricResult.evalStatus).toBe(EvalStatus.NOT_EVALUATED);
      }
    });

    it('should include all configured metrics in NOT_EVALUATED result', async () => {
      const multiMetricConfig: EvalConfig = {
        metrics: [
          {metricName: 'metric1', threshold: 0.5},
          {metricName: 'metric2', threshold: 0.6},
          {metricName: 'metric3', threshold: 0.7},
          {metricName: 'metric4', threshold: 0.8},
        ],
      };

      const evalCase: EvalCase = {
        evalId: 'test-case-4',
        conversation: [
          {
            invocationId: 'inv-1',
            userContent: {role: 'user', parts: [{text: 'Test'}]},
          },
        ],
      };

      const options: AgentEvaluatorOptions = {
        agent: new FailingAgent() as unknown as BaseAgent,
        evalConfig: multiMetricConfig,
      };

      const evaluator = new AgentEvaluator(options);

      vi.spyOn(evaluator as unknown as {generateInvocations: () => Promise<[]>}, 'generateInvocations')
        .mockResolvedValue([]);

      const result = await evaluator.evaluateCase(evalCase);

      // Verify all 4 metrics are represented
      expect(result.overallEvalMetricResults).toHaveLength(4);

      const metricNames = result.overallEvalMetricResults.map((r) => r.metricName);
      expect(metricNames).toContain('metric1');
      expect(metricNames).toContain('metric2');
      expect(metricNames).toContain('metric3');
      expect(metricNames).toContain('metric4');

      // Verify thresholds are preserved
      const metric1 = result.overallEvalMetricResults.find((r) => r.metricName === 'metric1');
      expect(metric1?.threshold).toBe(0.5);

      const metric4 = result.overallEvalMetricResults.find((r) => r.metricName === 'metric4');
      expect(metric4?.threshold).toBe(0.8);
    });
  });
});
