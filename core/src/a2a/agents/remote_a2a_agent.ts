/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RemoteA2aAgent - An agent that communicates with a remote A2A agent via A2A client.
 *
 * This agent supports multiple ways to specify the remote agent:
 * 1. Direct AgentCard object
 * 2. URL to agent card JSON
 * 3. File path to agent card JSON
 *
 * The agent handles:
 * - Agent card resolution and validation
 * - HTTP client management with proper resource cleanup
 * - A2A message conversion and error handling
 * - Session state management across requests
 */

import {Content} from '@google/genai';
import {v4 as uuidv4} from '../../utils/uuid.js';
import {BaseAgent, BaseAgentConfig} from '../../agents/base_agent.js';
import type {InvocationContext} from '../../agents/invocation_context.js';
import {Event, createEvent} from '../../events/event.js';
import {logger} from '../../utils/logger.js';
import {logA2aExperimentalWarning, a2aExperimental} from '../experimental.js';
import {
  type A2APart,
  type A2APartToGenAIPartConverter,
  type GenAIPartToA2APartConverter,
  convertA2aPartToGenaiPart,
  convertGenaiPartToA2aPart,
} from '../converters/part_converter.js';
import {
  convertA2aMessageToEvent,
  convertEventToA2aMessage,
} from '../converters/event_converter.js';
import type {A2AMessage as ConverterA2AMessage} from '../converters/request_converter.js';
import {buildA2aRequestLog, buildA2aResponseLog} from '../logs/log_utils.js';
import type {AgentCard} from '../utils/agent_card_builder.js';

// Constants
const A2A_METADATA_PREFIX = 'a2a:';
const DEFAULT_TIMEOUT = 600000; // 600 seconds in milliseconds

/**
 * Error thrown when agent card resolution fails.
 */
@a2aExperimental
export class AgentCardResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentCardResolutionError';
  }
}

/**
 * Error thrown when A2A client operations fail.
 */
@a2aExperimental
export class A2AClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'A2AClientError';
  }
}

/**
 * A2A Message interface for RemoteA2aAgent (supports both camelCase and snake_case).
 */
export interface A2AMessage {
  messageId?: string;
  message_id?: string;
  parts: A2APart[];
  role: string;
  taskId?: string;
  task_id?: string;
  contextId?: string;
  context_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Converts local A2AMessage to converter-compatible format.
 */
function toConverterMessage(message: A2AMessage): ConverterA2AMessage {
  return {
    messageId: message.messageId ?? message.message_id ?? uuidv4(),
    role: (message.role === 'user' || message.role === 'agent') ? message.role : 'agent',
    parts: message.parts,
    metadata: message.metadata,
  };
}

/**
 * A2A Task interface for RemoteA2aAgent.
 */
export interface A2ATask {
  id: string;
  contextId?: string;
  context_id?: string;
  status: {
    state: string;
    message?: A2AMessage;
    timestamp?: string;
  };
  history?: A2AMessage[];
  artifacts?: Array<{
    artifactId: string;
    parts: A2APart[];
    metadata?: Record<string, unknown>;
  }>;
  metadata?: Record<string, unknown>;
}

/**
 * A2A Response types.
 */
export type A2AClientResponse = A2AMessage | [A2ATask, unknown];

/**
 * Configuration for RemoteA2aAgent.
 */
export interface RemoteA2aAgentConfig extends BaseAgentConfig {
  /** AgentCard object, URL string, or file path string */
  agentCard: AgentCard | string;
  /** HTTP timeout in milliseconds (default: 600000) */
  timeout?: number;
  /** Optional custom converter from GenAI parts to A2A parts */
  genaiPartConverter?: GenAIPartToA2APartConverter;
  /** Optional custom converter from A2A parts to GenAI parts */
  a2aPartConverter?: A2APartToGenAIPartConverter;
  /**
   * Optional callable that takes InvocationContext and A2AMessage
   * and returns metadata to attach to the A2A request.
   */
  a2aRequestMetaProvider?: (
    ctx: InvocationContext,
    message: A2AMessage
  ) => Record<string, unknown>;
  /**
   * If true, stateless agents will receive all session events on every request.
   * If false (default), only events since the last reply from the agent will be sent.
   */
  fullHistoryWhenStateless?: boolean;
}

/**
 * Agent that communicates with a remote A2A agent via A2A client.
 *
 * This agent acts as a client to remote A2A services, allowing ADK agents
 * to delegate work to agents exposed via the A2A protocol.
 */
@a2aExperimental
export class RemoteA2aAgent extends BaseAgent {
  private _agentCard?: AgentCard;
  private readonly _agentCardSource?: string;
  private readonly _timeout: number;
  private _isResolved = false;
  private readonly _genaiPartConverter: GenAIPartToA2APartConverter;
  private readonly _a2aPartConverter: A2APartToGenAIPartConverter;
  private readonly _a2aRequestMetaProvider?: (
    ctx: InvocationContext,
    message: A2AMessage
  ) => Record<string, unknown>;
  private readonly _fullHistoryWhenStateless: boolean;

  constructor(config: RemoteA2aAgentConfig) {
    super(config);
    logA2aExperimentalWarning();

    const {agentCard} = config;
    if (agentCard === null || agentCard === undefined) {
      throw new Error('agentCard cannot be null or undefined');
    }

    this._timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this._genaiPartConverter = config.genaiPartConverter ?? convertGenaiPartToA2aPart;
    this._a2aPartConverter = config.a2aPartConverter ?? convertA2aPartToGenaiPart;
    this._a2aRequestMetaProvider = config.a2aRequestMetaProvider;
    this._fullHistoryWhenStateless = config.fullHistoryWhenStateless ?? false;

    // Validate and store agent card reference
    if (typeof agentCard === 'object') {
      this._agentCard = agentCard;
    } else if (typeof agentCard === 'string') {
      if (!agentCard.trim()) {
        throw new Error('agentCard string cannot be empty');
      }
      this._agentCardSource = agentCard.trim();
    } else {
      throw new TypeError(
        `agentCard must be AgentCard, URL string, or file path string, got ${typeof agentCard}`
      );
    }
  }

  /**
   * Gets the resolved agent card.
   */
  get agentCard(): AgentCard | undefined {
    return this._agentCard;
  }

  /**
   * Resolves agent card from URL.
   */
  private async resolveAgentCardFromUrl(url: string): Promise<AgentCard> {
    try {
      const parsedUrl = new URL(url);
      if (!parsedUrl.protocol || !parsedUrl.host) {
        throw new Error(`Invalid URL format: ${url}`);
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(this._timeout),
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}`
        );
      }

      const agentCardData = await response.json();
      return agentCardData as AgentCard;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new AgentCardResolutionError(
        `Failed to resolve AgentCard from URL ${url}: ${errorMessage}`
      );
    }
  }

  /**
   * Resolves agent card from file path (Node.js only).
   */
  private async resolveAgentCardFromFile(filePath: string): Promise<AgentCard> {
    try {
      // Dynamic import for Node.js fs module
      const fs = await import('fs/promises');
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const agentCardData = JSON.parse(fileContent);
      return agentCardData as AgentCard;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new AgentCardResolutionError(
        `Failed to resolve AgentCard from file ${filePath}: ${errorMessage}`
      );
    }
  }

  /**
   * Resolves agent card from source (URL or file path).
   */
  private async resolveAgentCard(): Promise<AgentCard> {
    if (!this._agentCardSource) {
      throw new AgentCardResolutionError('No agent card source specified');
    }

    // Determine if source is URL or file path
    if (
      this._agentCardSource.startsWith('http://') ||
      this._agentCardSource.startsWith('https://')
    ) {
      return await this.resolveAgentCardFromUrl(this._agentCardSource);
    } else {
      return await this.resolveAgentCardFromFile(this._agentCardSource);
    }
  }

  /**
   * Validates the resolved agent card.
   */
  private validateAgentCard(agentCard: AgentCard): void {
    if (!agentCard.url) {
      throw new AgentCardResolutionError(
        'Agent card must have a valid URL for RPC communication'
      );
    }

    try {
      const parsedUrl = new URL(agentCard.url);
      if (!parsedUrl.protocol || !parsedUrl.host) {
        throw new Error('Invalid RPC URL format');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new AgentCardResolutionError(
        `Invalid RPC URL in agent card: ${agentCard.url}, error: ${errorMessage}`
      );
    }
  }

  /**
   * Ensures agent card is resolved, RPC URL is determined.
   */
  private async ensureResolved(): Promise<void> {
    if (this._isResolved && this._agentCard) {
      return;
    }

    try {
      if (!this._agentCard) {
        this._agentCard = await this.resolveAgentCard();
        this.validateAgentCard(this._agentCard);

        // Update description if empty
        if (!this.description && this._agentCard.description) {
          (this as {description?: string}).description = this._agentCard.description;
        }
      }

      this._isResolved = true;
      logger.info(`Successfully resolved remote A2A agent: ${this.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to resolve remote A2A agent ${this.name}: ${errorMessage}`);
      throw new AgentCardResolutionError(
        `Failed to initialize remote A2A agent ${this.name}: ${errorMessage}`
      );
    }
  }

  /**
   * Checks if an event is a response from this remote agent.
   */
  private isRemoteResponse(event: Event): boolean {
    return (
      event.author === this.name &&
      event.customMetadata !== undefined &&
      (event.customMetadata[A2A_METADATA_PREFIX + 'response'] ?? false) !== false
    );
  }

  /**
   * Constructs A2A message parts from session events.
   */
  private constructMessagePartsFromSession(
    ctx: InvocationContext
  ): {parts: A2APart[]; contextId: string | undefined} {
    const messageParts: A2APart[] = [];
    let contextId: string | undefined;

    const eventsToProcess: Event[] = [];

    // Work backwards through events
    const events = [...ctx.session.events].reverse();
    for (const event of events) {
      if (this.isRemoteResponse(event)) {
        // Stop on content generated by current A2A agent
        if (event.customMetadata) {
          contextId = event.customMetadata[A2A_METADATA_PREFIX + 'context_id'] as
            | string
            | undefined;
        }
        // For backwards compatibility with stateful agents
        if (!this._fullHistoryWhenStateless || contextId) {
          break;
        }
      }
      eventsToProcess.push(event);
    }

    // Process events in original order
    for (const event of eventsToProcess.reverse()) {
      if (!event.content?.parts) {
        continue;
      }

      for (const part of event.content.parts) {
        const convertedParts = this._genaiPartConverter(part);
        if (convertedParts) {
          if (Array.isArray(convertedParts)) {
            messageParts.push(...convertedParts);
          } else {
            messageParts.push(convertedParts);
          }
        } else {
          logger.warn(`Failed to convert part to A2A format: ${JSON.stringify(part)}`);
        }
      }
    }

    return {parts: messageParts, contextId};
  }

  /**
   * Sends an A2A message to the remote agent.
   */
  private async sendA2aMessage(
    message: A2AMessage,
    ctx: InvocationContext
  ): Promise<A2AClientResponse> {
    if (!this._agentCard?.url) {
      throw new A2AClientError('Agent card URL not resolved');
    }

    const requestBody: Record<string, unknown> = {
      jsonrpc: '2.0',
      method: 'message/send',
      id: uuidv4(),
      params: {
        message: {
          messageId: message.messageId ?? message.message_id ?? uuidv4(),
          role: message.role,
          parts: message.parts,
          taskId: message.taskId ?? message.task_id,
          contextId: message.contextId ?? message.context_id,
          metadata: message.metadata,
        },
      },
    };

    // Add request metadata if provider is set
    if (this._a2aRequestMetaProvider) {
      const requestMeta = this._a2aRequestMetaProvider(ctx, message);
      if (requestMeta) {
        (requestBody.params as Record<string, unknown>).metadata = requestMeta;
      }
    }

    try {
      const response = await fetch(this._agentCard.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this._timeout),
      });

      if (!response.ok) {
        throw new A2AClientError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status
        );
      }

      const responseData = await response.json();

      // Handle JSON-RPC response
      if (responseData.error) {
        throw new A2AClientError(
          `A2A RPC Error: ${responseData.error.message ?? JSON.stringify(responseData.error)}`,
          responseData.error.code
        );
      }

      const result = responseData.result;

      // Determine if response is a Task or a Message
      if (result && result.status !== undefined) {
        // It's a Task
        return [result as A2ATask, null] as [A2ATask, unknown];
      } else if (result && (result.role !== undefined || result.parts !== undefined)) {
        // It's a Message
        return result as A2AMessage;
      }

      // Default to treating it as a message
      return result as A2AMessage;
    } catch (error) {
      if (error instanceof A2AClientError) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new A2AClientError(`A2A request failed: ${errorMessage}`);
    }
  }

  /**
   * Handles A2A response and converts to Event.
   */
  private async handleA2aResponse(
    a2aResponse: A2AClientResponse,
    ctx: InvocationContext
  ): Promise<Event | undefined> {
    try {
      let event: Event;

      if (Array.isArray(a2aResponse)) {
        // It's a [Task, UpdateEvent] tuple
        const [task, _update] = a2aResponse;

        // Convert task to event
        const message = task.status?.message;
        if (message) {
          event = convertA2aMessageToEvent(
            toConverterMessage(message),
            this.name,
            ctx,
            this._a2aPartConverter
          );
        } else {
          // Create empty event for tasks without message
          event = createEvent({
            author: this.name,
            content: {parts: []},
            invocationId: ctx.invocationId,
            branch: ctx.branch,
          });
        }

        // Add task metadata
        event.customMetadata = event.customMetadata ?? {};
        event.customMetadata[A2A_METADATA_PREFIX + 'task_id'] = task.id;
        if (task.contextId ?? task.context_id) {
          event.customMetadata[A2A_METADATA_PREFIX + 'context_id'] =
            task.contextId ?? task.context_id;
        }
      } else {
        // It's a Message
        event = convertA2aMessageToEvent(
          toConverterMessage(a2aResponse as A2AMessage),
          this.name,
          ctx,
          this._a2aPartConverter
        );

        event.customMetadata = event.customMetadata ?? {};
        if (a2aResponse.contextId ?? a2aResponse.context_id) {
          event.customMetadata[A2A_METADATA_PREFIX + 'context_id'] =
            a2aResponse.contextId ?? a2aResponse.context_id;
        }
      }

      return event;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to handle A2A response: ${errorMessage}`);
      return createEvent({
        author: this.name,
        errorMessage: `Failed to process A2A response: ${errorMessage}`,
        invocationId: ctx.invocationId,
        branch: ctx.branch,
      });
    }
  }

  /**
   * Core implementation for async agent execution.
   */
  protected async *runAsyncImpl(
    ctx: InvocationContext
  ): AsyncGenerator<Event, void, void> {
    try {
      await this.ensureResolved();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      yield createEvent({
        author: this.name,
        errorMessage: `Failed to initialize remote A2A agent: ${errorMessage}`,
        invocationId: ctx.invocationId,
        branch: ctx.branch,
      });
      return;
    }

    // Construct message parts from session
    const {parts: messageParts, contextId} = this.constructMessagePartsFromSession(ctx);

    if (messageParts.length === 0) {
      logger.warn('No parts to send to remote A2A agent. Emitting empty event.');
      yield createEvent({
        author: this.name,
        content: {parts: []} as Content,
        invocationId: ctx.invocationId,
        branch: ctx.branch,
      });
      return;
    }

    const a2aRequest: A2AMessage = {
      messageId: uuidv4(),
      parts: messageParts,
      role: 'user',
      contextId,
    };

    logger.debug(buildA2aRequestLog(a2aRequest));

    try {
      const a2aResponse = await this.sendA2aMessage(a2aRequest, ctx);
      logger.debug(buildA2aResponseLog(a2aResponse));

      const event = await this.handleA2aResponse(a2aResponse, ctx);
      if (!event) {
        return;
      }

      // Add metadata about the request and response
      event.customMetadata = event.customMetadata ?? {};
      event.customMetadata[A2A_METADATA_PREFIX + 'request'] = a2aRequest;
      event.customMetadata[A2A_METADATA_PREFIX + 'response'] = a2aResponse;

      yield event;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const statusCode = error instanceof A2AClientError ? error.statusCode : undefined;

      logger.error(errorMessage);

      yield createEvent({
        author: this.name,
        errorMessage,
        invocationId: ctx.invocationId,
        branch: ctx.branch,
        customMetadata: {
          [A2A_METADATA_PREFIX + 'request']: a2aRequest,
          [A2A_METADATA_PREFIX + 'error']: errorMessage,
          ...(statusCode ? {[A2A_METADATA_PREFIX + 'status_code']: String(statusCode)} : {}),
        },
      });
    }
  }

  /**
   * Core implementation for live agent execution (not implemented).
   */
  protected async *runLiveImpl(
    _ctx: InvocationContext
  ): AsyncGenerator<Event, void, void> {
    // Yield an error event for live mode which is not supported via A2A
    yield createEvent({
      author: this.name,
      errorMessage: `runLiveImpl for ${this.constructor.name} via A2A is not implemented.`,
      invocationId: _ctx.invocationId,
      branch: _ctx.branch,
    });
  }

  /**
   * Clean up resources.
   */
  async cleanup(): Promise<void> {
    // Currently no persistent resources to clean up
    // In future, this could close HTTP connections if using connection pooling
    logger.debug(`Cleaned up resources for agent ${this.name}`);
  }
}
