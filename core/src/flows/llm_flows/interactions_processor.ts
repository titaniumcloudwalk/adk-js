/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Interactions API processor for LLM requests.
 *
 * This processor extracts the previous_interaction_id from session events
 * to enable stateful conversation chaining via the Interactions API.
 * The actual content filtering (retaining only latest user messages) is
 * done in the Gemini class when using the Interactions API.
 */

import {InvocationContext} from '../../agents/invocation_context.js';
import {LlmAgent} from '../../agents/llm_agent.js';
import {BaseLlmRequestProcessor} from '../../agents/base_llm_processor.js';
import {Event} from '../../events/event.js';
import {Gemini} from '../../models/google_llm.js';
import {LlmRequest} from '../../models/llm_request.js';
import {logger} from '../../utils/logger.js';

/**
 * Request processor for Interactions API stateful conversations.
 *
 * This processor extracts the previous_interaction_id from session events
 * to enable stateful conversation chaining via the Interactions API.
 * The actual content filtering (retaining only latest user messages) is
 * done in the Gemini class when using the Interactions API.
 */
export class InteractionsRequestProcessor extends BaseLlmRequestProcessor {
  /**
   * Process LLM request to extract previous_interaction_id.
   *
   * @param invocationContext - Invocation context containing agent and session info
   * @param llmRequest - Request to process
   * @yields No events are yielded by this processor
   */
  override async *runAsync(
    invocationContext: InvocationContext,
    llmRequest: LlmRequest,
  ): AsyncGenerator<Event, void, void> {
    const agent = invocationContext.agent;

    // Only process if using LlmAgent with Gemini and interactions API
    if (!(agent instanceof LlmAgent)) {
      return;
    }

    const model = agent.canonicalModel;
    if (!(model instanceof Gemini)) {
      return;
    }

    if (!model.isUsingInteractionsApi) {
      return;
    }

    // Extract previous interaction ID from session events
    const previousInteractionId = this.findPreviousInteractionId(invocationContext);

    if (previousInteractionId) {
      llmRequest.previousInteractionId = previousInteractionId;
      logger.debug(
        `Found previous_interaction_id for interactions API: ${previousInteractionId}`,
      );
    }

    // Don't yield any events - this is just a preprocessing step
    return;
  }

  /**
   * Find the previous interaction ID from session events.
   *
   * For interactions API stateful mode, we need to find the most recent
   * interaction_id from model responses to chain interactions.
   *
   * @param invocationContext - The invocation context containing session events
   * @returns The previous interaction ID if found, undefined otherwise
   */
  private findPreviousInteractionId(
    invocationContext: InvocationContext,
  ): string | undefined {
    const events = invocationContext.session.events;
    const currentBranch = invocationContext.branch;
    const agentName = invocationContext.agent.name;

    logger.debug(
      `Finding previous_interaction_id: agent=${agentName}, branch=${currentBranch}, num_events=${events.length}`,
    );

    // Iterate backwards through events to find the most recent interaction_id
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];

      // Skip events not in current branch
      if (!this.isEventInBranch(currentBranch, event)) {
        logger.debug(
          `Skipping event not in branch: author=${event.author}, branch=${event.branch}, current=${currentBranch}`,
        );
        continue;
      }

      // Look for model responses with interaction_id from this agent
      logger.debug(
        `Checking event: author=${event.author}, interaction_id=${event.interactionId}, branch=${event.branch}`,
      );

      // Only consider events from this agent (skip sub-agent events)
      if (event.author === agentName && event.interactionId) {
        logger.debug(
          `Found interaction_id from agent ${agentName}: ${event.interactionId}`,
        );
        return event.interactionId;
      }
    }

    return undefined;
  }

  /**
   * Check if an event belongs to the current branch.
   *
   * @param currentBranch - The current branch name
   * @param event - The event to check
   * @returns True if the event belongs to the current branch
   */
  private isEventInBranch(currentBranch: string | undefined, event: Event): boolean {
    if (!currentBranch) {
      // No branch means we're at the root, include all events without branch
      return !event.branch;
    }
    // Event must be in the same branch or have no branch (root level)
    return event.branch === currentBranch || !event.branch;
  }
}

/**
 * Module-level processor instance for use in flow configuration.
 */
export const interactionsRequestProcessor = new InteractionsRequestProcessor();
