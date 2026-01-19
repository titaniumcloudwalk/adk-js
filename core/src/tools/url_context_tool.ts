/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {GenerateContentConfig} from '@google/genai';

import {LlmRequest} from '../models/llm_request.js';
import {isGemini1Model, isGemini2OrAbove} from '../utils/model_name.js';

import {BaseTool, RunAsyncToolRequest, ToolProcessLlmRequest} from './base_tool.js';

/**
 * A built-in tool that is automatically invoked by Gemini 2 models to retrieve
 * content from URLs and use that content to inform and shape its response.
 *
 * This tool operates internally within the model and does not require or perform
 * local code execution.
 *
 * @example
 * ```typescript
 * import { UrlContextTool, URL_CONTEXT } from '@google/adk';
 *
 * // Use the singleton instance
 * const agent = new LlmAgent({
 *   tools: [URL_CONTEXT],
 * });
 *
 * // Or create a new instance
 * const urlTool = new UrlContextTool();
 * ```
 */
export class UrlContextTool extends BaseTool {
  /**
   * Creates a new UrlContextTool instance.
   */
  constructor() {
    // Name and description are not used because this is a model built-in tool.
    super({name: 'url_context', description: 'url_context'});
  }

  /**
   * This tool does not perform local execution - it's handled by the model.
   */
  runAsync(request: RunAsyncToolRequest): Promise<unknown> {
    // This is a built-in tool on server side, it's triggered by setting the
    // corresponding request parameters.
    return Promise.resolve();
  }

  /**
   * Processes the LLM request to add URL context configuration.
   *
   * @throws Error if used with Gemini 1.x models (not supported)
   * @throws Error if used with non-Gemini models
   */
  override async processLlmRequest({toolContext, llmRequest}:
                                       ToolProcessLlmRequest):
      Promise<void> {
    llmRequest.config = llmRequest.config || {} as GenerateContentConfig;
    llmRequest.config.tools = llmRequest.config.tools || [];

    const model = llmRequest.model ?? '';
    if (isGemini1Model(model)) {
      throw new Error('Url context tool cannot be used in Gemini 1.x.');
    } else if (isGemini2OrAbove(model)) {
      llmRequest.config.tools.push({
        urlContext: {},
      });
    } else {
      throw new Error(
          `Url context tool is not supported for model ${llmRequest.model}`,
      );
    }
  }
}

/**
 * A global singleton instance of UrlContextTool.
 *
 * Use this for convenience when adding URL context capability to agents:
 * ```typescript
 * const agent = new LlmAgent({
 *   tools: [URL_CONTEXT],
 * });
 * ```
 */
export const URL_CONTEXT = new UrlContextTool();
