/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Part, ThinkingConfig} from '@google/genai';

import {CallbackContext} from '../agents/callback_context.js';
import {ReadonlyContext} from '../agents/readonly_context.js';
import {LlmRequest} from '../models/llm_request.js';
import {logger} from '../utils/logger.js';

import {BasePlanner} from './base_planner.js';

/**
 * The built-in planner that uses the model's native thinking features.
 *
 * This planner leverages Gemini's built-in thinking capabilities by configuring
 * the `thinking_config` parameter in the LLM request. When enabled, the model
 * will generate internal reasoning steps before producing its final response.
 *
 * Note: This planner requires a model that supports the thinking feature
 * (e.g., Gemini 2.5 models). An error will be returned if the thinking config
 * is set for models that don't support it.
 *
 * @example
 * ```typescript
 * const planner = new BuiltInPlanner({
 *   thinkingConfig: {
 *     thinkingBudget: 8192, // Max tokens for thinking
 *   }
 * });
 *
 * const agent = new LlmAgent({
 *   model: new GoogleLLM({model: 'gemini-2.5-pro'}),
 *   instruction: 'You are a helpful assistant',
 *   planner: planner,
 * });
 * ```
 */
export class BuiltInPlanner extends BasePlanner {
  /**
   * Config for model built-in thinking features. An error will be returned if
   * this field is set for models that don't support thinking.
   */
  readonly thinkingConfig: ThinkingConfig;

  /**
   * Initializes the built-in planner.
   *
   * @param options - Configuration options
   * @param options.thinkingConfig - Config for model built-in thinking features
   */
  constructor(options: {thinkingConfig: ThinkingConfig}) {
    super();
    this.thinkingConfig = options.thinkingConfig;
  }

  /**
   * Applies the thinking config to the LLM request.
   *
   * This method sets the `thinking_config` on the request's generate content
   * config. If a thinking config already exists in the request, it will be
   * overwritten with the one from this planner.
   *
   * @param llmRequest - The LLM request to apply the thinking config to
   */
  applyThinkingConfig(llmRequest: LlmRequest): void {
    if (this.thinkingConfig) {
      llmRequest.config = llmRequest.config || {};
      if (llmRequest.config.thinkingConfig) {
        logger.debug(
          'Overwriting `thinkingConfig` from `generateContentConfig` with ' +
          'the one provided by the `BuiltInPlanner`.'
        );
      }
      llmRequest.config.thinkingConfig = this.thinkingConfig;
    }
  }

  /**
   * The built-in planner does not add any additional system instructions.
   *
   * @returns null - No additional planning instruction needed
   */
  buildPlanningInstruction(
    _readonlyContext: ReadonlyContext,
    _llmRequest: LlmRequest
  ): string | null {
    return null;
  }

  /**
   * The built-in planner does not process the response.
   *
   * The model's native thinking output is already properly formatted and
   * doesn't require additional processing.
   *
   * @returns null - No response processing needed
   */
  processPlanningResponse(
    _callbackContext: CallbackContext,
    _responseParts: Part[]
  ): Part[] | null {
    return null;
  }
}
