/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Event} from '../events/event.js';

/**
 * Abstract base class for event summarization implementations.
 *
 * Event summarizers are used to compact a list of events into a single
 * summary event, which helps reduce memory usage and improves context
 * management in long-running agent conversations.
 *
 * @example
 * ```typescript
 * class MyCustomSummarizer extends BaseEventsSummarizer {
 *   async maybeSummarizeEvents(events: Event[]): Promise<Event | undefined> {
 *     // Custom summarization logic
 *     return createCompactedEvent(summary);
 *   }
 * }
 * ```
 */
export abstract class BaseEventsSummarizer {
  /**
   * Compacts a list of events into a single event.
   *
   * If compaction failed or is not possible, returns undefined.
   * Otherwise, compacts the events into a new event with the
   * `actions.compaction` field set.
   *
   * @param events Events to compact. Should be in chronological order.
   * @returns The new compacted event, or undefined if no compaction happened.
   */
  abstract maybeSummarizeEvents(events: Event[]): Promise<Event | undefined>;
}
