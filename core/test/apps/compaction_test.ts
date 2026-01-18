/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {expect} from 'chai';

import {LlmAgent} from '../../src/agents/llm_agent.js';
import {App, createEventsCompactionConfig} from '../../src/apps/app.js';
import {BaseEventsSummarizer} from '../../src/apps/base_events_summarizer.js';
import {runCompactionForSlidingWindow} from '../../src/apps/compaction.js';
import {createEvent, Event} from '../../src/events/event.js';
import {createEventActions, createEventCompaction} from '../../src/events/event_actions.js';
import {InMemorySessionService} from '../../src/sessions/in_memory_session_service.js';
import {Session} from '../../src/sessions/session.js';

/**
 * Mock summarizer for testing.
 */
class MockSummarizer extends BaseEventsSummarizer {
  public callCount = 0;
  public lastEvents: Event[] = [];
  public shouldReturnUndefined = false;

  async maybeSummarizeEvents(events: Event[]): Promise<Event | undefined> {
    this.callCount++;
    this.lastEvents = events;

    if (this.shouldReturnUndefined) {
      return undefined;
    }

    // Create a mock compacted event
    const startTimestamp = events[0]?.timestamp ?? 0;
    const endTimestamp = events[events.length - 1]?.timestamp ?? 0;

    return createEvent({
      author: 'system',
      invocationId: 'compacted',
      timestamp: Date.now(),
      content: {
        role: 'model',
        parts: [{text: `Summary of ${events.length} events`}],
      },
      actions: {
        ...createEventActions(),
        compaction: createEventCompaction({
          startTimestamp,
          endTimestamp,
          compactedContent: {
            role: 'model',
            parts: [{text: `Summary of ${events.length} events`}],
          },
        }),
      },
    });
  }
}

describe('runCompactionForSlidingWindow', () => {
  let sessionService: InMemorySessionService;
  let session: Session;
  let mockSummarizer: MockSummarizer;

  beforeEach(async () => {
    sessionService = new InMemorySessionService();
    session = await sessionService.createSession({
      appName: 'test_app',
      userId: 'test_user',
    });
    mockSummarizer = new MockSummarizer();
  });

  function createTestEvent(
      invocationId: string,
      timestamp: number,
      text: string,
  ): Event {
    return createEvent({
      invocationId,
      timestamp,
      author: 'user',
      content: {
        role: 'user',
        parts: [{text}],
      },
    });
  }

  function createApp(compactionInterval = 2, overlapSize = 1): App {
    return new App({
      name: 'test_app',
      rootAgent: new LlmAgent({
        name: 'test_agent',
        model: 'gemini-2.0-flash',
      }),
      eventsCompactionConfig: {
        ...createEventsCompactionConfig({compactionInterval, overlapSize}),
        summarizer: mockSummarizer,
      },
    });
  }

  it('should skip compaction when no events', async () => {
    const app = createApp();

    await runCompactionForSlidingWindow(app, session, sessionService);

    expect(mockSummarizer.callCount).to.equal(0);
    expect(session.events.length).to.equal(0);
  });

  it('should skip compaction when not enough new invocations', async () => {
    const app = createApp(3, 1);

    // Add events from only 2 invocations (threshold is 3)
    session.events.push(createTestEvent('inv1', 1000, 'Hello'));
    session.events.push(createTestEvent('inv2', 2000, 'World'));

    await runCompactionForSlidingWindow(app, session, sessionService);

    expect(mockSummarizer.callCount).to.equal(0);
    expect(session.events.length).to.equal(2);
  });

  it('should trigger compaction when threshold is met', async () => {
    const app = createApp(2, 0);

    // Add events from 2 invocations (threshold is 2)
    session.events.push(createTestEvent('inv1', 1000, 'Hello'));
    session.events.push(createTestEvent('inv1', 1100, 'How are you?'));
    session.events.push(createTestEvent('inv2', 2000, 'Fine thanks'));

    await runCompactionForSlidingWindow(app, session, sessionService);

    expect(mockSummarizer.callCount).to.equal(1);
    expect(mockSummarizer.lastEvents.length).to.equal(3);
    // Compacted event should be appended
    expect(session.events.length).to.equal(4);
    expect(session.events[3].actions?.compaction).to.not.be.undefined;
  });

  it('should include overlap from previous compaction', async () => {
    const app = createApp(2, 1);

    // Add events from 3 invocations
    session.events.push(createTestEvent('inv1', 1000, 'Message 1'));
    session.events.push(createTestEvent('inv2', 2000, 'Message 2'));
    session.events.push(createTestEvent('inv3', 3000, 'Message 3'));

    await runCompactionForSlidingWindow(app, session, sessionService);

    expect(mockSummarizer.callCount).to.equal(1);
    // With overlapSize=1, should include inv1 (overlap) + inv2 + inv3 (new)
    // When there are 3 invocations and we need 2 new ones, that means inv2+inv3
    // With overlap of 1, we go back to inv1
    expect(mockSummarizer.lastEvents.length).to.equal(3);
  });

  it('should skip already compacted events when counting', async () => {
    const app = createApp(2, 0);

    // Add a compacted event (should not count as new invocation)
    session.events.push(createEvent({
      invocationId: 'compacted_inv',
      timestamp: 500,
      author: 'system',
      actions: {
        ...createEventActions(),
        compaction: createEventCompaction({
          startTimestamp: 0,
          endTimestamp: 500,
          compactedContent: {role: 'model', parts: [{text: 'Previous summary'}]},
        }),
      },
    }));

    // Add events from 2 new invocations
    session.events.push(createTestEvent('inv1', 1000, 'Hello'));
    session.events.push(createTestEvent('inv2', 2000, 'World'));

    await runCompactionForSlidingWindow(app, session, sessionService);

    expect(mockSummarizer.callCount).to.equal(1);
    // Should only compact the 2 new events, not the compacted one
    expect(mockSummarizer.lastEvents.length).to.equal(2);
  });

  it('should not compact if summarizer returns undefined', async () => {
    const app = createApp(2, 0);
    mockSummarizer.shouldReturnUndefined = true;

    session.events.push(createTestEvent('inv1', 1000, 'Hello'));
    session.events.push(createTestEvent('inv2', 2000, 'World'));

    const initialLength = session.events.length;
    await runCompactionForSlidingWindow(app, session, sessionService);

    expect(mockSummarizer.callCount).to.equal(1);
    // No new event should be appended
    expect(session.events.length).to.equal(initialLength);
  });

  it('should skip compaction when no compaction config', async () => {
    const app = new App({
      name: 'test_app',
      rootAgent: new LlmAgent({
        name: 'test_agent',
        model: 'gemini-2.0-flash',
      }),
      // No eventsCompactionConfig
    });

    session.events.push(createTestEvent('inv1', 1000, 'Hello'));
    session.events.push(createTestEvent('inv2', 2000, 'World'));

    await runCompactionForSlidingWindow(app, session, sessionService);

    // Should not throw and events should remain unchanged
    expect(session.events.length).to.equal(2);
  });

  it('should correctly identify new invocations after previous compaction', async () => {
    const app = createApp(2, 0);

    // Simulate a previous compaction that ended at timestamp 1500
    session.events.push(createEvent({
      invocationId: 'old_compacted',
      timestamp: 1500,
      author: 'system',
      content: {role: 'model', parts: [{text: 'Old summary'}]},
      actions: {
        ...createEventActions(),
        compaction: createEventCompaction({
          startTimestamp: 0,
          endTimestamp: 1500,
          compactedContent: {role: 'model', parts: [{text: 'Old summary'}]},
        }),
      },
    }));

    // Add events after the compaction timestamp
    session.events.push(createTestEvent('inv3', 2000, 'New message 1'));
    session.events.push(createTestEvent('inv4', 3000, 'New message 2'));

    await runCompactionForSlidingWindow(app, session, sessionService);

    expect(mockSummarizer.callCount).to.equal(1);
    // Should only include the 2 new events after timestamp 1500
    expect(mockSummarizer.lastEvents.length).to.equal(2);
    expect(mockSummarizer.lastEvents[0].invocationId).to.equal('inv3');
    expect(mockSummarizer.lastEvents[1].invocationId).to.equal('inv4');
  });
});
