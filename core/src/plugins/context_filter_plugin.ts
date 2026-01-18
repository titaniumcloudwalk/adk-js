/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content} from '@google/genai';

import {CallbackContext} from '../agents/callback_context.js';
import {Event} from '../events/event.js';
import {LlmRequest} from '../models/llm_request.js';
import {LlmResponse} from '../models/llm_response.js';
import {logger} from '../utils/logger.js';

import {BasePlugin} from './base_plugin.js';

/**
 * Adjusts split_index to avoid orphaning function responses without their
 * matching function calls.
 *
 * When truncating context, we must avoid keeping a function_response while
 * dropping its matching preceding function_call.
 *
 * @param contents Full conversation contents in chronological order.
 * @param splitIndex Candidate split index (keep `contents[splitIndex:]`).
 * @returns A (possibly smaller) split index that preserves call/response pairs.
 */
function adjustSplitIndexToAvoidOrphanedFunctionResponses(
  contents: Content[],
  splitIndex: number,
): number {
  const neededCallIds = new Set<string>();

  for (let i = contents.length - 1; i >= 0; i--) {
    const parts = contents[i].parts;
    if (parts) {
      for (let j = parts.length - 1; j >= 0; j--) {
        const part = parts[j];
        if (part.functionResponse && part.functionResponse.id) {
          neededCallIds.add(part.functionResponse.id);
        }
        if (part.functionCall && part.functionCall.id) {
          neededCallIds.delete(part.functionCall.id);
        }
      }
    }

    if (i <= splitIndex && neededCallIds.size === 0) {
      return i;
    }
  }

  return 0;
}

/**
 * Type for custom filter function that can modify the contents array.
 */
export type CustomFilterFunction = (contents: Content[]) => Content[];

/**
 * Configuration options for ContextFilterPlugin.
 */
export interface ContextFilterPluginOptions {
  /**
   * The number of last invocations to keep. An invocation is defined as one or
   * more consecutive user messages followed by a model response.
   */
  numInvocationsToKeep?: number;

  /**
   * A custom function to filter the context. This function receives the
   * contents array and should return a filtered version.
   */
  customFilter?: CustomFilterFunction;

  /**
   * The name of the plugin instance.
   * @default 'context_filter_plugin'
   */
  name?: string;
}

/**
 * A plugin that filters the LLM context to reduce its size.
 *
 * This plugin helps manage context window limitations by removing older
 * conversation turns while preserving the most recent interactions. It's
 * particularly useful for long-running conversations where the full history
 * would exceed the model's context limits.
 *
 * @example
 * ```typescript
 * // Keep only the last 3 conversation invocations
 * const plugin = new ContextFilterPlugin({
 *   numInvocationsToKeep: 3,
 * });
 *
 * const runner = new Runner({
 *   agent: myAgent,
 *   plugins: [plugin],
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Use a custom filter to remove specific content
 * const plugin = new ContextFilterPlugin({
 *   customFilter: (contents) => {
 *     // Filter out system messages or apply custom logic
 *     return contents.filter(c => c.role !== 'system');
 *   },
 * });
 * ```
 */
export class ContextFilterPlugin extends BasePlugin {
  private readonly numInvocationsToKeep?: number;
  private readonly customFilter?: CustomFilterFunction;

  /**
   * Creates a new ContextFilterPlugin instance.
   *
   * @param options Configuration options for the plugin.
   */
  constructor(options: ContextFilterPluginOptions = {}) {
    super(options.name ?? 'context_filter_plugin');
    this.numInvocationsToKeep = options.numInvocationsToKeep;
    this.customFilter = options.customFilter;
  }

  /**
   * Filters the LLM request's context before it is sent to the model.
   *
   * This callback applies invocation-based filtering (if configured) and then
   * applies the custom filter (if provided). Function call/response pairs are
   * preserved to maintain conversation coherence.
   *
   * @param callbackContext The callback context.
   * @param llmRequest The LLM request to filter.
   * @returns undefined to allow normal execution to continue.
   */
  override async beforeModelCallback({
    callbackContext,
    llmRequest,
  }: {
    callbackContext: CallbackContext;
    llmRequest: LlmRequest;
  }): Promise<LlmResponse | undefined> {
    try {
      let contents = llmRequest.contents;

      // Apply invocation-based filtering
      if (
        this.numInvocationsToKeep !== undefined &&
        this.numInvocationsToKeep > 0
      ) {
        // Count the number of model turns (responses)
        const numModelTurns = contents.filter((c) => c.role === 'model').length;

        if (numModelTurns >= this.numInvocationsToKeep) {
          let modelTurnsToFind = this.numInvocationsToKeep;
          let splitIndex = 0;

          // Iterate backward to find the Nth-to-last model turn
          for (let i = contents.length - 1; i >= 0; i--) {
            if (contents[i].role === 'model') {
              modelTurnsToFind--;
              if (modelTurnsToFind === 0) {
                // Found the starting model turn, now include preceding user messages
                let startIndex = i;
                while (
                  startIndex > 0 &&
                  contents[startIndex - 1].role === 'user'
                ) {
                  startIndex--;
                }
                splitIndex = startIndex;
                break;
              }
            }
          }

          // Adjust split_index to avoid orphaned function_responses
          splitIndex = adjustSplitIndexToAvoidOrphanedFunctionResponses(
            contents,
            splitIndex,
          );

          contents = contents.slice(splitIndex);
        }
      }

      // Apply custom filter if provided
      if (this.customFilter) {
        contents = this.customFilter(contents);
      }

      // Update the request with filtered contents
      llmRequest.contents = contents;
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.error(`Failed to reduce context for request: ${errorMessage}`);
    }

    return undefined;
  }
}
