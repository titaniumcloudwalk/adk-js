/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {BaseTool} from '../tools/base_tool.js';
import {ToolContext} from '../tools/tool_context.js';
import {logger} from '../utils/logger.js';

import {BasePlugin} from './base_plugin.js';

/**
 * Response type constant used to identify reflection responses from this
 * plugin. This prevents infinite retry loops by detecting when a result is
 * already a reflection response.
 */
export const REFLECT_AND_RETRY_RESPONSE_TYPE =
    'ERROR_HANDLED_BY_REFLECT_AND_RETRY_PLUGIN';

/**
 * Constant key used for global scope tracking across all invocations.
 */
export const GLOBAL_SCOPE_KEY = '__global_reflect_and_retry_scope__';

/**
 * Defines the lifecycle scope for tracking tool failure counts.
 */
export enum TrackingScope {
  /**
   * Track failures per invocation. Failure count resets between different
   * invocations. This is the default and most common usage.
   */
  INVOCATION = 'invocation',
  /**
   * Track failures globally across all invocations and users.
   * Useful for tracking persistent tool reliability issues.
   */
  GLOBAL = 'global',
}

/**
 * Response containing tool failure details and retry guidance.
 */
export interface ToolFailureResponse {
  /**
   * Type identifier for the response, used to detect reflection responses
   * and prevent infinite retry loops.
   */
  responseType: string;
  /**
   * The type/class name of the error (e.g., "TypeError", "Error").
   */
  errorType: string;
  /**
   * Detailed error message.
   */
  errorDetails: string;
  /**
   * Current retry attempt number.
   */
  retryCount: number;
  /**
   * Markdown-formatted guidance message for the LLM.
   */
  reflectionGuidance: string;
}

/**
 * A mapping from a tool's name to its consecutive failure count.
 */
type PerToolFailuresCounter = Map<string, number>;

/**
 * Configuration options for ReflectAndRetryToolPlugin.
 */
export interface ReflectAndRetryToolPluginOptions {
  /**
   * Plugin instance identifier.
   * @default 'reflect_retry_tool_plugin'
   */
  name?: string;
  /**
   * Maximum consecutive failures before giving up (0 = no retries).
   * @default 3
   */
  maxRetries?: number;
  /**
   * If true, raises the final exception when the retry limit is reached.
   * If false, returns guidance instead.
   * @default true
   */
  throwExceptionIfRetryExceeded?: boolean;
  /**
   * Determines the lifecycle of the error tracking state.
   * @default TrackingScope.INVOCATION
   */
  trackingScope?: TrackingScope;
}

/**
 * Provides self-healing, concurrent-safe error recovery for tool failures.
 *
 * This plugin intercepts tool failures, provides structured guidance to the LLM
 * for reflection and correction, and retries the operation up to a configurable
 * limit.
 *
 * **Key Features:**
 *
 * - **Concurrency Safe:** Uses locking to safely handle parallel tool
 *   executions
 * - **Configurable Scope:** Tracks failures per-invocation (default) or
 *   globally using the `TrackingScope` enum.
 * - **Extensible Scoping:** The `_getScopeKey` method can be overridden to
 *   implement custom tracking logic (e.g., per-user or per-session).
 * - **Granular Tracking:** Failure counts are tracked per-tool within the
 *   defined scope. A success with one tool resets its counter without affecting
 *   others.
 * - **Custom Error Extraction:** Supports detecting errors in normal tool
 *   responses that don't throw exceptions, by overriding the
 *   `extractErrorFromResult` method.
 *
 * @example
 * ```typescript
 * // Example 1 (MOST COMMON USAGE):
 * // Track failures only within the current agent invocation (default).
 * const errorHandlingPlugin = new ReflectAndRetryToolPlugin({ maxRetries: 3 });
 *
 * // Example 2:
 * // Track failures globally across all turns and users.
 * const globalErrorHandlingPlugin = new ReflectAndRetryToolPlugin({
 *   maxRetries: 5,
 *   trackingScope: TrackingScope.GLOBAL,
 * });
 *
 * // Example 3:
 * // Retry on failures but do not throw exceptions.
 * const softErrorHandlingPlugin = new ReflectAndRetryToolPlugin({
 *   maxRetries: 3,
 *   throwExceptionIfRetryExceeded: false,
 * });
 *
 * // Example 4:
 * // Track failures in successful tool responses that contain errors.
 * class CustomRetryPlugin extends ReflectAndRetryToolPlugin {
 *   override async extractErrorFromResult({
 *     tool,
 *     toolArgs,
 *     toolContext,
 *     result,
 *   }: {
 *     tool: BaseTool;
 *     toolArgs: Record<string, unknown>;
 *     toolContext: ToolContext;
 *     result: unknown;
 *   }): Promise<unknown | undefined> {
 *     // Detect error based on response content
 *     if (result && typeof result === 'object' && 'status' in result) {
 *       if ((result as { status: string }).status === 'error') {
 *         return result;
 *       }
 *     }
 *     return undefined; // No error detected
 *   }
 * }
 * ```
 */
export class ReflectAndRetryToolPlugin extends BasePlugin {
  readonly maxRetries: number;
  readonly throwExceptionIfRetryExceeded: boolean;
  readonly trackingScope: TrackingScope;

  /**
   * Scoped failure counters mapping scope keys to per-tool failure counts.
   * Structure: { "invocation_id_1": { "tool_a": 2, "tool_b": 1 }, ... }
   */
  private _scopedFailureCounters: Map<string, PerToolFailuresCounter> =
      new Map();

  /**
   * Lock for thread-safe concurrent tool execution.
   * In JavaScript/TypeScript, we use a promise-based mutex pattern.
   */
  private _lockQueue: Promise<void> = Promise.resolve();

  /**
   * Creates a new ReflectAndRetryToolPlugin instance.
   *
   * @param options Configuration options for the plugin.
   * @throws Error if maxRetries is negative.
   */
  constructor(options: ReflectAndRetryToolPluginOptions = {}) {
    super(options.name ?? 'reflect_retry_tool_plugin');

    const maxRetries = options.maxRetries ?? 3;
    if (maxRetries < 0) {
      throw new Error('maxRetries must be a non-negative integer.');
    }

    this.maxRetries = maxRetries;
    this.throwExceptionIfRetryExceeded =
        options.throwExceptionIfRetryExceeded ?? true;
    this.trackingScope = options.trackingScope ?? TrackingScope.INVOCATION;
  }

  /**
   * Executes a function with mutual exclusion.
   * Uses a promise queue pattern to ensure thread-safe access.
   */
  private async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
    // Chain this operation to the previous one
    const previousPromise = this._lockQueue;

    // Create a new promise that will be resolved when this operation completes
    let releaseLock: () => void;
    this._lockQueue = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    try {
      // Wait for the previous operation to complete
      await previousPromise;
      // Execute the function
      return await fn();
    } finally {
      // Release the lock for the next operation
      releaseLock!();
    }
  }

  /**
   * Handles successful tool calls or extracts and processes errors.
   *
   * @param tool The tool that was called.
   * @param toolArgs The arguments passed to the tool.
   * @param toolContext The context of the tool call.
   * @param result The result of the tool call.
   * @returns An optional dictionary containing reflection guidance if an error
   *     is detected, or undefined if the tool call was successful or the
   *     response is already a reflection message.
   */
  override async afterToolCallback({
    tool,
    toolArgs,
    toolContext,
    result,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
    result: Record<string, unknown>;
  }): Promise<Record<string, unknown>|undefined> {
    // Check if result is already a retry response to prevent infinite loops
    if (result && typeof result === 'object' &&
        (result as {responseType?: string}).responseType ===
            REFLECT_AND_RETRY_RESPONSE_TYPE) {
      return undefined;
    }

    // Check for errors in successful responses
    const error =
        await this.extractErrorFromResult({tool, toolArgs, toolContext, result});

    if (error !== undefined) {
      return await this._handleToolError(tool, toolArgs, toolContext, error);
    }

    // On success, reset the failure count for this specific tool within
    // its scope.
    await this._resetFailuresForTool(toolContext, tool.name);
    return undefined;
  }

  /**
   * Extracts an error from a successful tool result and triggers retry logic.
   *
   * This is useful when tool call finishes successfully but the result contains
   * an error object like {"error": ...} that should be handled by the plugin.
   *
   * By overriding this method, you can trigger retry logic on these successful
   * results that contain errors.
   *
   * @param tool The tool that was called.
   * @param toolArgs The arguments passed to the tool.
   * @param toolContext The context of the tool call.
   * @param result The result of the tool call.
   * @returns The extracted error if any, or undefined if no error was detected.
   */
  async extractErrorFromResult({tool, toolArgs, toolContext, result}: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
    result: unknown;
  }): Promise<unknown|undefined> {
    return undefined;
  }

  /**
   * Handles tool exceptions by providing reflection guidance.
   *
   * @param tool The tool that was called.
   * @param toolArgs The arguments passed to the tool.
   * @param toolContext The context of the tool call.
   * @param error The exception raised by the tool.
   * @returns An optional dictionary containing reflection guidance for the
   *     error.
   */
  override async onToolErrorCallback({
    tool,
    toolArgs,
    toolContext,
    error,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
    error: Error;
  }): Promise<Record<string, unknown>|undefined> {
    return await this._handleToolError(tool, toolArgs, toolContext, error);
  }

  /**
   * Central, thread-safe logic for processing tool errors.
   *
   * @param tool The tool that was called.
   * @param toolArgs The arguments passed to the tool.
   * @param toolContext The context of the tool call.
   * @param error The error to be handled.
   * @returns An optional dictionary containing reflection guidance for the
   *     error.
   */
  protected async _handleToolError(
      tool: BaseTool,
      toolArgs: Record<string, unknown>,
      toolContext: ToolContext,
      error: unknown,
      ): Promise<Record<string, unknown>|undefined> {
    if (this.maxRetries === 0) {
      if (this.throwExceptionIfRetryExceeded) {
        throw this._ensureException(error);
      }
      return this._getToolRetryExceedMsg(tool, toolArgs, error);
    }

    const scopeKey = this._getScopeKey(toolContext);

    return await this.withLock(() => {
      let toolFailureCounter = this._scopedFailureCounters.get(scopeKey);
      if (!toolFailureCounter) {
        toolFailureCounter = new Map();
        this._scopedFailureCounters.set(scopeKey, toolFailureCounter);
      }

      const currentRetries = (toolFailureCounter.get(tool.name) ?? 0) + 1;
      toolFailureCounter.set(tool.name, currentRetries);

      if (currentRetries <= this.maxRetries) {
        return this._createToolReflectionResponse(
            tool, toolArgs, error, currentRetries);
      }

      // Max retry exceeded
      if (this.throwExceptionIfRetryExceeded) {
        throw this._ensureException(error);
      } else {
        return this._getToolRetryExceedMsg(tool, toolArgs, error);
      }
    });
  }

  /**
   * Returns a unique key for the state dictionary based on the scope.
   *
   * This method can be overridden in a subclass to implement custom scoping
   * logic, for example, tracking failures on a per-user or per-session basis.
   *
   * @param toolContext The tool context containing invocation information.
   * @returns A string key for scoping the failure counter.
   */
  protected _getScopeKey(toolContext: ToolContext): string {
    if (this.trackingScope === TrackingScope.INVOCATION) {
      return toolContext.invocationId;
    } else if (this.trackingScope === TrackingScope.GLOBAL) {
      return GLOBAL_SCOPE_KEY;
    }
    throw new Error(`Unknown scope: ${this.trackingScope}`);
  }

  /**
   * Atomically resets the failure count for a tool and cleans up state.
   *
   * @param toolContext The tool context.
   * @param toolName The name of the tool to reset.
   */
  protected async _resetFailuresForTool(
      toolContext: ToolContext, toolName: string): Promise<void> {
    const scope = this._getScopeKey(toolContext);

    await this.withLock(() => {
      const state = this._scopedFailureCounters.get(scope);
      if (state) {
        state.delete(toolName);
      }
    });
  }

  /**
   * Ensures the given error is an Error instance, wrapping if not.
   *
   * @param error The error value.
   * @returns An Error instance.
   */
  private _ensureException(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  /**
   * Formats error details for inclusion in the reflection message.
   *
   * @param error The error value.
   * @returns A formatted error string.
   */
  private _formatErrorDetails(error: unknown): string {
    if (error instanceof Error) {
      return `${error.constructor.name}: ${error.message}`;
    }
    return String(error);
  }

  /**
   * Generates structured reflection guidance for tool failures.
   *
   * @param tool The tool that failed.
   * @param toolArgs The arguments passed to the tool.
   * @param error The error that occurred.
   * @param retryCount The current retry attempt number.
   * @returns A ToolFailureResponse object as a plain object.
   */
  protected _createToolReflectionResponse(
      tool: BaseTool,
      toolArgs: Record<string, unknown>,
      error: unknown,
      retryCount: number,
      ): Record<string, unknown> {
    let argsSummary: string;
    try {
      argsSummary = JSON.stringify(toolArgs, null, 2);
    } catch {
      argsSummary = String(toolArgs);
    }

    const errorDetails = this._formatErrorDetails(error);

    const reflectionMessage = `
The call to tool \`${tool.name}\` failed.

**Error Details:**
\`\`\`
${errorDetails}
\`\`\`

**Tool Arguments Used:**
\`\`\`json
${argsSummary}
\`\`\`

**Reflection Guidance:**
This is retry attempt **${retryCount} of ${this.maxRetries}**. Analyze the error and the arguments you provided. Do not repeat the exact same call. Consider the following before your next attempt:

1.  **Invalid Parameters**: Does the error suggest that one or more arguments are incorrect, badly formatted, or missing? Review the tool's schema and your arguments.
2.  **State or Preconditions**: Did a previous step fail or not produce the necessary state/resource for this tool to succeed?
3.  **Alternative Approach**: Is this the right tool for the job? Could another tool or a different sequence of steps achieve the goal?
4.  **Simplify the Task**: Can you break the problem down into smaller, simpler steps?
5.  **Wrong Function Name**: Does the error indicates the tool is not found? Please check again and only use available tools.

Formulate a new plan based on your analysis and try a corrected or different approach.
`.trim();

    const response: ToolFailureResponse = {
      responseType: REFLECT_AND_RETRY_RESPONSE_TYPE,
      errorType: error instanceof Error ? error.constructor.name : 'ToolError',
      errorDetails: String(error),
      retryCount,
      reflectionGuidance: reflectionMessage,
    };

    return response as unknown as Record<string, unknown>;
  }

  /**
   * Generates guidance when the maximum retry limit is exceeded.
   *
   * @param tool The tool that failed.
   * @param toolArgs The arguments passed to the tool.
   * @param error The final error.
   * @returns A ToolFailureResponse object as a plain object.
   */
  protected _getToolRetryExceedMsg(
      tool: BaseTool,
      toolArgs: Record<string, unknown>,
      error: unknown,
      ): Record<string, unknown> {
    const errorDetails = this._formatErrorDetails(error);

    let argsSummary: string;
    try {
      argsSummary = JSON.stringify(toolArgs, null, 2);
    } catch {
      argsSummary = String(toolArgs);
    }

    const reflectionMessage = `
The tool \`${tool.name}\` has failed consecutively ${this.maxRetries} times and the retry limit has been exceeded.

**Last Error:**
\`\`\`
${errorDetails}
\`\`\`

**Last Arguments Used:**
\`\`\`json
${argsSummary}
\`\`\`

**Final Instruction:**
**Do not attempt to use the \`${tool.name}\` tool again for this task.** You must now try a different approach. Acknowledge the failure and devise a new strategy, potentially using other available tools or informing the user that the task cannot be completed.
`.trim();

    const response: ToolFailureResponse = {
      responseType: REFLECT_AND_RETRY_RESPONSE_TYPE,
      errorType: error instanceof Error ? error.constructor.name : 'ToolError',
      errorDetails: String(error),
      retryCount: this.maxRetries,
      reflectionGuidance: reflectionMessage,
    };

    return response as unknown as Record<string, unknown>;
  }
}
