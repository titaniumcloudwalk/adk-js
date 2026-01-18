/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {GenerateContentConfig} from '@google/genai';

import {LlmRequest} from '../models/llm_request.js';
import {isGemini1Model, isGeminiModel} from '../utils/model_name.js';

import {BaseTool, RunAsyncToolRequest, ToolProcessLlmRequest} from './base_tool.js';
import {ToolContext} from './tool_context.js';

/**
 * Configuration options for GoogleSearchTool.
 */
export interface GoogleSearchToolConfig {
  /**
   * Whether to bypass the multi-tools limitation, allowing the tool to be used
   * with other tools in the same agent.
   *
   * When set to true, the tool will be automatically wrapped in a sub-agent
   * (GoogleSearchAgentTool) when used alongside other tools. This is a
   * workaround for Gemini's limitation that built-in tools cannot be used
   * together with other tools.
   *
   * @default false
   */
  bypassMultiToolsLimit?: boolean;
}

/**
 * A built-in tool that is automatically invoked by Gemini 2 models to retrieve
 * search results from Google Search.
 *
 * This tool operates internally within the model and does not require or
 * perform local code execution.
 *
 * @example
 * ```typescript
 * // Basic usage (cannot be used with other tools in Gemini 1.x)
 * const searchTool = new GoogleSearchTool();
 *
 * // With bypass flag (can be used with other tools)
 * const searchTool = new GoogleSearchTool({ bypassMultiToolsLimit: true });
 * ```
 */
export class GoogleSearchTool extends BaseTool {
  /**
   * Whether to bypass the multi-tools limitation.
   */
  readonly bypassMultiToolsLimit: boolean;

  /**
   * Creates a new GoogleSearchTool instance.
   *
   * @param config - Optional configuration options
   */
  constructor(config?: GoogleSearchToolConfig) {
    super({name: 'google_search', description: 'Google Search Tool'});
    this.bypassMultiToolsLimit = config?.bypassMultiToolsLimit ?? false;
  }

  runAsync(request: RunAsyncToolRequest): Promise<unknown> {
    // This is a built-in tool on server side, it's triggered by setting the
    // corresponding request parameters.
    return Promise.resolve();
  }

  override async processLlmRequest({toolContext, llmRequest}:
                                       ToolProcessLlmRequest):
      Promise<void> {
    if (!llmRequest.model) {
      return;
    }

    llmRequest.config = llmRequest.config || {} as GenerateContentConfig;
    llmRequest.config.tools = llmRequest.config.tools || [];

    if (isGemini1Model(llmRequest.model)) {
      if (llmRequest.config.tools.length > 0) {
        throw new Error(
            'Google search tool can not be used with other tools in Gemini 1.x.',
        );
      }

      llmRequest.config.tools.push({
        googleSearchRetrieval: {},
      });

      return;
    }

    if (isGeminiModel(llmRequest.model)) {
      llmRequest.config.tools.push({
        googleSearch: {},
      });

      return;
    }

    throw new Error(
        `Google search tool is not supported for model ${llmRequest.model}`,
    );
  }
}

/**
 * A global instance of GoogleSearchTool.
 */
export const GOOGLE_SEARCH = new GoogleSearchTool();
