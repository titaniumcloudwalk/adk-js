/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration, Type} from '@google/genai';

import {LlmRequest, appendInstructions} from '../models/llm_request.js';
import {MemoryEntry} from '../memory/memory_entry.js';

import {BaseTool, RunAsyncToolRequest, ToolProcessLlmRequest} from './base_tool.js';
import {FunctionTool} from './function_tool.js';
import {ToolContext} from './tool_context.js';

/**
 * Response from load_memory function containing retrieved memories.
 */
export interface LoadMemoryResponse {
  memories: MemoryEntry[];
}

/**
 * Loads the memory for the current user.
 *
 * @param query The query to load the memory for.
 * @param toolContext The tool context containing memory service access.
 * @returns A promise that resolves to LoadMemoryResponse with matching memories.
 */
async function loadMemory(
    query: string,
    toolContext: ToolContext,
): Promise<LoadMemoryResponse> {
  const searchMemoryResponse = await toolContext.searchMemory(query);
  return {memories: searchMemoryResponse.memories};
}

/**
 * A tool that loads the memory for the current user.
 *
 * This tool can be called by the model when memory lookup is needed.
 * It appends instructions to the LLM request informing the model about
 * the availability of memory search capability.
 *
 * NOTE: Currently this tool only uses text parts from the memory.
 *
 * @example
 * ```typescript
 * import { loadMemoryTool } from '@google/adk';
 *
 * const agent = new LlmAgent({
 *   name: 'memory_agent',
 *   model: gemini,
 *   tools: [loadMemoryTool],
 * });
 * ```
 */
export class LoadMemoryTool extends BaseTool {
  constructor() {
    super({
      name: 'load_memory',
      description: 'Loads the memory for the current user.',
    });
  }

  /**
   * Provides a schema for the function.
   */
  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
          },
        },
        required: ['query'],
      },
    };
  }

  /**
   * Runs the tool with the given arguments and context.
   */
  override async runAsync(request: RunAsyncToolRequest): Promise<LoadMemoryResponse> {
    const query = request.args.query as string;
    return loadMemory(query, request.toolContext);
  }

  /**
   * Processes the outgoing LLM request for this tool.
   * Adds the tool to the request and appends memory usage instructions.
   */
  override async processLlmRequest({
    toolContext,
    llmRequest,
  }: ToolProcessLlmRequest): Promise<void> {
    await super.processLlmRequest({toolContext, llmRequest});

    // Tell the model about the memory.
    appendInstructions(llmRequest, [
      `You have memory. You can use it to answer questions. If any questions need
you to look up the memory, you should call load_memory function with a query.`,
    ]);
  }
}

/**
 * Singleton instance of LoadMemoryTool for convenient usage.
 *
 * @example
 * ```typescript
 * import { loadMemoryTool } from '@google/adk';
 *
 * const agent = new LlmAgent({
 *   name: 'my_agent',
 *   model: gemini,
 *   tools: [loadMemoryTool],
 * });
 * ```
 */
export const loadMemoryTool = new LoadMemoryTool();
