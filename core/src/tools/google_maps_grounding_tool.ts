/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {GenerateContentConfig} from '@google/genai';

import {LlmRequest} from '../models/llm_request.js';
import {isGemini1Model, isGeminiModel} from '../utils/model_name.js';

import {BaseTool, RunAsyncToolRequest, ToolProcessLlmRequest} from './base_tool.js';

/**
 * A built-in tool that is automatically invoked by Gemini 2 models to ground
 * query results with Google Maps.
 *
 * This tool operates internally within the model and does not require or perform
 * local code execution.
 *
 * **Important**: This tool is only available for use with the VertexAI Gemini API
 * (e.g., `GOOGLE_GENAI_USE_VERTEXAI=TRUE`).
 *
 * @example
 * ```typescript
 * import { GoogleMapsGroundingTool } from '@google/adk';
 *
 * const agent = new LlmAgent({
 *   name: 'location_agent',
 *   model: gemini,
 *   tools: [new GoogleMapsGroundingTool()],
 *   instruction: 'Help users find locations and get directions.',
 * });
 * ```
 *
 * @see https://ai.google.dev/gemini-api/docs/grounding for more information
 * about grounding in Gemini.
 */
export class GoogleMapsGroundingTool extends BaseTool {
  /**
   * Creates a new GoogleMapsGroundingTool instance.
   */
  constructor() {
    // Name and description are not used because this is a model built-in tool.
    super({name: 'google_maps', description: 'Google Maps Grounding Tool'});
  }

  /**
   * This tool does not execute locally - it's handled by the Gemini model.
   */
  runAsync(request: RunAsyncToolRequest): Promise<unknown> {
    return Promise.resolve();
  }

  /**
   * Processes the LLM request to add Google Maps grounding configuration.
   *
   * @param toolContext - The tool context
   * @param llmRequest - The LLM request to process
   * @throws Error if used with Gemini 1.x models (not supported)
   * @throws Error if used with non-Gemini models
   */
  override async processLlmRequest({
    toolContext,
    llmRequest,
  }: ToolProcessLlmRequest): Promise<void> {
    if (!llmRequest.model) {
      return;
    }

    llmRequest.config = llmRequest.config || ({} as GenerateContentConfig);
    llmRequest.config.tools = llmRequest.config.tools || [];

    if (isGemini1Model(llmRequest.model)) {
      throw new Error(
        'Google Maps grounding tool cannot be used with Gemini 1.x models.',
      );
    }

    if (isGeminiModel(llmRequest.model)) {
      llmRequest.config.tools.push({
        googleMaps: {},
      });
      return;
    }

    throw new Error(
      `Google Maps grounding tool is not supported for model ${llmRequest.model}`,
    );
  }
}

/**
 * A global instance of GoogleMapsGroundingTool for convenience.
 *
 * @example
 * ```typescript
 * import { GOOGLE_MAPS_GROUNDING } from '@google/adk';
 *
 * const agent = new LlmAgent({
 *   tools: [GOOGLE_MAPS_GROUNDING],
 * });
 * ```
 */
export const GOOGLE_MAPS_GROUNDING = new GoogleMapsGroundingTool();
