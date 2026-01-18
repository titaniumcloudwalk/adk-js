/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Context cache processor for LLM requests.
 *
 * This processor sets up context caching configuration for agents that have
 * context caching enabled and finds the latest cache metadata from session
 * events. The actual cache management is handled by the model-specific cache
 * managers (e.g., GeminiContextCacheManager).
 */

import {InvocationContext} from '../../agents/invocation_context.js';
import {BaseLlmRequestProcessor} from '../../agents/base_llm_processor.js';
import {Event} from '../../events/event.js';
import {CacheMetadata} from '../../models/cache_metadata.js';
import {LlmRequest} from '../../models/llm_request.js';
import {logger} from '../../utils/logger.js';

/**
 * Request processor that enables context caching for LLM requests.
 *
 * This processor sets up context caching configuration for agents that have
 * context caching enabled and finds the latest cache metadata from session
 * events. The actual cache management is handled by the model-specific cache
 * managers (e.g., GeminiContextCacheManager).
 */
export class ContextCacheRequestProcessor extends BaseLlmRequestProcessor {
  /**
   * Process LLM request to enable context caching.
   *
   * @param invocationContext - Invocation context containing agent and session info
   * @param llmRequest - Request to process for caching
   * @yields No events are yielded by this processor
   */
  override async *runAsync(
    invocationContext: InvocationContext,
    llmRequest: LlmRequest,
  ): AsyncGenerator<Event, void, void> {
    const agent = invocationContext.agent;

    // Return early if no cache config
    if (!invocationContext.contextCacheConfig) {
      return;
    }

    // Set cache config to request
    llmRequest.cacheConfig = invocationContext.contextCacheConfig;

    // Find latest cache metadata and previous token count from session events
    const {cacheMetadata, previousTokenCount} = this.findCacheInfoFromEvents(
      invocationContext,
      agent.name,
      invocationContext.invocationId,
    );

    if (cacheMetadata) {
      llmRequest.cacheMetadata = cacheMetadata;
      logger.debug(
        `Found cache metadata for agent ${agent.name}: ${JSON.stringify(cacheMetadata)}`,
      );
    }

    if (previousTokenCount !== undefined) {
      llmRequest.cacheableContentsTokenCount = previousTokenCount;
      logger.debug(
        `Found previous prompt token count for agent ${agent.name}: ${previousTokenCount}`,
      );
    }

    logger.debug(`Context caching enabled for agent ${agent.name}`);

    // This processor yields no events
    return;
  }

  /**
   * Find cache metadata and previous token count from session events.
   *
   * @param invocationContext - Context containing session with events
   * @param agentName - Name of agent to find cache info for
   * @param currentInvocationId - Current invocation ID to compare for increment
   * @returns Object containing cache_metadata and previous_prompt_token_count
   */
  private findCacheInfoFromEvents(
    invocationContext: InvocationContext,
    agentName: string,
    currentInvocationId: string,
  ): {cacheMetadata: CacheMetadata | undefined; previousTokenCount: number | undefined} {
    if (!invocationContext.session?.events) {
      return {cacheMetadata: undefined, previousTokenCount: undefined};
    }

    let cacheMetadata: CacheMetadata | undefined;
    let previousTokenCount: number | undefined;

    // Search events from most recent to oldest using index traversal
    const events = invocationContext.session.events;
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event.author !== agentName) {
        continue;
      }

      // Look for cache metadata (only in actual LLM response events)
      if (cacheMetadata === undefined && event.cacheMetadata) {
        // Check if this is a different invocation and has active cache
        if (
          event.invocationId &&
          event.invocationId !== currentInvocationId &&
          event.cacheMetadata.cacheName
        ) {
          // Different invocation with active cache - increment invocationsUsed
          cacheMetadata = {
            ...event.cacheMetadata,
            invocationsUsed: (event.cacheMetadata.invocationsUsed ?? 0) + 1,
          };
        } else {
          // Same invocation or no active cache - return copy as-is
          cacheMetadata = {...event.cacheMetadata};
        }
      }

      // Look for previous prompt token count (from actual LLM response events)
      if (
        previousTokenCount === undefined &&
        event.usageMetadata?.promptTokenCount !== undefined
      ) {
        previousTokenCount = event.usageMetadata.promptTokenCount;
      }

      // Stop early if we found both pieces of information
      if (cacheMetadata !== undefined && previousTokenCount !== undefined) {
        break;
      }
    }

    return {cacheMetadata, previousTokenCount};
  }
}

/**
 * Module-level processor instance for use in flows.
 */
export const contextCacheRequestProcessor = new ContextCacheRequestProcessor();
