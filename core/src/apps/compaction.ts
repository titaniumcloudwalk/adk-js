/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Event} from '../events/event.js';
import {BaseLlm} from '../models/base_llm.js';
import {BaseSessionService} from '../sessions/base_session_service.js';
import {Session} from '../sessions/session.js';

import {App} from './app.js';
import {LlmEventSummarizer} from './llm_event_summarizer.js';

/**
 * Type guard to check if an agent has a canonicalModel property.
 */
function hasCanonicalModel(agent: unknown): agent is {canonicalModel: BaseLlm} {
  return typeof agent === 'object' && agent !== null &&
      'canonicalModel' in agent &&
      typeof (agent as {canonicalModel: unknown}).canonicalModel === 'object';
}

/**
 * Runs sliding window compaction for an app's session.
 *
 * This function implements the sliding window compaction algorithm:
 * 1. Find the last compacted event's end timestamp
 * 2. Identify new invocations since the last compaction
 * 3. If enough new invocations exist (>= compactionInterval), trigger compaction
 * 4. Determine the compaction range with overlap
 * 5. Create a summarized event and append it to the session
 *
 * @example
 * ```typescript
 * // After completing an agent invocation:
 * await runCompactionForSlidingWindow(app, session, sessionService);
 * ```
 *
 * @param app The app containing compaction configuration.
 * @param session The session to compact events for.
 * @param sessionService The session service to append compacted events.
 */
export async function runCompactionForSlidingWindow(
    app: App,
    session: Session,
    sessionService: BaseSessionService,
): Promise<void> {
  // Skip if no compaction config
  if (!app.eventsCompactionConfig) {
    return;
  }

  const events = session.events;
  if (!events || events.length === 0) {
    return;
  }

  // Find the last compacted end timestamp
  let lastCompactedEndTimestamp = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const compaction = events[i].actions?.compaction;
    if (compaction?.endTimestamp !== undefined) {
      lastCompactedEndTimestamp = compaction.endTimestamp;
      break;
    }
  }

  // Get unique invocation IDs with their latest timestamps
  const invocationLatestTimestamps: Record<string, number> = {};
  for (const event of events) {
    // Skip compaction events when counting invocations
    if (event.invocationId && !event.actions?.compaction) {
      invocationLatestTimestamps[event.invocationId] = Math.max(
          invocationLatestTimestamps[event.invocationId] ?? 0,
          event.timestamp,
      );
    }
  }

  const uniqueInvocationIds = Object.keys(invocationLatestTimestamps);

  // Find new invocations (those with latest timestamp after last compaction)
  const newInvocationIds = uniqueInvocationIds.filter(
      (invId) => invocationLatestTimestamps[invId] > lastCompactedEndTimestamp,
  );

  // Check if we have enough new invocations to trigger compaction
  if (newInvocationIds.length < app.eventsCompactionConfig.compactionInterval) {
    return;
  }

  // Calculate compaction range
  // End: the last of the new invocations
  const endInvId = newInvocationIds[newInvocationIds.length - 1];

  // Start: overlapSize invocations before the first new invocation
  const firstNewInvIdx = uniqueInvocationIds.indexOf(newInvocationIds[0]);
  const startIdx =
      Math.max(0, firstNewInvIdx - app.eventsCompactionConfig.overlapSize);
  const startInvId = uniqueInvocationIds[startIdx];

  // Find events to compact (events in the range, excluding existing compaction events)
  const eventsToCompact: Event[] = [];

  // Find the index range in the events array
  const firstEventIdx = events.findIndex((e) => e.invocationId === startInvId);
  const lastEventIdx = findLastIndex(events, (e) => e.invocationId === endInvId);

  if (firstEventIdx === -1 || lastEventIdx === -1) {
    return;
  }

  // Collect events in range, excluding compaction events
  for (let i = firstEventIdx; i <= lastEventIdx; i++) {
    if (!events[i].actions?.compaction) {
      eventsToCompact.push(events[i]);
    }
  }

  if (eventsToCompact.length === 0) {
    return;
  }

  // Get or create summarizer
  let summarizer = app.eventsCompactionConfig.summarizer;
  if (!summarizer) {
    // Create a default LlmEventSummarizer using the root agent's model
    if (!hasCanonicalModel(app.rootAgent)) {
      // Cannot create summarizer without a model
      return;
    }
    const canonicalModel = app.rootAgent.canonicalModel;
    summarizer = new LlmEventSummarizer({llm: canonicalModel});
    app.eventsCompactionConfig.summarizer = summarizer;
  }

  // Summarize events
  const compactionEvent = await summarizer.maybeSummarizeEvents(eventsToCompact);

  if (compactionEvent) {
    await sessionService.appendEvent({session, event: compactionEvent});
  }
}

/**
 * Finds the last index of an element in an array that satisfies the predicate.
 *
 * @param arr The array to search.
 * @param predicate The function to test each element.
 * @returns The index of the last matching element, or -1 if not found.
 */
function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) {
      return i;
    }
  }
  return -1;
}
