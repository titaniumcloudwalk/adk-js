/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration, Tool} from '@google/genai';

import {InvocationContext} from '../agents/invocation_context.js';
import {LlmRequest} from '../models/llm_request.js';
import {getGoogleLlmVariant} from '../utils/variant_utils.js';

import {ToolContext} from './tool_context.js';

/**
 * The parameters for `runAsync`.
 */
export interface RunAsyncToolRequest {
  args: Record<string, unknown>;
  toolContext: ToolContext;
}

/**
 * The parameters for `_callLive` (streaming tool execution).
 */
export interface CallLiveToolRequest {
  args: Record<string, unknown>;
  toolContext: ToolContext;
  invocationContext: InvocationContext;
}

/**
 * The parameters for `processLlmRequest`.
 */
export interface ToolProcessLlmRequest {
  toolContext: ToolContext;
  llmRequest: LlmRequest;
}

/**
 * Parameters for the BaseTool constructor.
 */
export interface BaseToolParams {
  name: string;
  description: string;
  isLongRunning?: boolean;
}

/**
 * The base class for all tools.
 */
export abstract class BaseTool {
  readonly name: string;
  readonly description: string;
  readonly isLongRunning: boolean;

  /**
   * Base constructor for a tool.
   *
   * @param params The parameters for `BaseTool`.
   */
  constructor(params: BaseToolParams) {
    this.name = params.name;
    this.description = params.description;
    this.isLongRunning = params.isLongRunning ?? false;
  }

  /**
   * Gets the OpenAPI specification of this tool in the form of a
   * FunctionDeclaration.
   *
   * NOTE
   * - Required if subclass uses the default implementation of
   *   `processLlmRequest` to add function declaration to LLM request.
   * - Otherwise, can be skipped, e.g. for a built-in GoogleSearch tool for
   *   Gemini.
   *
   * @return The FunctionDeclaration of this tool, or undefined if it doesn't
   *     need to be added to LlmRequest.config.
   */
  _getDeclaration(): FunctionDeclaration|undefined {
    return undefined;
  }

  /**
   * Runs the tool with the given arguments and context.
   *
   * NOTE
   * - Required if this tool needs to run at the client side.
   * - Otherwise, can be skipped, e.g. for a built-in GoogleSearch tool for
   *   Gemini.
   *
   * @param request The request to run the tool.
   * @return A promise that resolves to the tool response.
   */
  abstract runAsync(request: RunAsyncToolRequest): Promise<unknown>;

  /**
   * Executes the tool in live/streaming mode.
   *
   * This method is called for streaming tool execution in bidirectional
   * streaming scenarios. It yields results as they become available.
   *
   * NOTE
   * - Override this method to provide streaming tool execution.
   * - Default implementation throws an error indicating the tool doesn't
   *   support streaming.
   *
   * @param request The request to run the tool in live mode.
   * @yields Results as they become available during streaming.
   */
  async *_callLive(request: CallLiveToolRequest): AsyncGenerator<unknown> {
    throw new Error(
      `Tool '${this.name}' does not support streaming execution. ` +
      'Override _callLive() to enable streaming.',
    );
  }

  /**
   * Processes the outgoing LLM request for this tool.
   *
   * Use cases:
   * - Most common use case is adding this tool to the LLM request.
   * - Some tools may just preprocess the LLM request before it's sent out.
   *
   * @param request The request to process the LLM request.
   */
  async processLlmRequest({toolContext, llmRequest}: ToolProcessLlmRequest):
      Promise<void> {
    const functionDeclaration = this._getDeclaration();
    if (!functionDeclaration) {
      return;
    }

    llmRequest.toolsDict[this.name] = this;

    const tool = findToolWithFunctionDeclarations(llmRequest);
    if (tool) {
      if (!tool.functionDeclarations) {
        tool.functionDeclarations = [];
      }

      tool.functionDeclarations.push(functionDeclaration);
    } else {
      llmRequest.config = llmRequest.config || {};
      llmRequest.config.tools = llmRequest.config.tools || [];
      llmRequest.config.tools.push({
        functionDeclarations: [functionDeclaration],
      });
    }
  }

  /**
   * The Google API LLM variant to use.
   */
  get apiVariant() {
    return getGoogleLlmVariant();
  }
}

function findToolWithFunctionDeclarations(llmRequest: LlmRequest): Tool|
    undefined {
  return (llmRequest.config?.tools ||
          []).find(tool => 'functionDeclarations' in tool) as Tool |
      undefined;
}
