/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// TODO - b/436079721: implement traceMergedToolCalls, traceToolCall, tracer.
import {Content, createUserContent, FunctionCall, Part} from '@google/genai';
import {isEmpty} from 'lodash-es';

import {ActiveStreamingTool} from '../agents/active_streaming_tool.js';
import {InvocationContext} from '../agents/invocation_context.js';
import {createEvent, Event, getFunctionCalls} from '../events/event.js';
import {mergeEventActions} from '../events/event_actions.js';
import {BaseTool} from '../tools/base_tool.js';
import {FunctionTool} from '../tools/function_tool.js';
import {STOP_STREAMING_FUNCTION_NAME} from '../tools/stop_streaming_tool.js';
import {ToolConfirmation} from '../tools/tool_confirmation.js';
import {ToolContext} from '../tools/tool_context.js';
import {Aclosing} from '../utils/async_generator_utils.js';
import {randomUUID} from '../utils/env_aware_utils.js';
import {logger} from '../utils/logger.js';

import {SingleAfterToolCallback, SingleBeforeToolCallback, SingleOnToolErrorCallback} from './llm_agent.js';

const AF_FUNCTION_CALL_ID_PREFIX = 'adk-';
export const REQUEST_EUC_FUNCTION_CALL_NAME = 'adk_request_credential';
export const REQUEST_CONFIRMATION_FUNCTION_CALL_NAME =
    'adk_request_confirmation';

// Export these items for testing purposes only
export const functionsExportedForTestingOnly = {
  handleFunctionCallList,
  generateAuthEvent,
  generateRequestConfirmationEvent,
  handleFunctionCallsLive,
};

export function generateClientFunctionCallId(): string {
  return `${AF_FUNCTION_CALL_ID_PREFIX}${randomUUID()}`;
}

/**
 * Populates client-side function call IDs.
 *
 * It iterates through all function calls in the event and assigns a
 * unique client-side ID to each one that doesn't already have an ID.
 */
// TODO - b/425992518: consider move into event.ts
export function populateClientFunctionCallId(
    modelResponseEvent: Event,
    ): void {
  const functionCalls = getFunctionCalls(modelResponseEvent);
  if (!functionCalls) {
    return;
  }
  for (const functionCall of functionCalls) {
    if (!functionCall.id) {
      functionCall.id = generateClientFunctionCallId();
    }
  }
}
// TODO - b/425992518: consider internalize in content_[processor].ts
/**
 * Removes the client-generated function call IDs from a given content object.
 *
 * When sending content back to the server, these IDs are
 * specific to the client-side and should not be included in requests to the
 * model.
 */
export function removeClientFunctionCallId(content: Content): void {
  if (content && content.parts) {
    for (const part of content.parts) {
      if (part.functionCall && part.functionCall.id &&
          part.functionCall.id.startsWith(AF_FUNCTION_CALL_ID_PREFIX)) {
        part.functionCall.id = undefined;
      }
      if (part.functionResponse && part.functionResponse.id &&
          part.functionResponse.id.startsWith(AF_FUNCTION_CALL_ID_PREFIX)) {
        part.functionResponse.id = undefined;
      }
    }
  }
}
// TODO - b/425992518: consider internalize as part of llm_agent's runtime.
/**
 * Returns a set of function call ids of the long running tools.
 */
export function getLongRunningFunctionCalls(
    functionCalls: FunctionCall[],
    toolsDict: Record<string, BaseTool>,
    ): Set<string> {
  const longRunningToolIds = new Set<string>();
  for (const functionCall of functionCalls) {
    if (functionCall.name && functionCall.name in toolsDict &&
        toolsDict[functionCall.name].isLongRunning && functionCall.id) {
      longRunningToolIds.add(functionCall.id);
    }
  }
  return longRunningToolIds;
}

// TODO - b/425992518: consider internalize as part of llm_agent's runtime.
// The auth part of function calling is a bit hacky, need to to clarify.
/**
 * Generates an authentication event.
 *
 * It iterates through requested auth configurations in a function response
 * event and creates a new function call for each.
 */
export function generateAuthEvent(
    invocationContext: InvocationContext,
    functionResponseEvent: Event,
    ): Event|undefined {
  if (!functionResponseEvent.actions?.requestedAuthConfigs ||
      isEmpty(functionResponseEvent.actions.requestedAuthConfigs)) {
    return undefined;
  }
  const parts: Part[] = [];
  const longRunningToolIds = new Set<string>();
  for (const [functionCallId, authConfig] of Object.entries(
           functionResponseEvent.actions.requestedAuthConfigs,
           )) {
    const requestEucFunctionCall: FunctionCall = {
      name: REQUEST_EUC_FUNCTION_CALL_NAME,
      args: {
        'function_call_id': functionCallId,
        'auth_config': authConfig,
      },
      id: generateClientFunctionCallId(),
    };
    longRunningToolIds.add(requestEucFunctionCall.id!);
    parts.push({functionCall: requestEucFunctionCall});
  }

  return createEvent({
    invocationId: invocationContext.invocationId,
    author: invocationContext.agent.name,
    branch: invocationContext.branch,
    content: {
      parts: parts,
      role: functionResponseEvent.content!.role,
    },
    longRunningToolIds: Array.from(longRunningToolIds),
  });
}

/**
 * Generates a request confirmation event from a function response event.
 */
export function generateRequestConfirmationEvent({
  invocationContext,
  functionCallEvent,
  functionResponseEvent,
}: {
  invocationContext: InvocationContext,
  functionCallEvent: Event,
  functionResponseEvent: Event
}): Event|undefined {
  if (!functionResponseEvent.actions?.requestedToolConfirmations ||
      isEmpty(functionResponseEvent.actions.requestedToolConfirmations)) {
    return;
  }
  const parts: Part[] = [];
  const longRunningToolIds = new Set<string>();
  const functionCalls = getFunctionCalls(functionCallEvent);

  for (const [functionCallId, toolConfirmation] of Object.entries(
           functionResponseEvent.actions.requestedToolConfirmations,
           )) {
    const originalFunctionCall =
        functionCalls.find(call => call.id === functionCallId) ?? undefined;
    if (!originalFunctionCall) {
      continue;
    }
    const requestConfirmationFunctionCall: FunctionCall = {
      name: REQUEST_CONFIRMATION_FUNCTION_CALL_NAME,
      args: {
        'originalFunctionCall': originalFunctionCall,
        'toolConfirmation': toolConfirmation,
      },
      id: generateClientFunctionCallId(),
    };
    longRunningToolIds.add(requestConfirmationFunctionCall.id!);
    parts.push({functionCall: requestConfirmationFunctionCall});
  }
  return createEvent({
    invocationId: invocationContext.invocationId,
    author: invocationContext.agent.name,
    branch: invocationContext.branch,
    content: {
      parts: parts,
      role: functionResponseEvent.content!.role,
    },
    longRunningToolIds: Array.from(longRunningToolIds),
  });
}

async function callToolAsync(
    tool: BaseTool,
    args: Record<string, any>,
    toolContext: ToolContext,
    ): Promise<any> {
  // TODO - b/436079721: implement [tracer.start_as_current_span]
  logger.debug(`callToolAsync ${tool.name}`);
  return await tool.runAsync({args, toolContext});
}

/**
 * Handles function calls.
 * Runtime behavior to pay attention to:
 * - Iterate through each function call in the `functionCallEvent`:
 *   - Execute before tool callbacks !!if a callback provides a response, short
 *     circuit the rest.
 *   - Execute the tool.
 *   - Execute after tool callbacks !!if a callback provides a response, short
 *     circuit the rest.
 *   - If the tool is long-running and the response is null, continue. !!state
 * - Merge all function response events into a single event.
 */
export async function handleFunctionCallsAsync({
  invocationContext,
  functionCallEvent,
  toolsDict,
  beforeToolCallbacks,
  afterToolCallbacks,
  onToolErrorCallbacks,
  filters,
  toolConfirmationDict,
}: {
  invocationContext: InvocationContext,
  functionCallEvent: Event,
  toolsDict: Record<string, BaseTool>,
  beforeToolCallbacks: SingleBeforeToolCallback[],
  afterToolCallbacks: SingleAfterToolCallback[],
  onToolErrorCallbacks?: SingleOnToolErrorCallback[],
  filters?: Set<string>,
  toolConfirmationDict?: Record<string, ToolConfirmation>,
}): Promise<Event|null> {
  const functionCalls = getFunctionCalls(functionCallEvent);
  return await handleFunctionCallList({
    invocationContext: invocationContext,
    functionCalls: functionCalls,
    toolsDict: toolsDict,
    beforeToolCallbacks: beforeToolCallbacks,
    afterToolCallbacks: afterToolCallbacks,
    onToolErrorCallbacks: onToolErrorCallbacks,
    filters: filters,
    toolConfirmationDict: toolConfirmationDict,
  });
}

/**
 * The underlying implementation of handleFunctionCalls, but takes a list of
 * function calls instead of an event.
 * This is also used by llm_agent execution flow in preprocessing.
 */
/**
 * Executes a single function call asynchronously.
 *
 * This helper function is used by handleFunctionCallList to execute tools
 * in parallel. It handles the full lifecycle of tool execution including:
 * - Before/after tool callbacks from plugins
 * - Error handling and recovery
 * - Tool confirmation support
 * - Event creation
 *
 * @param invocationContext - The invocation context
 * @param functionCall - The function call to execute
 * @param toolsDict - Map of tool names to tool instances
 * @param beforeToolCallbacks - Callbacks to run before tool execution
 * @param afterToolCallbacks - Callbacks to run after tool execution
 * @param toolConfirmation - Optional tool confirmation data
 * @returns The function response event, or null if tool is long-running with no response
 */
async function executeSingleFunctionCallAsync({
  invocationContext,
  functionCall,
  toolsDict,
  beforeToolCallbacks,
  afterToolCallbacks,
  onToolErrorCallbacks,
  toolConfirmation,
}: {
  invocationContext: InvocationContext,
  functionCall: FunctionCall,
  toolsDict: Record<string, BaseTool>,
  beforeToolCallbacks: SingleBeforeToolCallback[],
  afterToolCallbacks: SingleAfterToolCallback[],
  onToolErrorCallbacks?: SingleOnToolErrorCallback[],
  toolConfirmation?: ToolConfirmation,
}): Promise<Event|null> {
  const {tool, toolContext} = getToolAndContext(
      {
        invocationContext,
        functionCall,
        toolsDict,
        toolConfirmation,
      },
  );

  // TODO - b/436079721: implement [tracer.start_as_current_span]
  logger.debug(`execute_tool ${tool.name}`);
  const functionArgs = functionCall.args ?? {};

  // Step 1: Check if plugin before_tool_callback overrides the function
  // response.
  let functionResponse = null;
  let functionResponseError: string|unknown|undefined;
  functionResponse =
      await invocationContext.pluginManager.runBeforeToolCallback({
        tool: tool,
        toolArgs: functionArgs,
        toolContext: toolContext,
      });

  // Step 2: If no overrides are provided from the plugins, further run the
  // canonical callback.
  // TODO - b/425992518: validate the callback response type matches.
  if (functionResponse == null) {  // Cover both null and undefined
    for (const callback of beforeToolCallbacks) {
      functionResponse = await callback({
        tool: tool,
        args: functionArgs,
        context: toolContext,
      });
      if (functionResponse) {
        break;
      }
    }
  }

  // Step 3: Otherwise, proceed calling the tool normally.
  if (functionResponse == null) {  // Cover both null and undefined
    try {
      functionResponse = await callToolAsync(
          tool,
          functionArgs,
          toolContext,
      );
    } catch (e: unknown) {
      if (e instanceof Error) {
        // Step 3a: Try plugins to recover from the error
        let onToolErrorResponse =
            await invocationContext.pluginManager.runOnToolErrorCallback(
                {
                  tool: tool,
                  toolArgs: functionArgs,
                  toolContext: toolContext,
                  error: e,
                },
            );

        // Step 3b: If no plugins returned a response, try agent-level callbacks
        if (onToolErrorResponse == null && onToolErrorCallbacks) {
          for (const callback of onToolErrorCallbacks) {
            onToolErrorResponse = await callback({
              tool: tool,
              args: functionArgs,
              context: toolContext,
              error: e,
            });
            if (onToolErrorResponse) {
              break;
            }
          }
        }

        // Set function response to the result of the error callback and
        // continue execution, do not shortcut
        if (onToolErrorResponse) {
          functionResponse = onToolErrorResponse;
        } else {
          // If the error callback returns undefined, use the error message
          // as the function response error.
          functionResponseError = e.message;
        }
      } else {
        // If the error is not an Error, use the error object as the function
        // response error.
        functionResponseError = e;
      }
    }
  }

  // Step 4: Check if plugin after_tool_callback overrides the function
  // response.
  let alteredFunctionResponse =
      await invocationContext.pluginManager.runAfterToolCallback({
        tool: tool,
        toolArgs: functionArgs,
        toolContext: toolContext,
        result: functionResponse,
      });

  // Step 5: If no overrides are provided from the plugins, further run the
  // canonical after_tool_callbacks.
  if (alteredFunctionResponse == null) {  // Cover both null and undefined
    for (const callback of afterToolCallbacks) {
      alteredFunctionResponse = await callback({
        tool: tool,
        args: functionArgs,
        context: toolContext,
        response: functionResponse,
      });
      if (alteredFunctionResponse) {
        break;
      }
    }
  }

  // Step 6: If alternative response exists from after_tool_callback, use it
  // instead of the original function response.
  if (alteredFunctionResponse != null) {
    functionResponse = alteredFunctionResponse;
  }

  // TODO - b/425992518: state event polluting runtime, consider fix.
  // Allow long running function to return None as response.
  if (tool.isLongRunning && !functionResponse) {
    return null;
  }

  if (functionResponseError) {
    functionResponse = {error: functionResponseError};
  } else if (
      typeof functionResponse !== 'object' || functionResponse == null) {
    functionResponse = {result: functionResponse};
  }

  // Builds the function response event.
  const functionResponseEvent = createEvent({
    invocationId: invocationContext.invocationId,
    author: invocationContext.agent.name,
    content: createUserContent({
      functionResponse: {
        id: toolContext.functionCallId,
        name: tool.name,
        response: functionResponse,
      },
    }),
    actions: toolContext.actions,
    branch: invocationContext.branch,
  });

  // TODO - b/436079721: implement [traceToolCall]
  logger.debug('traceToolCall', {
    tool: tool.name,
    args: functionArgs,
    functionResponseEvent: functionResponseEvent.id,
  });

  return functionResponseEvent;
}

/**
 * Handles a list of function calls by executing them in parallel.
 *
 * Tools are executed concurrently using Promise.all() for improved
 * performance. For example, 3 tools that each take 2 seconds will
 * complete in ~2 seconds total instead of 6 seconds sequentially.
 *
 * Individual tool errors are isolated and don't block other tools from
 * executing. All tool responses are merged into a single event.
 *
 * @param invocationContext - The invocation context
 * @param functionCalls - Array of function calls to execute
 * @param toolsDict - Map of tool names to tool instances
 * @param beforeToolCallbacks - Callbacks to run before tool execution
 * @param afterToolCallbacks - Callbacks to run after tool execution
 * @param filters - Optional set of function call IDs to execute
 * @param toolConfirmationDict - Optional confirmations for tools
 * @returns A single merged event containing all function responses
 */
export async function handleFunctionCallList({
  invocationContext,
  functionCalls,
  toolsDict,
  beforeToolCallbacks,
  afterToolCallbacks,
  onToolErrorCallbacks,
  filters,
  toolConfirmationDict,
}: {
  invocationContext: InvocationContext,
  functionCalls: FunctionCall[],
  toolsDict: Record<string, BaseTool>,
  beforeToolCallbacks: SingleBeforeToolCallback[],
  afterToolCallbacks: SingleAfterToolCallback[],
  onToolErrorCallbacks?: SingleOnToolErrorCallback[],
  filters?: Set<string>,
  toolConfirmationDict?: Record<string, ToolConfirmation>,
}): Promise<Event|null> {
  // Note: only function ids INCLUDED in the filters will be executed.
  const filteredFunctionCalls = functionCalls.filter(functionCall => {
    return !filters || (functionCall.id && filters.has(functionCall.id));
  });

  // Create promises for all tool executions to run in parallel
  const executionPromises = filteredFunctionCalls.map(async (functionCall) => {
    let toolConfirmation = undefined;
    if (toolConfirmationDict && functionCall.id) {
      toolConfirmation = toolConfirmationDict[functionCall.id];
    }

    return executeSingleFunctionCallAsync({
      invocationContext,
      functionCall,
      toolsDict,
      beforeToolCallbacks,
      afterToolCallbacks,
      onToolErrorCallbacks,
      toolConfirmation,
    });
  });

  // Execute all tools in parallel and wait for all to complete
  const functionResponseEvents = (await Promise.all(executionPromises))
      .filter((event): event is Event => event !== null);

  if (!functionResponseEvents.length) {
    return null;
  }
  const mergedEvent =
      mergeParallelFunctionResponseEvents(functionResponseEvents);

  if (functionResponseEvents.length > 1) {
    // TODO - b/436079721: implement [tracer.start_as_current_span]
    logger.debug('execute_tool (merged)');
    // TODO - b/436079721: implement [traceMergedToolCalls]
    logger.debug('traceMergedToolCalls', {
      responseEventId: mergedEvent.id,
      functionResponseEvent: mergedEvent.id,
    });
  }
  return mergedEvent;
}

// TODO - b/425992518: consider inline, which is much cleaner.
function getToolAndContext(
    {
      invocationContext,
      functionCall,
      toolsDict,
      toolConfirmation,
    }: {
      invocationContext: InvocationContext,
      functionCall: FunctionCall,
      toolsDict: Record<string, BaseTool>,
      toolConfirmation?: ToolConfirmation,
    },
    ): {tool: BaseTool; toolContext: ToolContext} {
  if (!functionCall.name || !(functionCall.name in toolsDict)) {
    throw new Error(
        `Function ${functionCall.name} is not found in the toolsDict.`,
    );
  }

  const toolContext = new ToolContext({
    invocationContext: invocationContext,
    functionCallId: functionCall.id || undefined,
    toolConfirmation,
  });

  const tool = toolsDict[functionCall.name];

  return {tool, toolContext};
}

/**
 * Merges a list of function response events into a single event.
 */
// TODO - b/425992518: may not need export. Can be conslidated into Event.
export function mergeParallelFunctionResponseEvents(
    functionResponseEvents: Event[],
    ): Event {
  if (!functionResponseEvents.length) {
    throw new Error('No function response events provided.');
  }

  if (functionResponseEvents.length === 1) {
    return functionResponseEvents[0];
  }
  const mergedParts: Part[] = [];
  for (const event of functionResponseEvents) {
    if (event.content && event.content.parts) {
      mergedParts.push(...event.content.parts);
    }
  }

  const baseEvent = functionResponseEvents[0];

  const actionsList = functionResponseEvents.map(event => event.actions || {});
  const mergedActions = mergeEventActions(actionsList);

  return createEvent({
    author: baseEvent.author,
    branch: baseEvent.branch,
    content: {role: 'user', parts: mergedParts},
    actions: mergedActions,
    timestamp: baseEvent.timestamp!,
  });
}

/**
 * Mutex-like lock for thread-safe access to streaming tools.
 * Uses a simple Promise-based pattern since JS is single-threaded but async.
 */
class StreamingLock {
  private locked = false;
  private waitQueue: (() => void)[] = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Handles function calls in live/streaming mode.
 *
 * This function is called during bidirectional streaming sessions to execute
 * tool function calls. It supports:
 * - Regular tool execution
 * - Streaming tool execution (async generator functions)
 * - stop_streaming built-in function for canceling streaming tools
 *
 * @param invocationContext - The invocation context
 * @param functionCallEvent - Event containing the function calls to execute
 * @param toolsDict - Map of tool names to tool instances
 * @param beforeToolCallbacks - Callbacks to run before tool execution
 * @param afterToolCallbacks - Callbacks to run after tool execution
 * @returns A single merged event containing all function responses
 */
export async function handleFunctionCallsLive({
  invocationContext,
  functionCallEvent,
  toolsDict,
  beforeToolCallbacks,
  afterToolCallbacks,
}: {
  invocationContext: InvocationContext,
  functionCallEvent: Event,
  toolsDict: Record<string, BaseTool>,
  beforeToolCallbacks: SingleBeforeToolCallback[],
  afterToolCallbacks: SingleAfterToolCallback[],
}): Promise<Event | null> {
  const functionCalls = getFunctionCalls(functionCallEvent);
  const streamingLock = new StreamingLock();
  const functionResponseEvents: Event[] = [];

  for (const functionCall of functionCalls) {
    const event = await executeSingleFunctionCallLive({
      invocationContext,
      functionCall,
      toolsDict,
      beforeToolCallbacks,
      afterToolCallbacks,
      streamingLock,
    });
    if (event) {
      functionResponseEvents.push(event);
    }
  }

  if (!functionResponseEvents.length) {
    return null;
  }

  return mergeParallelFunctionResponseEvents(functionResponseEvents);
}

/**
 * Executes a single function call in live/streaming mode.
 */
async function executeSingleFunctionCallLive({
  invocationContext,
  functionCall,
  toolsDict,
  beforeToolCallbacks,
  afterToolCallbacks,
  streamingLock,
}: {
  invocationContext: InvocationContext,
  functionCall: FunctionCall,
  toolsDict: Record<string, BaseTool>,
  beforeToolCallbacks: SingleBeforeToolCallback[],
  afterToolCallbacks: SingleAfterToolCallback[],
  streamingLock: StreamingLock,
}): Promise<Event | null> {
  const {tool, toolContext} = getToolAndContext({
    invocationContext,
    functionCall,
    toolsDict,
  });

  logger.debug(`execute_tool_live ${tool.name}`);
  const functionArgs = functionCall.args ?? {};

  // Run before_tool_callbacks
  let functionResponse: unknown = null;
  for (const callback of beforeToolCallbacks) {
    functionResponse = await callback({
      tool,
      args: functionArgs,
      context: toolContext,
    });
    if (functionResponse) {
      break;
    }
  }

  // If no callback provided response, execute tool
  if (functionResponse == null) {
    functionResponse = await processFunctionLiveHelper({
      tool,
      toolContext,
      functionCall,
      functionArgs,
      invocationContext,
      streamingLock,
    });
  }

  // Run after_tool_callbacks
  let alteredResponse: unknown = null;

  // Normalize response to object before callbacks
  if (typeof functionResponse !== 'object' || functionResponse == null) {
    functionResponse = {result: functionResponse};
  }

  for (const callback of afterToolCallbacks) {
    alteredResponse = await callback({
      tool,
      args: functionArgs,
      context: toolContext,
      response: functionResponse as Record<string, unknown>,
    });
    if (alteredResponse) {
      break;
    }
  }
  if (alteredResponse != null) {
    functionResponse = alteredResponse;
  }

  // Handle long-running tools with no response
  if (tool.isLongRunning && !functionResponse) {
    return null;
  }

  // Ensure response is object
  if (typeof functionResponse !== 'object' || functionResponse == null) {
    functionResponse = {result: functionResponse};
  }

  // Build the function response event
  return createEvent({
    invocationId: invocationContext.invocationId,
    author: invocationContext.agent.name,
    content: createUserContent({
      functionResponse: {
        id: toolContext.functionCallId,
        name: tool.name,
        response: functionResponse as Record<string, unknown>,
      },
    }),
    actions: toolContext.actions,
    branch: invocationContext.branch,
  });
}

/**
 * Helper function that handles the core logic for live function execution.
 *
 * This handles three cases:
 * 1. stop_streaming - Cancels an active streaming function
 * 2. Streaming function - Starts async generator and registers in activeStreamingTools
 * 3. Regular function - Executes normally via runAsync
 */
async function processFunctionLiveHelper({
  tool,
  toolContext,
  functionCall,
  functionArgs,
  invocationContext,
  streamingLock,
}: {
  tool: BaseTool,
  toolContext: ToolContext,
  functionCall: FunctionCall,
  functionArgs: Record<string, unknown>,
  invocationContext: InvocationContext,
  streamingLock: StreamingLock,
}): Promise<unknown> {
  // Case 1: Handle stop_streaming function call
  if (
    functionCall.name === STOP_STREAMING_FUNCTION_NAME &&
    'function_name' in functionArgs
  ) {
    return await handleStopStreaming({
      functionArgs,
      invocationContext,
      streamingLock,
    });
  }

  // Case 2: Handle streaming tool (async generator function)
  if (tool instanceof FunctionTool && tool.isStreamingFunction) {
    return await startStreamingTool({
      tool,
      toolContext,
      functionArgs,
      invocationContext,
      streamingLock,
    });
  }

  // Case 3: Regular tool execution
  return await tool.runAsync({args: functionArgs, toolContext});
}

/**
 * Handles the stop_streaming function call to cancel an active streaming tool.
 */
async function handleStopStreaming({
  functionArgs,
  invocationContext,
  streamingLock,
}: {
  functionArgs: Record<string, unknown>,
  invocationContext: InvocationContext,
  streamingLock: StreamingLock,
}): Promise<{status: string}> {
  const functionName = functionArgs['function_name'] as string;

  // Thread-safe access to active_streaming_tools
  await streamingLock.acquire();
  let task: Promise<void> | undefined;
  let abortController: AbortController | undefined;

  try {
    const activeTools = invocationContext.activeStreamingTools;
    if (
      activeTools &&
      functionName in activeTools &&
      activeTools[functionName].task
    ) {
      task = activeTools[functionName].task;
      // Store reference to abort controller if we add one
      abortController = (activeTools[functionName] as unknown as {abortController?: AbortController}).abortController;
    }
  } finally {
    streamingLock.release();
  }

  if (task) {
    // Request cancellation via abort controller if available
    if (abortController) {
      abortController.abort();
    }

    try {
      // Wait for task to complete with timeout
      await Promise.race([
        task,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 1000)
        ),
      ]);
    } catch {
      // Task was cancelled or timed out
      logger.info(`Task ${functionName} was cancelled or timed out`);
    }

    // Clean up the reference
    await streamingLock.acquire();
    try {
      const activeTools = invocationContext.activeStreamingTools;
      if (activeTools && functionName in activeTools) {
        activeTools[functionName].task = undefined;
      }
    } finally {
      streamingLock.release();
    }

    return {status: `Successfully stopped streaming function ${functionName}`};
  }

  return {status: `No active streaming function named ${functionName} found`};
}

/**
 * Starts a streaming tool execution as an async task.
 *
 * Creates a task that:
 * 1. Runs the async generator tool
 * 2. Sends results to the live request queue
 * 3. Registers the task in activeStreamingTools for cancellation support
 */
async function startStreamingTool({
  tool,
  toolContext,
  functionArgs,
  invocationContext,
  streamingLock,
}: {
  tool: FunctionTool,
  toolContext: ToolContext,
  functionArgs: Record<string, unknown>,
  invocationContext: InvocationContext,
  streamingLock: StreamingLock,
}): Promise<{status: string}> {
  // Define the async task that runs the streaming tool
  const runToolAndUpdateQueue = async (signal?: AbortSignal) => {
    try {
      const aclosing = new Aclosing(
        tool._callLive({
          args: functionArgs,
          toolContext,
          invocationContext,
        }),
      );

      for await (const result of aclosing) {
        // Check for cancellation
        if (signal?.aborted) {
          break;
        }

        // Send result to live request queue
        if (invocationContext.liveRequestQueue) {
          const content: Content = {
            role: 'user',
            parts: [
              {text: `Function ${tool.name} returned: ${result}`},
            ],
          };
          invocationContext.liveRequestQueue.sendContent(content);
        }
      }
    } catch (error) {
      // Handle cancellation or other errors
      if (signal?.aborted) {
        logger.debug(`Streaming tool ${tool.name} was cancelled`);
      } else {
        logger.error(`Error in streaming tool ${tool.name}:`, error);
      }
    }
  };

  // Create abort controller for cancellation support
  const abortController = new AbortController();

  // Create and start the task
  const task = runToolAndUpdateQueue(abortController.signal);

  // Register the streaming tool
  await streamingLock.acquire();
  try {
    if (!invocationContext.activeStreamingTools) {
      invocationContext.activeStreamingTools = {};
    }

    if (tool.name in invocationContext.activeStreamingTools) {
      invocationContext.activeStreamingTools[tool.name].task = task;
      // Store abort controller for cancellation
      (invocationContext.activeStreamingTools[tool.name] as unknown as {abortController?: AbortController}).abortController = abortController;
    } else {
      const streamingTool = new ActiveStreamingTool({task});
      (streamingTool as unknown as {abortController?: AbortController}).abortController = abortController;
      invocationContext.activeStreamingTools[tool.name] = streamingTool;
    }
  } finally {
    streamingLock.release();
  }

  // Return pending status immediately
  return {
    status:
      'The function is running asynchronously and the results are pending.',
  };
}