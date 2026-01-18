/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Part} from '@google/genai';

import {CallbackContext} from '../agents/callback_context.js';
import {ReadonlyContext} from '../agents/readonly_context.js';
import {LlmRequest} from '../models/llm_request.js';

/**
 * Abstract base class for all planners.
 *
 * The planner allows the agent to generate plans for queries to guide its
 * actions. Planners can modify both the system instructions sent to the LLM
 * and process the LLM's response to extract planning information.
 *
 * @example
 * ```typescript
 * class MyCustomPlanner extends BasePlanner {
 *   buildPlanningInstruction(context: ReadonlyContext, request: LlmRequest): string | null {
 *     return "Follow these steps when answering...";
 *   }
 *
 *   processPlanningResponse(context: CallbackContext, parts: Part[]): Part[] | null {
 *     // Filter or transform response parts
 *     return parts.filter(part => !part.text?.includes('INTERNAL'));
 *   }
 * }
 * ```
 */
export abstract class BasePlanner {
  /**
   * Builds the system instruction to be appended to the LLM request for planning.
   *
   * This method is called before sending the request to the LLM. It can add
   * instructions that guide the model to generate plans, follow specific
   * reasoning patterns, or use structured output formats.
   *
   * @param readonlyContext - The readonly context of the invocation
   * @param llmRequest - The LLM request (readonly)
   * @returns The planning system instruction, or null if no instruction is needed
   */
  abstract buildPlanningInstruction(
    readonlyContext: ReadonlyContext,
    llmRequest: LlmRequest
  ): string | null;

  /**
   * Processes the LLM response for planning.
   *
   * This method is called after receiving the response from the LLM. It can
   * filter, transform, or annotate response parts based on planning tags,
   * reasoning markers, or other patterns.
   *
   * @param callbackContext - The callback context of the invocation
   * @param responseParts - The LLM response parts (readonly)
   * @returns The processed response parts, or null if no processing is needed
   */
  abstract processPlanningResponse(
    callbackContext: CallbackContext,
    responseParts: Part[]
  ): Part[] | null;
}
