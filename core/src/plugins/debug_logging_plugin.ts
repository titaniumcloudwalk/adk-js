/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, Part} from '@google/genai';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

import {BaseAgent} from '../agents/base_agent.js';
import {CallbackContext} from '../agents/callback_context.js';
import {InvocationContext} from '../agents/invocation_context.js';
import {Event, isFinalResponse} from '../events/event.js';
import {LlmRequest} from '../models/llm_request.js';
import {LlmResponse} from '../models/llm_response.js';
import {BaseTool} from '../tools/base_tool.js';
import {ToolContext} from '../tools/tool_context.js';
import {logger} from '../utils/logger.js';

import {BasePlugin} from './base_plugin.js';

/**
 * Represents a single debug log entry.
 */
export interface DebugEntry {
  /** ISO format timestamp of when the entry was created. */
  timestamp: string;

  /** The type of entry (e.g., 'user_message', 'llm_request'). */
  entryType: string;

  /** The invocation ID associated with this entry. */
  invocationId?: string;

  /** The name of the agent involved, if applicable. */
  agentName?: string;

  /** Flexible data dictionary containing the entry details. */
  data?: Record<string, unknown>;
}

/**
 * Represents the debug state for a single invocation.
 */
export interface InvocationDebugState {
  /** The unique invocation identifier. */
  invocationId: string;

  /** The session ID for this invocation. */
  sessionId: string;

  /** The application name. */
  appName: string;

  /** The user ID, if available. */
  userId?: string;

  /** ISO format timestamp of when the invocation started. */
  startTime: string;

  /** List of debug entries recorded during the invocation. */
  entries: DebugEntry[];
}

/**
 * Options for configuring the DebugLoggingPlugin.
 */
export interface DebugLoggingPluginOptions {
  /** The name of the plugin. Default: 'debug_logging_plugin'. */
  name?: string;

  /** Path to the output YAML file. Default: 'adk_debug.yaml'. */
  outputPath?: string;

  /** Whether to include session state snapshots. Default: true. */
  includeSessionState?: boolean;

  /** Whether to include full system instructions. Default: true. */
  includeSystemInstruction?: boolean;
}

/**
 * A plugin that logs comprehensive debug information to a YAML file.
 *
 * This plugin captures all critical events during agent execution, including:
 * - User messages and invocation context
 * - Agent execution flow (start/end)
 * - LLM requests and responses with full configuration
 * - Tool calls with arguments and results
 * - Events and final responses
 * - Errors during model and tool execution
 * - Session state snapshots (optional)
 *
 * The output is written to a YAML file with each invocation as a separate
 * document (separated by `---`). This format makes it easy to analyze
 * agent behavior for debugging and development purposes.
 *
 * @example
 * ```typescript
 * const debugPlugin = new DebugLoggingPlugin({
 *   outputPath: './debug/agent_debug.yaml',
 *   includeSessionState: true,
 * });
 *
 * const runner = new Runner({
 *   agents: [myAgent],
 *   plugins: [debugPlugin],
 * });
 * ```
 */
export class DebugLoggingPlugin extends BasePlugin {
  private readonly outputPath: string;
  private readonly includeSessionState: boolean;
  private readonly includeSystemInstruction: boolean;
  private readonly invocationStates: Map<string, InvocationDebugState> =
      new Map();

  /**
   * Creates a new DebugLoggingPlugin.
   *
   * @param options Configuration options for the plugin.
   */
  constructor(options: DebugLoggingPluginOptions = {}) {
    super(options.name ?? 'debug_logging_plugin');
    this.outputPath = options.outputPath ?? 'adk_debug.yaml';
    this.includeSessionState = options.includeSessionState ?? true;
    this.includeSystemInstruction = options.includeSystemInstruction ?? true;
  }

  /**
   * Callback executed when a user message is received.
   * Logs the user message content before invocation starts.
   */
  override async onUserMessageCallback({invocationContext, userMessage}: {
    invocationContext: InvocationContext;
    userMessage: Content;
  }): Promise<Content|undefined> {
    const invocationId = invocationContext.invocationId;
    this.addEntry(invocationId, 'user_message', undefined, {
      content: this.serializeContent(userMessage),
    });
    return undefined;
  }

  /**
   * Callback executed before the ADK runner runs.
   * Initializes the debug state for this invocation.
   */
  override async beforeRunCallback({invocationContext}: {
    invocationContext: InvocationContext;
  }): Promise<Content|undefined> {
    const invocationId = invocationContext.invocationId;
    const state: InvocationDebugState = {
      invocationId,
      sessionId: invocationContext.session.id,
      appName: invocationContext.appName,
      userId: invocationContext.userId,
      startTime: this.getTimestamp(),
      entries: [],
    };
    this.invocationStates.set(invocationId, state);

    this.addEntry(invocationId, 'invocation_start', undefined, {
      rootAgent: invocationContext.agent.name,
      branch: invocationContext.branch ?? null,
    });

    return undefined;
  }

  /**
   * Callback executed after an event is yielded from runner.
   * Logs event details including actions and metadata.
   */
  override async onEventCallback({invocationContext, event}: {
    invocationContext: InvocationContext;
    event: Event;
  }): Promise<Event|undefined> {
    const invocationId = invocationContext.invocationId;

    const eventData: Record<string, unknown> = {
      eventId: event.id,
      author: event.author,
      content: this.serializeContent(event.content),
      isFinalResponse: isFinalResponse(event),
      partial: event.partial,
      turnComplete: event.turnComplete,
      branch: event.branch ?? null,
    };

    // Add actions if present
    if (event.actions) {
      const actionsData: Record<string, unknown> = {};
      if (event.actions.stateDelta &&
          Object.keys(event.actions.stateDelta).length > 0) {
        actionsData['stateDelta'] = this.safeSerialize(event.actions.stateDelta);
      }
      if (event.actions.artifactDelta &&
          Object.keys(event.actions.artifactDelta).length > 0) {
        actionsData['artifactDelta'] = event.actions.artifactDelta;
      }
      if (event.actions.transferToAgent) {
        actionsData['transferToAgent'] = event.actions.transferToAgent;
      }
      if (event.actions.escalate) {
        actionsData['escalate'] = event.actions.escalate;
      }
      if (event.actions.requestedAuthConfigs &&
          Object.keys(event.actions.requestedAuthConfigs).length > 0) {
        actionsData['requestedAuthConfigs'] =
            Object.keys(event.actions.requestedAuthConfigs);
      }
      if (event.actions.requestedToolConfirmations &&
          Object.keys(event.actions.requestedToolConfirmations).length > 0) {
        actionsData['requestedToolConfirmations'] =
            Object.keys(event.actions.requestedToolConfirmations);
      }
      if (Object.keys(actionsData).length > 0) {
        eventData['actions'] = actionsData;
      }
    }

    // Add grounding metadata presence
    if (event.groundingMetadata) {
      eventData['hasGroundingMetadata'] = true;
    }

    // Add usage metadata
    if (event.usageMetadata) {
      eventData['usageMetadata'] = {
        promptTokenCount: event.usageMetadata.promptTokenCount,
        candidatesTokenCount: event.usageMetadata.candidatesTokenCount,
        totalTokenCount: event.usageMetadata.totalTokenCount,
      };
    }

    // Add error information
    if (event.errorCode) {
      eventData['errorCode'] = event.errorCode;
      eventData['errorMessage'] = event.errorMessage;
    }

    // Add long running tool IDs
    if (event.longRunningToolIds && event.longRunningToolIds.length > 0) {
      eventData['longRunningToolIds'] = [...event.longRunningToolIds];
    }

    this.addEntry(invocationId, 'event', event.author, eventData);
    return undefined;
  }

  /**
   * Callback executed after an ADK runner run has completed.
   * Writes the debug data to the YAML file and cleans up state.
   */
  override async afterRunCallback({invocationContext}: {
    invocationContext: InvocationContext;
  }): Promise<void> {
    const invocationId = invocationContext.invocationId;
    const state = this.invocationStates.get(invocationId);

    if (!state) {
      logger.warn(
          `[${this.name}] No debug state found for invocation ${invocationId}`);
      return;
    }

    // Add session state snapshot if enabled
    if (this.includeSessionState) {
      const session = invocationContext.session;
      this.addEntry(invocationId, 'session_state_snapshot', undefined, {
        state: this.safeSerialize(session.state.value),
        eventCount: session.events.length,
      });
    }

    // Add invocation end entry
    this.addEntry(invocationId, 'invocation_end', undefined, {
      finalAgent: invocationContext.agent.name,
    });

    // Write to YAML file
    try {
      const outputData = this.stateToJson(state);
      const yamlContent = yaml.dump(outputData, {
        noRefs: true,
        lineWidth: 120,
        quotingType: '"',
      });

      // Append with YAML document separator
      fs.appendFileSync(this.outputPath, '---\n' + yamlContent, 'utf-8');
      logger.debug(
          `[${this.name}] Debug data written to ${this.outputPath}`);
    } catch (error) {
      logger.error(
          `[${this.name}] Error writing debug data: ${error}`);
    }

    // Cleanup state
    this.invocationStates.delete(invocationId);
  }

  /**
   * Callback executed before an agent's primary logic is invoked.
   * Logs the agent start event.
   */
  override async beforeAgentCallback({agent, callbackContext}: {
    agent: BaseAgent;
    callbackContext: CallbackContext;
  }): Promise<Content|undefined> {
    const invocationId = callbackContext.invocationId;
    this.addEntry(invocationId, 'agent_start', callbackContext.agentName, {
      agentType: agent.constructor.name,
      branch: callbackContext.invocationContext.branch ?? null,
    });
    return undefined;
  }

  /**
   * Callback executed after an agent's primary logic has completed.
   * Logs the agent end event.
   */
  override async afterAgentCallback({agent, callbackContext}: {
    agent: BaseAgent;
    callbackContext: CallbackContext;
  }): Promise<Content|undefined> {
    const invocationId = callbackContext.invocationId;
    this.addEntry(invocationId, 'agent_end', callbackContext.agentName, {
      agentType: agent.constructor.name,
    });
    return undefined;
  }

  /**
   * Callback executed before a request is sent to the model.
   * Logs the LLM request with full configuration details.
   */
  override async beforeModelCallback({callbackContext, llmRequest}: {
    callbackContext: CallbackContext;
    llmRequest: LlmRequest;
  }): Promise<LlmResponse|undefined> {
    const invocationId = callbackContext.invocationId;

    const requestData: Record<string, unknown> = {
      model: llmRequest.model ?? 'default',
    };

    // Serialize contents
    if (llmRequest.contents) {
      requestData['contents'] =
          llmRequest.contents.map((c) => this.serializeContent(c));
    }

    // Handle system instruction based on setting
    if (llmRequest.config?.systemInstruction) {
      if (this.includeSystemInstruction) {
        requestData['systemInstruction'] = llmRequest.config.systemInstruction;
      } else {
        // Just indicate presence without full content
        const si = llmRequest.config.systemInstruction;
        if (typeof si === 'string') {
          requestData['systemInstructionLength'] = si.length;
        } else {
          requestData['hasSystemInstruction'] = true;
        }
      }
    }

    // Add tool names
    if (llmRequest.toolsDict && Object.keys(llmRequest.toolsDict).length > 0) {
      requestData['tools'] = Object.keys(llmRequest.toolsDict);
    }

    // Add relevant config options
    if (llmRequest.config) {
      const configData: Record<string, unknown> = {};
      if (llmRequest.config.temperature !== undefined) {
        configData['temperature'] = llmRequest.config.temperature;
      }
      if (llmRequest.config.topP !== undefined) {
        configData['topP'] = llmRequest.config.topP;
      }
      if (llmRequest.config.topK !== undefined) {
        configData['topK'] = llmRequest.config.topK;
      }
      if (llmRequest.config.maxOutputTokens !== undefined) {
        configData['maxOutputTokens'] = llmRequest.config.maxOutputTokens;
      }
      if (llmRequest.config.responseSchema) {
        configData['hasResponseSchema'] = true;
      }
      if (llmRequest.config.responseMimeType) {
        configData['responseMimeType'] = llmRequest.config.responseMimeType;
      }
      if (Object.keys(configData).length > 0) {
        requestData['config'] = configData;
      }
    }

    // Add cache information
    if (llmRequest.cacheConfig) {
      requestData['cacheConfig'] = this.safeSerialize(llmRequest.cacheConfig);
    }
    if (llmRequest.cacheMetadata) {
      requestData['cacheMetadata'] = {
        name: llmRequest.cacheMetadata.name,
        expireTime: llmRequest.cacheMetadata.expireTime?.toISOString(),
      };
    }

    this.addEntry(
        invocationId, 'llm_request', callbackContext.agentName, requestData);
    return undefined;
  }

  /**
   * Callback executed after a response is received from the model.
   * Logs the LLM response with usage metadata.
   */
  override async afterModelCallback({callbackContext, llmResponse}: {
    callbackContext: CallbackContext;
    llmResponse: LlmResponse;
  }): Promise<LlmResponse|undefined> {
    const invocationId = callbackContext.invocationId;

    const responseData: Record<string, unknown> = {
      content: this.serializeContent(llmResponse.content),
      partial: llmResponse.partial,
      turnComplete: llmResponse.turnComplete,
    };

    // Add usage metadata
    if (llmResponse.usageMetadata) {
      responseData['usageMetadata'] = {
        promptTokenCount: llmResponse.usageMetadata.promptTokenCount,
        candidatesTokenCount: llmResponse.usageMetadata.candidatesTokenCount,
        totalTokenCount: llmResponse.usageMetadata.totalTokenCount,
      };
    }

    // Add grounding metadata presence
    if (llmResponse.groundingMetadata) {
      responseData['hasGroundingMetadata'] = true;
    }

    // Add error information
    if (llmResponse.errorCode) {
      responseData['errorCode'] = llmResponse.errorCode;
      responseData['errorMessage'] = llmResponse.errorMessage;
    }

    this.addEntry(
        invocationId, 'llm_response', callbackContext.agentName, responseData);
    return undefined;
  }

  /**
   * Callback executed when a model call encounters an error.
   * Logs the LLM error details.
   */
  override async onModelErrorCallback({callbackContext, llmRequest, error}: {
    callbackContext: CallbackContext;
    llmRequest: LlmRequest;
    error: Error;
  }): Promise<LlmResponse|undefined> {
    const invocationId = callbackContext.invocationId;
    this.addEntry(invocationId, 'llm_error', callbackContext.agentName, {
      model: llmRequest.model ?? 'default',
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    });
    return undefined;
  }

  /**
   * Callback executed before a tool is called.
   * Logs the tool invocation with arguments.
   */
  override async beforeToolCallback({tool, toolArgs, toolContext}: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
  }): Promise<Record<string, unknown>|undefined> {
    const invocationId = toolContext.invocationContext.invocationId;
    this.addEntry(invocationId, 'tool_call', toolContext.agentName, {
      toolName: tool.name,
      functionCallId: toolContext.functionCallId,
      args: this.safeSerialize(toolArgs),
    });
    return undefined;
  }

  /**
   * Callback executed after a tool has been called.
   * Logs the tool result.
   */
  override async afterToolCallback({tool, toolArgs, toolContext, result}: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
    result: Record<string, unknown>;
  }): Promise<Record<string, unknown>|undefined> {
    const invocationId = toolContext.invocationContext.invocationId;
    this.addEntry(invocationId, 'tool_response', toolContext.agentName, {
      toolName: tool.name,
      functionCallId: toolContext.functionCallId,
      result: this.safeSerialize(result),
    });
    return undefined;
  }

  /**
   * Callback executed when a tool call encounters an error.
   * Logs the tool error details.
   */
  override async onToolErrorCallback({tool, toolArgs, toolContext, error}: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
    error: Error;
  }): Promise<Record<string, unknown>|undefined> {
    const invocationId = toolContext.invocationContext.invocationId;
    this.addEntry(invocationId, 'tool_error', toolContext.agentName, {
      toolName: tool.name,
      functionCallId: toolContext.functionCallId,
      args: this.safeSerialize(toolArgs),
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    });
    return undefined;
  }

  // -------------------------------------------------------------------------
  // Private helper methods
  // -------------------------------------------------------------------------

  /**
   * Gets the current timestamp in ISO format.
   */
  private getTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Adds an entry to the debug state for the given invocation.
   *
   * @param invocationId The invocation ID.
   * @param entryType The type of entry.
   * @param agentName The agent name, if applicable.
   * @param data The data to include in the entry.
   */
  private addEntry(
      invocationId: string,
      entryType: string,
      agentName?: string,
      data?: Record<string, unknown>,
  ): void {
    const state = this.invocationStates.get(invocationId);
    if (!state) {
      logger.warn(
          `[${this.name}] No debug state for invocation ${invocationId}, ` +
          `skipping entry: ${entryType}`);
      return;
    }

    const entry: DebugEntry = {
      timestamp: this.getTimestamp(),
      entryType,
      invocationId,
      agentName,
      data: data ? this.safeSerialize(data) as Record<string, unknown> :
                   undefined,
    };
    state.entries.push(entry);
  }

  /**
   * Serializes a Content object to a plain dictionary suitable for YAML output.
   *
   * @param content The Content to serialize.
   * @returns A serialized representation of the content.
   */
  private serializeContent(content?: Content): Record<string, unknown>|
      undefined {
    if (!content) return undefined;

    const parts: Record<string, unknown>[] = [];

    if (content.parts) {
      for (const part of content.parts) {
        const partData = this.serializePart(part);
        if (Object.keys(partData).length > 0) {
          parts.push(partData);
        }
      }
    }

    return {
      role: content.role,
      parts: parts.length > 0 ? parts : undefined,
    };
  }

  /**
   * Serializes a Part object to a plain dictionary.
   *
   * @param part The Part to serialize.
   * @returns A serialized representation of the part.
   */
  private serializePart(part: Part): Record<string, unknown> {
    const partData: Record<string, unknown> = {};

    if (part.text !== undefined) {
      partData['text'] = part.text;
    }

    if (part.functionCall) {
      partData['functionCall'] = {
        id: part.functionCall.id,
        name: part.functionCall.name,
        args: this.safeSerialize(part.functionCall.args),
      };
    }

    if (part.functionResponse) {
      partData['functionResponse'] = {
        id: part.functionResponse.id,
        name: part.functionResponse.name,
        response: this.safeSerialize(part.functionResponse.response),
      };
    }

    if (part.inlineData) {
      // Don't include actual binary data, just metadata
      partData['inlineData'] = {
        mimeType: part.inlineData.mimeType,
        dataLength: part.inlineData.data ?
            `<${typeof part.inlineData.data === 'string' ? part.inlineData.data.length : 'bytes'}>` :
            undefined,
      };
    }

    if (part.fileData) {
      partData['fileData'] = {
        fileUri: part.fileData.fileUri,
        mimeType: part.fileData.mimeType,
      };
    }

    if (part.codeExecutionResult) {
      partData['codeExecutionResult'] = {
        outcome: part.codeExecutionResult.outcome,
        output: part.codeExecutionResult.output,
      };
    }

    if (part.executableCode) {
      partData['executableCode'] = {
        language: part.executableCode.language,
        code: part.executableCode.code,
      };
    }

    if (part.thought !== undefined) {
      partData['thought'] = part.thought;
    }

    return partData;
  }

  /**
   * Safely serializes any object to a JSON-serializable format.
   *
   * Handles various types including primitives, arrays, objects, dates,
   * Buffers/Uint8Arrays, and nested structures. Unknown types are converted
   * to strings.
   *
   * @param obj The object to serialize.
   * @returns A JSON-serializable representation of the object.
   */
  private safeSerialize(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return null;
    }

    if (typeof obj === 'string' || typeof obj === 'number' ||
        typeof obj === 'boolean') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.safeSerialize(item));
    }

    if (obj instanceof Uint8Array || obj instanceof Buffer) {
      return `<bytes: ${obj.length} bytes>`;
    }

    if (obj instanceof Date) {
      return obj.toISOString();
    }

    if (typeof obj === 'object') {
      // Check for toJSON method (common serialization pattern)
      if (typeof (obj as Record<string, unknown>)['toJSON'] === 'function') {
        return this.safeSerialize(
            (obj as {toJSON: () => unknown}).toJSON());
      }

      // Handle plain objects and Maps
      if (obj instanceof Map) {
        const result: Record<string, unknown> = {};
        for (const [key, value] of obj.entries()) {
          result[String(key)] = this.safeSerialize(value);
        }
        return result;
      }

      // Plain object
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.safeSerialize(value);
      }
      return result;
    }

    // Fallback: convert to string
    try {
      return String(obj);
    } catch {
      return '<unserializable>';
    }
  }

  /**
   * Converts the invocation debug state to a JSON-serializable object.
   *
   * @param state The invocation debug state.
   * @returns A JSON-serializable object.
   */
  private stateToJson(state: InvocationDebugState): Record<string, unknown> {
    return {
      invocationId: state.invocationId,
      sessionId: state.sessionId,
      appName: state.appName,
      userId: state.userId ?? null,
      startTime: state.startTime,
      entries: state.entries.map((entry) => ({
                 timestamp: entry.timestamp,
                 entryType: entry.entryType,
                 invocationId: entry.invocationId,
                 agentName: entry.agentName ?? null,
                 data: entry.data ?? null,
               })),
    };
  }
}
