/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {LlmRequest, appendInstructions} from '../models/llm_request.js';
import {logger} from '../utils/logger.js';

import {BaseTool, RunAsyncToolRequest, ToolProcessLlmRequest} from './base_tool.js';
import {extractText} from './memory_entry_utils.js';
import {ToolContext} from './tool_context.js';

/**
 * A tool that preloads the memory for the current user.
 *
 * This tool will be automatically executed for each llm_request, and it won't be
 * called by the model directly. Instead, it modifies the LLM request by searching
 * for relevant memories based on the user's query and injecting them into the
 * system instructions.
 *
 * NOTE: Currently this tool only uses text parts from the memory.
 *
 * @example
 * ```typescript
 * import { preloadMemoryTool } from '@google/adk';
 *
 * const agent = new LlmAgent({
 *   name: 'memory_agent',
 *   model: gemini,
 *   tools: [preloadMemoryTool],
 * });
 * ```
 */
export class PreloadMemoryTool extends BaseTool {
  constructor() {
    // Name and description are not used because this tool only
    // changes llm_request.
    super({
      name: 'preload_memory',
      description: 'preload_memory',
    });
  }

  /**
   * This tool does not provide a function declaration since it's not
   * meant to be called by the model.
   */
  override _getDeclaration() {
    return undefined;
  }

  /**
   * This tool does not run directly - it only modifies the LLM request.
   * Throws an error if called directly.
   */
  override async runAsync(request: RunAsyncToolRequest): Promise<unknown> {
    throw new Error('PreloadMemoryTool should not be called directly.');
  }

  /**
   * Processes the outgoing LLM request for this tool.
   * Automatically searches memory based on the user's query and injects
   * relevant context into the system instructions.
   */
  override async processLlmRequest({
    toolContext,
    llmRequest,
  }: ToolProcessLlmRequest): Promise<void> {
    const userContent = toolContext.userContent;
    if (
      !userContent ||
      !userContent.parts ||
      !userContent.parts[0]?.text
    ) {
      return;
    }

    const userQuery: string = userContent.parts[0].text;

    let response;
    try {
      response = await toolContext.searchMemory(userQuery);
    } catch (error) {
      logger.warn(`Failed to preload memory for query: ${userQuery}`);
      return;
    }

    if (!response.memories || response.memories.length === 0) {
      return;
    }

    const memoryTextLines: string[] = [];
    for (const memory of response.memories) {
      // Add timestamp if available
      if (memory.timestamp) {
        memoryTextLines.push(`Time: ${memory.timestamp}`);
      }

      // Extract text from memory content
      const memoryText = extractText(memory);
      if (memoryText) {
        if (memory.author) {
          memoryTextLines.push(`${memory.author}: ${memoryText}`);
        } else {
          memoryTextLines.push(memoryText);
        }
      }
    }

    if (memoryTextLines.length === 0) {
      return;
    }

    const fullMemoryText = memoryTextLines.join('\n');
    const systemInstruction = `The following content is from your previous conversations with the user.
They may be useful for answering the user's current query.
<PAST_CONVERSATIONS>
${fullMemoryText}
</PAST_CONVERSATIONS>`;

    appendInstructions(llmRequest, [systemInstruction]);
  }
}

/**
 * Singleton instance of PreloadMemoryTool for convenient usage.
 *
 * @example
 * ```typescript
 * import { preloadMemoryTool } from '@google/adk';
 *
 * const agent = new LlmAgent({
 *   name: 'my_agent',
 *   model: gemini,
 *   tools: [preloadMemoryTool],
 * });
 * ```
 */
export const preloadMemoryTool = new PreloadMemoryTool();
