/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {createEvent, createNewEventId, Event} from '../events/event.js';
import {createEventActions, createEventCompaction} from '../events/event_actions.js';
import {BaseLlm} from '../models/base_llm.js';
import {LlmRequest} from '../models/llm_request.js';

import {BaseEventsSummarizer} from './base_events_summarizer.js';

/**
 * Configuration options for LlmEventSummarizer.
 */
export interface LlmEventSummarizerParams {
  /**
   * The LLM to use for summarization.
   */
  llm: BaseLlm;

  /**
   * Custom prompt template for summarization.
   * Use `{conversationHistory}` placeholder for the conversation text.
   * If not provided, a default template is used.
   */
  promptTemplate?: string;
}

/**
 * Default prompt template for conversation summarization.
 */
const DEFAULT_PROMPT_TEMPLATE =
    'The following is a conversation history between a user and an AI agent. ' +
    'Please summarize the conversation, focusing on key information and ' +
    'decisions made, as well as any unresolved questions or tasks. ' +
    'The summary should be concise and capture the essence of the interaction.\n\n{conversationHistory}';

/**
 * LLM-based implementation of event summarization.
 *
 * Uses a language model to generate concise summaries of conversation events,
 * enabling efficient context compaction for long-running agent sessions.
 *
 * @example
 * ```typescript
 * const summarizer = new LlmEventSummarizer({
 *   llm: new Gemini({ model: 'gemini-2.0-flash' }),
 * });
 *
 * const compactedEvent = await summarizer.maybeSummarizeEvents(events);
 * ```
 */
export class LlmEventSummarizer extends BaseEventsSummarizer {
  private readonly llm: BaseLlm;
  private readonly promptTemplate: string;

  constructor(params: LlmEventSummarizerParams) {
    super();
    this.llm = params.llm;
    this.promptTemplate = params.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE;
  }

  /**
   * Summarizes a list of events using the LLM.
   *
   * Extracts text content from events, formats them into a conversation
   * history, and uses the LLM to generate a summary. The summary is
   * then wrapped in a compacted event.
   *
   * @param events Events to summarize. Should be in chronological order.
   * @returns A new event with `actions.compaction` set, or undefined if
   *          summarization failed.
   */
  async maybeSummarizeEvents(events: Event[]): Promise<Event | undefined> {
    if (!events || events.length === 0) {
      return undefined;
    }

    // Format events into conversation history
    const conversationHistory = this.formatEventsForPrompt(events);
    if (!conversationHistory.trim()) {
      return undefined;
    }

    // Create prompt
    const prompt =
        this.promptTemplate.replace('{conversationHistory}', conversationHistory);

    // Call LLM
    const llmRequest: LlmRequest = {
      model: this.llm.model,
      contents: [
        {
          role: 'user',
          parts: [{text: prompt}],
        },
      ],
      toolsDict: {},
      liveConnectConfig: {},
    };

    try {
      let summaryText: string | undefined;
      for await (const response of this.llm.generateContentAsync(llmRequest)) {
        if (response.content?.parts) {
          for (const part of response.content.parts) {
            if (part.text) {
              summaryText = (summaryText ?? '') + part.text;
            }
          }
        }
      }

      if (!summaryText) {
        return undefined;
      }

      // Create compacted event
      const startTimestamp = events[0].timestamp;
      const endTimestamp = events[events.length - 1].timestamp;

      const compaction = createEventCompaction({
        startTimestamp,
        endTimestamp,
        compactedContent: {
          role: 'model',
          parts: [{text: summaryText}],
        },
      });

      return createEvent({
        id: createNewEventId(),
        invocationId: createNewEventId(),
        author: 'system',
        timestamp: Date.now(),
        content: {
          role: 'model',
          parts: [{text: summaryText}],
        },
        actions: {
          ...createEventActions(),
          compaction,
        },
      });
    } catch {
      // If LLM call fails, return undefined to skip compaction
      return undefined;
    }
  }

  /**
   * Formats a list of events into a conversation history string.
   *
   * Extracts text content from each event's parts and formats them
   * with the author's role prefix.
   *
   * @param events Events to format.
   * @returns A formatted conversation history string.
   */
  private formatEventsForPrompt(events: Event[]): string {
    const formattedLines: string[] = [];

    for (const event of events) {
      // Skip events that are compaction events
      if (event.actions?.compaction) {
        continue;
      }

      if (event.content?.parts) {
        for (const part of event.content.parts) {
          if (part.text) {
            const author = event.author ?? 'unknown';
            formattedLines.push(`${author}: ${part.text}`);
          }
        }
      }
    }

    return formattedLines.join('\n');
  }
}
