/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Part} from '@google/genai';

import {CallbackContext} from '../agents/callback_context.js';
import {LlmRequest} from '../models/llm_request.js';
import {LlmResponse} from '../models/llm_response.js';
import {BaseTool} from '../tools/base_tool.js';
import {ToolContext} from '../tools/tool_context.js';
import {BasePlugin} from './base_plugin.js';

/**
 * State key used to store parts returned by tools.
 * Uses 'temp:' prefix so it's automatically excluded from session persistence.
 */
export const PARTS_RETURNED_BY_TOOLS_ID = 'temp:PARTS_RETURNED_BY_TOOLS_ID';

/**
 * Options for configuring the MultimodalToolResultsPlugin.
 */
export interface MultimodalToolResultsPluginOptions {
  /**
   * The name of the plugin instance.
   * @default 'multimodal_tool_results_plugin'
   */
  name?: string;
}

/**
 * A plugin that enables tool responses to return multimodal parts directly.
 *
 * This plugin modifies function tool responses to support returning
 * `google.genai.types.Part` or `Part[]` directly instead of just JSON objects.
 * The parts are stored in the tool context state and then attached to the
 * LLM request before the next model call.
 *
 * This is useful for tools that need to return images, audio, or other
 * multimodal content that should be passed directly to the LLM's context.
 *
 * Note: This plugin should be removed in favor of directly supporting
 * FunctionResponsePart when these are supported outside of computer use tools.
 *
 * @example
 * ```typescript
 * // Tool that returns an image part
 * const screenshotTool = new FunctionTool({
 *   name: 'take_screenshot',
 *   description: 'Takes a screenshot and returns it',
 *   execute: async (args, toolContext) => {
 *     const imageData = await captureScreen();
 *     // Return a Part directly - the plugin will handle it
 *     return {
 *       inlineData: {
 *         mimeType: 'image/png',
 *         data: imageData.toString('base64'),
 *       },
 *     } as Part;
 *   },
 * });
 *
 * // Use with the plugin
 * const runner = new Runner({
 *   agent: myAgent,
 *   plugins: [new MultimodalToolResultsPlugin()],
 * });
 * ```
 */
export class MultimodalToolResultsPlugin extends BasePlugin {
  /**
   * Initialize the multimodal tool results plugin.
   *
   * @param options - Configuration options for the plugin.
   */
  constructor(options: MultimodalToolResultsPluginOptions = {}) {
    super(options.name ?? 'multimodal_tool_results_plugin');
  }

  /**
   * Saves parts returned by the tool in ToolContext state.
   *
   * Later these are passed to the LLM's context as-is.
   * No-op if tool doesn't return `Part` or `Part[]`.
   *
   * @param tool - The tool instance that was executed.
   * @param toolArgs - The arguments passed to the tool.
   * @param toolContext - The context specific to the tool execution.
   * @param result - The result returned by the tool.
   * @returns `undefined` if parts were captured (indicating to skip normal response handling),
   *          or the original result if it wasn't a Part.
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
    result: unknown;
  }): Promise<Record<string, unknown> | undefined> {
    // Check if result is a Part or a list of Parts
    if (!this.isPart(result) && !this.isPartArray(result)) {
      // Not a Part or Part[] - return result unchanged
      return result as Record<string, unknown> | undefined;
    }

    // Convert single Part to array for uniform handling
    const parts: Part[] = this.isPart(result) ? [result] : (result as Part[]);

    // Get or initialize the saved parts array
    const existingParts = toolContext.state.get(PARTS_RETURNED_BY_TOOLS_ID) as
      | Part[]
      | undefined;

    if (existingParts) {
      // Append to existing parts
      toolContext.state.set(PARTS_RETURNED_BY_TOOLS_ID, [
        ...existingParts,
        ...parts,
      ]);
    } else {
      // Initialize with new parts
      toolContext.state.set(PARTS_RETURNED_BY_TOOLS_ID, parts);
    }

    // Return undefined to indicate parts were captured
    // The framework will use this to skip normal response handling
    return undefined;
  }

  /**
   * Attaches saved Parts returned by tools to the LLM request.
   *
   * @param callbackContext - The context for the current agent call.
   * @param llmRequest - The prepared request object to be sent to the model.
   * @returns `undefined` to allow the LLM request to proceed normally.
   */
  override async beforeModelCallback({
    callbackContext,
    llmRequest,
  }: {
    callbackContext: CallbackContext;
    llmRequest: LlmRequest;
  }): Promise<LlmResponse | undefined> {
    const savedParts = callbackContext.state.get(PARTS_RETURNED_BY_TOOLS_ID) as
      | Part[]
      | undefined;

    if (savedParts && savedParts.length > 0 && llmRequest.contents) {
      // Append saved parts to the last content's parts
      const lastContent = llmRequest.contents[llmRequest.contents.length - 1];
      if (lastContent && lastContent.parts) {
        lastContent.parts = [...lastContent.parts, ...savedParts];
      }

      // Clear the saved parts from state
      callbackContext.state.set(PARTS_RETURNED_BY_TOOLS_ID, []);
    }

    // Return undefined to proceed with the LLM request
    return undefined;
  }

  /**
   * Checks if a value is a google.genai.types.Part object.
   *
   * A Part can have one of these mutually exclusive fields:
   * - text: string
   * - inlineData: with data and mimeType
   * - fileData: with fileUri
   * - functionCall: with name and args
   * - functionResponse: with name and response
   * - executableCode: with code
   * - codeExecutionResult: with outcome
   * - thought: boolean flag for thought parts
   */
  private isPart(value: unknown): value is Part {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const obj = value as Record<string, unknown>;

    // Check for common Part fields
    return (
      'text' in obj ||
      'inlineData' in obj ||
      'fileData' in obj ||
      'functionCall' in obj ||
      'functionResponse' in obj ||
      'executableCode' in obj ||
      'codeExecutionResult' in obj ||
      'thought' in obj
    );
  }

  /**
   * Checks if a value is an array of Part objects.
   */
  private isPartArray(value: unknown): value is Part[] {
    if (!Array.isArray(value) || value.length === 0) {
      return false;
    }

    // Check if the first element is a Part (heuristic matching Python impl)
    return this.isPart(value[0]);
  }
}
