/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agent evaluator - main orchestrator for agent evaluation.
 *
 * Coordinates running eval cases, generating responses, and evaluating results.
 */

import {type Content} from '@google/genai';
import {type EvalCase, type Invocation, createInvocation} from './eval_case.js';
import {type EvalSet} from './eval_set.js';
import {type EvalConfig, validateEvalConfig} from './eval_config.js';
import {
  type EvalCaseResult,
  type EvalSetResult,
  type EvalMetricResult,
  type EvalMetricResultPerInvocation,
  createEvalCaseResult,
  createEvalSetResult,
} from './eval_result.js';
import {EvalStatus} from './eval_metrics.js';
import {type EvaluationResult} from './evaluator.js';
import {MetricEvaluatorRegistry} from './metric_evaluator_registry.js';
import {
  UserSimulator,
  StaticUserSimulator,
  LlmBackedUserSimulator,
} from './simulation/index.js';
import {type BaseAgent} from '../agents/base_agent.js';
import {Runner} from '../runner/runner.js';
import {InMemorySessionService} from '../sessions/in_memory_session_service.js';
import {InMemoryArtifactService} from '../artifacts/in_memory_artifact_service.js';
import {logger} from '../utils/logger.js';

/**
 * Options for agent evaluation.
 */
export interface AgentEvaluatorOptions {
  /** The agent to evaluate. */
  agent: BaseAgent;

  /** The evaluation configuration. */
  evalConfig: EvalConfig;

  /** Optional user simulator for scenario-based eval cases. */
  userSimulator?: UserSimulator;

  /** Optional app name (default: 'eval_app'). */
  appName?: string;
}

/**
 * Result from running a single eval case.
 */
export interface EvalCaseRunResult {
  /** The eval case that was run. */
  evalCase: EvalCase;

  /** The actual invocations generated. */
  actualInvocations: Invocation[];

  /** Evaluation results per metric. */
  metricResults: Map<string, EvaluationResult>;
}

/**
 * Main orchestrator for agent evaluation.
 *
 * Handles:
 * - Running eval cases against agents
 * - Generating responses (with user simulation for scenarios)
 * - Evaluating responses against metrics
 * - Aggregating results
 */
export class AgentEvaluator {
  private readonly agent: BaseAgent;
  private readonly evalConfig: EvalConfig;
  private readonly userSimulator: UserSimulator;
  private readonly appName: string;
  private readonly runner: Runner;

  /**
   * Creates a new AgentEvaluator.
   *
   * @param options - The evaluator options
   */
  constructor(options: AgentEvaluatorOptions) {
    validateEvalConfig(options.evalConfig);

    this.agent = options.agent;
    this.evalConfig = options.evalConfig;
    this.appName = options.appName ?? 'eval_app';

    // Use provided simulator or create default LLM-backed one
    this.userSimulator = options.userSimulator ?? new LlmBackedUserSimulator();

    // Create runner with in-memory services for evaluation
    this.runner = new Runner({
      agent: this.agent,
      appName: this.appName,
      sessionService: new InMemorySessionService(),
      artifactService: new InMemoryArtifactService(),
    });
  }

  /**
   * Evaluates a single eval case.
   *
   * @param evalCase - The eval case to evaluate
   * @returns Evaluation results for this case
   */
  async evaluateCase(evalCase: EvalCase): Promise<EvalCaseResult> {
    logger.info(`Evaluating case: ${evalCase.evalId}`);

    try {
      // Generate actual invocations by running the agent
      const actualInvocations = await this.generateInvocations(evalCase);

      // Get expected invocations (if static conversation)
      const expectedInvocations = evalCase.conversation;

      // Evaluate against each metric
      const overallResults: EvalMetricResult[] = [];
      const perInvocationResults: EvalMetricResultPerInvocation[] = [];

      for (const metric of this.evalConfig.metrics) {
        try {
          const evaluator = MetricEvaluatorRegistry.getEvaluator(metric);

          const evalResult = await evaluator.evaluateInvocations(
            actualInvocations,
            expectedInvocations,
            evalCase.conversationScenario
          );

          // Convert to EvalMetricResult
          overallResults.push({
            metricName: metric.metricName,
            score: evalResult.overallScore,
            evalStatus: evalResult.overallEvalStatus,
            threshold: metric.threshold,
            rationale: evalResult.errorMessage,
          });

          // Collect per-invocation results
          for (const perInv of evalResult.perInvocationResults) {
            const existingIdx = perInvocationResults.findIndex(
              (r) => r.invocationId === perInv.actualInvocation.invocationId
            );

            const metricResult: EvalMetricResult = {
              metricName: metric.metricName,
              score: perInv.score,
              evalStatus: perInv.evalStatus,
              threshold: metric.threshold,
              rubricScores: perInv.rubricScores,
              rationale: perInv.rationale,
            };

            if (existingIdx >= 0) {
              perInvocationResults[existingIdx].metricResults.push(metricResult);
            } else {
              perInvocationResults.push({
                invocationId: perInv.actualInvocation.invocationId,
                metricResults: [metricResult],
              });
            }
          }
        } catch (error) {
          logger.warn(`Error evaluating metric ${metric.metricName}: ${error}`);
          overallResults.push({
            metricName: metric.metricName,
            evalStatus: EvalStatus.NOT_EVALUATED,
            threshold: metric.threshold,
            errorMessage: `Evaluation error: ${error}`,
          });
        }
      }

      return createEvalCaseResult(
        evalCase.evalId,
        overallResults,
        perInvocationResults
      );
    } catch (error) {
      logger.error(`Error running eval case ${evalCase.evalId}: ${error}`);
      return {
        evalCaseId: evalCase.evalId,
        overallEvalMetricResults: [],
        evalMetricResultPerInvocation: [],
        creationTimestamp: Date.now(),
        errorMessage: `Case execution error: ${error}`,
      };
    }
  }

  /**
   * Evaluates an entire eval set.
   *
   * @param evalSet - The eval set to evaluate
   * @returns Results for all cases
   */
  async evaluateEvalSet(evalSet: EvalSet): Promise<EvalSetResult> {
    logger.info(`Evaluating eval set: ${evalSet.evalSetId} with ${evalSet.evalCases.length} cases`);

    const evalCaseResults: EvalCaseResult[] = [];

    for (const evalCase of evalSet.evalCases) {
      const result = await this.evaluateCase(evalCase);
      evalCaseResults.push(result);
    }

    const evalSetResultId = `${evalSet.evalSetId}_${Date.now()}`;
    return createEvalSetResult(evalSetResultId, evalSet.evalSetId, evalCaseResults);
  }

  /**
   * Generates invocations by running the agent.
   *
   * @param evalCase - The eval case to run
   * @returns Generated invocations
   */
  private async generateInvocations(evalCase: EvalCase): Promise<Invocation[]> {
    if (evalCase.conversation) {
      // Static conversation - run each user message through the agent
      return this.generateStaticInvocations(evalCase);
    } else if (evalCase.conversationScenario) {
      // Dynamic scenario - use user simulator
      return this.generateScenarioInvocations(evalCase);
    } else {
      throw new Error('Eval case must have either conversation or conversationScenario');
    }
  }

  /**
   * Generates invocations from a static conversation.
   */
  private async generateStaticInvocations(evalCase: EvalCase): Promise<Invocation[]> {
    const invocations: Invocation[] = [];
    const userId = `eval_user_${Date.now()}`;
    const session = await this.runner.sessionService.createSession({
      appName: this.appName,
      userId,
    });

    // Apply session input if provided
    if (evalCase.sessionInput?.state) {
      for (const [key, value] of Object.entries(evalCase.sessionInput.state)) {
        session.state[key] = value;
      }
    }

    for (const expectedInv of evalCase.conversation!) {
      const userContent = expectedInv.userContent;

      // Run the agent
      const events: unknown[] = [];
      let finalResponse: Content | undefined;

      for await (const event of this.runner.runAsync({
        userId,
        sessionId: session.id,
        newMessage: userContent,
      })) {
        events.push(event);

        // Extract final response from events
        if (event && typeof event === 'object' && 'content' in event) {
          finalResponse = (event as {content: Content}).content;
        }
      }

      // Create invocation with collected data
      const invocation = createInvocation(
        expectedInv.invocationId,
        userContent,
        finalResponse,
        {
          modelResponses: events,
        }
      );

      invocations.push(invocation);
    }

    return invocations;
  }

  /**
   * Generates invocations from a conversation scenario using user simulation.
   */
  private async generateScenarioInvocations(evalCase: EvalCase): Promise<Invocation[]> {
    const scenario = evalCase.conversationScenario!;
    const invocations: Invocation[] = [];
    const conversationHistory: Content[] = [];

    const userId = `eval_user_${Date.now()}`;
    const session = await this.runner.sessionService.createSession({
      appName: this.appName,
      userId,
    });

    // Apply session input if provided
    if (evalCase.sessionInput?.state) {
      for (const [key, value] of Object.entries(evalCase.sessionInput.state)) {
        session.state[key] = value;
      }
    }

    this.userSimulator.reset();
    const maxTurns = scenario.maxTurns ?? 10;

    // Use initial message or generate first user message
    let userContent: Content | undefined = scenario.initialMessage;

    for (let turn = 0; turn < maxTurns; turn++) {
      // Generate user message if not provided
      if (!userContent) {
        const simResult = await this.userSimulator.generateUserMessage({
          scenario,
          conversationHistory,
          lastAgentResponse: invocations.length > 0
            ? invocations[invocations.length - 1].finalResponse
            : undefined,
          turnNumber: turn,
        });

        userContent = simResult.userMessage;

        if (simResult.isComplete && turn > 0) {
          logger.debug(`Conversation completed: ${simResult.completionReason}`);
          break;
        }
      }

      // Run the agent
      const events: unknown[] = [];
      let finalResponse: Content | undefined;

      for await (const event of this.runner.runAsync({
        userId,
        sessionId: session.id,
        newMessage: userContent,
      })) {
        events.push(event);

        if (event && typeof event === 'object' && 'content' in event) {
          finalResponse = (event as {content: Content}).content;
        }
      }

      // Create invocation
      const invocationId = `inv_${evalCase.evalId}_${turn}`;
      const invocation = createInvocation(
        invocationId,
        userContent,
        finalResponse,
        {
          modelResponses: events,
        }
      );

      invocations.push(invocation);
      conversationHistory.push(userContent);
      if (finalResponse) {
        conversationHistory.push(finalResponse);
      }

      // Reset for next turn
      userContent = undefined;
    }

    return invocations;
  }
}

/**
 * Creates an AgentEvaluator for evaluating an agent.
 *
 * @param agent - The agent to evaluate
 * @param evalConfig - The evaluation configuration
 * @param options - Additional options
 * @returns A new AgentEvaluator
 */
export function createAgentEvaluator(
  agent: BaseAgent,
  evalConfig: EvalConfig,
  options?: Partial<AgentEvaluatorOptions>
): AgentEvaluator {
  return new AgentEvaluator({
    agent,
    evalConfig,
    ...options,
  });
}
