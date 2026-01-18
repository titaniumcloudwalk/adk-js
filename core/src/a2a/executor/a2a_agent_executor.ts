/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A2A Agent Executor - Runs ADK agents against A2A requests and publishes
 * updates to an event queue.
 */

import {v4 as uuidv4} from '../../utils/uuid.js';
import type {Runner} from '../../runner/runner.js';
import type {Session} from '../../sessions/session.js';
import {
  InvocationContext,
  newInvocationContextId,
} from '../../agents/invocation_context.js';
import {createRunConfig} from '../../agents/run_config.js';
import {logger} from '../../utils/logger.js';
import {logA2aExperimentalWarning} from '../experimental.js';
import {
  type A2APartToGenAIPartConverter,
  type GenAIPartToA2APartConverter,
  convertA2aPartToGenaiPart,
  convertGenaiPartToA2aPart,
} from '../converters/part_converter.js';
import {
  type A2ARequestToAgentRunRequestConverter,
  type AgentRunRequest,
  type A2ARequestContext,
  convertA2aRequestToAgentRunRequest,
} from '../converters/request_converter.js';
import {
  type AdkEventToA2AEventsConverter,
  type A2AEvent,
  type A2ATaskStatusUpdateEvent,
  type A2ATaskArtifactUpdateEvent,
  convertEventToA2aEvents,
} from '../converters/event_converter.js';
import {getAdkMetadataKey} from '../converters/utils.js';
import {TaskResultAggregator} from './task_result_aggregator.js';

/**
 * Event queue interface for publishing A2A events.
 */
export interface A2AEventQueue {
  enqueueEvent(event: A2AEvent): Promise<void>;
}

/**
 * Configuration for the A2aAgentExecutor.
 */
export interface A2aAgentExecutorConfig {
  /** Converter for A2A parts to GenAI parts */
  a2aPartConverter?: A2APartToGenAIPartConverter;
  /** Converter for GenAI parts to A2A parts */
  genAiPartConverter?: GenAIPartToA2APartConverter;
  /** Converter for A2A requests to agent run requests */
  requestConverter?: A2ARequestToAgentRunRequestConverter;
  /** Converter for ADK events to A2A events */
  eventConverter?: AdkEventToA2AEventsConverter;
}

/**
 * Factory function type for creating runners.
 */
export type RunnerFactory = () => Runner | Promise<Runner>;

/**
 * An AgentExecutor that runs an ADK Agent against an A2A request and
 * publishes updates to an event queue.
 */
export class A2aAgentExecutor {
  private _runner: Runner | RunnerFactory;
  private readonly _config: Required<A2aAgentExecutorConfig>;

  /**
   * Creates a new A2aAgentExecutor.
   *
   * @param runner - The ADK Runner or a factory function that returns a Runner.
   * @param config - Optional configuration for converters.
   */
  constructor(
    runner: Runner | RunnerFactory,
    config?: A2aAgentExecutorConfig
  ) {
    logA2aExperimentalWarning();

    this._runner = runner;
    this._config = {
      a2aPartConverter: config?.a2aPartConverter ?? convertA2aPartToGenaiPart,
      genAiPartConverter: config?.genAiPartConverter ?? convertGenaiPartToA2aPart,
      requestConverter: config?.requestConverter ?? convertA2aRequestToAgentRunRequest,
      eventConverter: config?.eventConverter ?? convertEventToA2aEvents,
    };
  }

  /**
   * Resolves the runner, handling cases where it's a callable that returns a Runner.
   */
  private async resolveRunner(): Promise<Runner> {
    // If already resolved and cached, return it
    if (typeof this._runner !== 'function') {
      return this._runner;
    }

    // Call the function to get the runner
    const result = this._runner();

    // Handle async callables
    const resolvedRunner = result instanceof Promise ? await result : result;

    // Cache the resolved runner for future calls
    this._runner = resolvedRunner;
    return resolvedRunner;
  }

  /**
   * Cancels the execution.
   * Currently not implemented.
   */
  async cancel(
    _context: A2ARequestContext,
    _eventQueue: A2AEventQueue
  ): Promise<void> {
    throw new Error('Cancellation is not supported');
  }

  /**
   * Executes an A2A request and publishes updates to the event queue.
   *
   * This method:
   * 1. Takes the input from the A2A request
   * 2. Converts the input to ADK input content, and runs the ADK agent
   * 3. Collects output events of the underlying ADK Agent
   * 4. Converts the ADK output events into A2A task updates
   * 5. Publishes the updates back to A2A server via event queue
   *
   * @param context - The A2A request context.
   * @param eventQueue - The event queue for publishing A2A events.
   */
  async execute(
    context: A2ARequestContext,
    eventQueue: A2AEventQueue
  ): Promise<void> {
    if (!context.message) {
      throw new Error('A2A request must have a message');
    }

    // For new task, create a task submitted event
    if (!context.currentTask) {
      await eventQueue.enqueueEvent({
        kind: 'status_update',
        taskId: context.taskId,
        contextId: context.contextId,
        status: {
          state: 'submitted',
          message: context.message,
          timestamp: new Date().toISOString(),
        },
        final: false,
      } as A2ATaskStatusUpdateEvent);
    }

    // Handle the request and publish updates to the event queue
    try {
      await this.handleRequest(context, eventQueue);
    } catch (e) {
      logger.error(`Error handling A2A request: ${e}`);

      // Publish failure event
      try {
        await eventQueue.enqueueEvent({
          kind: 'status_update',
          taskId: context.taskId,
          contextId: context.contextId,
          status: {
            state: 'failed',
            timestamp: new Date().toISOString(),
            message: {
              messageId: uuidv4(),
              role: 'agent',
              parts: [{kind: 'text', text: String(e)}],
            },
          },
          final: true,
        } as A2ATaskStatusUpdateEvent);
      } catch (enqueueError) {
        logger.error(`Failed to publish failure event: ${enqueueError}`);
      }
    }
  }

  /**
   * Handles the A2A request internally.
   */
  private async handleRequest(
    context: A2ARequestContext,
    eventQueue: A2AEventQueue
  ): Promise<void> {
    // Resolve the runner instance
    const runner = await this.resolveRunner();

    // Convert the a2a request to AgentRunRequest
    const runRequest = this._config.requestConverter(
      context,
      this._config.a2aPartConverter
    );

    // Ensure the session exists
    const session = await this.prepareSession(context, runRequest, runner);

    // Create invocation context for event conversion
    const runConfig = createRunConfig(runRequest.runConfig);
    const invocationContext = new InvocationContext({
      artifactService: runner.artifactService,
      sessionService: runner.sessionService,
      memoryService: runner.memoryService,
      credentialService: runner.credentialService,
      invocationId: newInvocationContextId(),
      agent: runner.agent,
      session,
      userContent: runRequest.newMessage,
      runConfig,
      pluginManager: runner.pluginManager,
    });

    // Publish the task working event
    await eventQueue.enqueueEvent({
      kind: 'status_update',
      taskId: context.taskId,
      contextId: context.contextId,
      status: {
        state: 'working',
        timestamp: new Date().toISOString(),
      },
      metadata: {
        [getAdkMetadataKey('app_name')]: runner.appName,
        [getAdkMetadataKey('user_id')]: runRequest.userId,
        [getAdkMetadataKey('session_id')]: runRequest.sessionId,
      },
      final: false,
    } as A2ATaskStatusUpdateEvent);

    // Run the agent and collect events
    const taskResultAggregator = new TaskResultAggregator();

    // Build the runner args
    const runnerArgs = {
      userId: runRequest.userId ?? 'default_user',
      sessionId: session.id,
      newMessage: runRequest.newMessage!,
      stateDelta: runRequest.stateDelta,
      runConfig: runRequest.runConfig,
    };

    for await (const adkEvent of runner.runAsync(runnerArgs)) {
      const a2aEvents = this._config.eventConverter(
        adkEvent,
        invocationContext,
        context.taskId,
        context.contextId,
        this._config.genAiPartConverter
      );

      for (const a2aEvent of a2aEvents) {
        taskResultAggregator.processEvent(a2aEvent);
        await eventQueue.enqueueEvent(a2aEvent);
      }
    }

    // Publish the task result event - this is final
    const taskState = taskResultAggregator.taskState;
    const taskStatusMessage = taskResultAggregator.taskStatusMessage;

    if (
      taskState === 'working' &&
      taskStatusMessage &&
      taskStatusMessage.parts.length > 0
    ) {
      // If task is still working properly, publish the artifact update event as
      // the final result according to A2A protocol.
      await eventQueue.enqueueEvent({
        kind: 'artifact_update',
        taskId: context.taskId,
        contextId: context.contextId,
        lastChunk: true,
        artifact: {
          artifactId: uuidv4(),
          parts: taskStatusMessage.parts,
        },
      } as A2ATaskArtifactUpdateEvent);

      // Publish the final status update event
      await eventQueue.enqueueEvent({
        kind: 'status_update',
        taskId: context.taskId,
        contextId: context.contextId,
        status: {
          state: 'completed',
          timestamp: new Date().toISOString(),
        },
        final: true,
      } as A2ATaskStatusUpdateEvent);
    } else {
      await eventQueue.enqueueEvent({
        kind: 'status_update',
        taskId: context.taskId,
        contextId: context.contextId,
        status: {
          state: taskState,
          timestamp: new Date().toISOString(),
          message: taskStatusMessage,
        },
        final: true,
      } as A2ATaskStatusUpdateEvent);
    }
  }

  /**
   * Prepares the session for the request.
   */
  private async prepareSession(
    _context: A2ARequestContext,
    runRequest: AgentRunRequest,
    runner: Runner
  ): Promise<Session> {
    const sessionId = runRequest.sessionId;
    const userId = runRequest.userId ?? 'default_user';

    // Try to get existing session if we have a session ID
    let session: Session | undefined;
    if (sessionId) {
      session = await runner.sessionService.getSession({
        appName: runner.appName,
        userId,
        sessionId,
      });
    }

    // Create a new session if it doesn't exist
    if (!session) {
      session = await runner.sessionService.createSession({
        appName: runner.appName,
        userId,
        state: {},
        sessionId,
      });
      // Update run_request with the new session_id
      runRequest.sessionId = session.id;
    }

    return session;
  }
}
