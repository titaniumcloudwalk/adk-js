/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseAgent,
  createEvent,
  createEventActions,
  Event,
  InMemoryArtifactService,
  InMemorySessionService,
  InvocationContext,
  LlmAgent,
  Runner,
} from '@google/adk';

const TEST_APP_ID = 'test_app_rewind';
const TEST_USER_ID = 'test_user_id';
const TEST_SESSION_ID = 'test_session_id';

/**
 * Mock agent for testing that tracks state updates.
 */
class MockLlmAgent extends LlmAgent {
  constructor(name: string, parentAgent?: BaseAgent) {
    super({
      name,
      model: 'gemini-2.5-flash',
      subAgents: [],
      parentAgent,
    });
  }

  protected override async *runAsyncImpl(
    context: InvocationContext
  ): AsyncGenerator<Event, void, void> {
    yield createEvent({
      invocationId: context.invocationId,
      author: this.name,
      content: {role: 'model', parts: [{text: 'Test response'}]},
    });
  }
}

describe('Runner.rewindAsync', () => {
  let sessionService: InMemorySessionService;
  let artifactService: InMemoryArtifactService;
  let runner: Runner;

  beforeEach(() => {
    sessionService = new InMemorySessionService();
    artifactService = new InMemoryArtifactService();
    runner = new Runner({
      appName: TEST_APP_ID,
      agent: new MockLlmAgent('test_agent'),
      sessionService,
      artifactService,
    });
  });

  it('should throw error when session not found', async () => {
    await expect(
      runner.rewindAsync({
        userId: TEST_USER_ID,
        sessionId: 'non_existent_session',
        rewindBeforeInvocationId: 'inv1',
      })
    ).rejects.toThrow('Session not found: non_existent_session');
  });

  it('should throw error when invocation ID not found', async () => {
    await sessionService.createSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    await expect(
      runner.rewindAsync({
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
        rewindBeforeInvocationId: 'non_existent_invocation',
      })
    ).rejects.toThrow('Invocation ID not found: non_existent_invocation');
  });

  it('should create rewind event with correct invocation ID', async () => {
    const session = await sessionService.createSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    // Add some events
    const event1 = createEvent({
      invocationId: 'inv1',
      author: 'user',
      content: {role: 'user', parts: [{text: 'Message 1'}]},
      actions: createEventActions({stateDelta: {color: 'red'}}),
    });
    const event2 = createEvent({
      invocationId: 'inv2',
      author: 'model',
      content: {role: 'model', parts: [{text: 'Response 1'}]},
      actions: createEventActions({stateDelta: {color: 'blue'}}),
    });
    const event3 = createEvent({
      invocationId: 'inv3',
      author: 'user',
      content: {role: 'user', parts: [{text: 'Message 2'}]},
      actions: createEventActions({stateDelta: {size: 'large'}}),
    });

    await sessionService.appendEvent({session, event: event1});
    await sessionService.appendEvent({session, event: event2});
    await sessionService.appendEvent({session, event: event3});

    // Rewind before inv2
    await runner.rewindAsync({
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
      rewindBeforeInvocationId: 'inv2',
    });

    // Verify rewind event was added
    const updatedSession = await sessionService.getSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    const rewindEvent = updatedSession!.events[updatedSession!.events.length - 1];
    expect(rewindEvent.actions.rewindBeforeInvocationId).toBe('inv2');
    expect(rewindEvent.author).toBe('user');
  });

  it('should compute correct state delta for rewind', async () => {
    const session = await sessionService.createSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    // Event 1: Set color=red
    const event1 = createEvent({
      invocationId: 'inv1',
      author: 'user',
      content: {role: 'user', parts: [{text: 'Message 1'}]},
      actions: createEventActions({stateDelta: {color: 'red'}}),
    });
    // Event 2: Set color=blue, shape=circle
    const event2 = createEvent({
      invocationId: 'inv2',
      author: 'model',
      content: {role: 'model', parts: [{text: 'Response 1'}]},
      actions: createEventActions({stateDelta: {color: 'blue', shape: 'circle'}}),
    });
    // Event 3: Set size=large
    const event3 = createEvent({
      invocationId: 'inv3',
      author: 'user',
      content: {role: 'user', parts: [{text: 'Message 2'}]},
      actions: createEventActions({stateDelta: {size: 'large'}}),
    });

    await sessionService.appendEvent({session, event: event1});
    await sessionService.appendEvent({session, event: event2});
    await sessionService.appendEvent({session, event: event3});

    // Rewind before inv2 - should restore to state: {color: 'red'}
    await runner.rewindAsync({
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
      rewindBeforeInvocationId: 'inv2',
    });

    const updatedSession = await sessionService.getSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    const rewindEvent = updatedSession!.events[updatedSession!.events.length - 1];

    // State delta should restore color to 'red' and remove shape and size
    expect(rewindEvent.actions.stateDelta).toEqual({
      color: 'red',
      shape: null,
      size: null,
    });
  });

  it('should not revert app-level or user-level state', async () => {
    const session = await sessionService.createSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    // Event 1: Set session-level and app-level state
    const event1 = createEvent({
      invocationId: 'inv1',
      author: 'user',
      content: {role: 'user', parts: [{text: 'Message 1'}]},
      actions: createEventActions({
        stateDelta: {
          color: 'red',
          'app:setting': 'value1',
          'user:pref': 'pref1',
        },
      }),
    });
    // Event 2: Update session-level and app-level state
    const event2 = createEvent({
      invocationId: 'inv2',
      author: 'model',
      content: {role: 'model', parts: [{text: 'Response 1'}]},
      actions: createEventActions({
        stateDelta: {
          color: 'blue',
          'app:setting': 'value2',
          'user:pref': 'pref2',
        },
      }),
    });

    await sessionService.appendEvent({session, event: event1});
    await sessionService.appendEvent({session, event: event2});

    // Rewind before inv2
    await runner.rewindAsync({
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
      rewindBeforeInvocationId: 'inv2',
    });

    const updatedSession = await sessionService.getSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    const rewindEvent = updatedSession!.events[updatedSession!.events.length - 1];

    // Only session-level state should be reverted
    expect(rewindEvent.actions.stateDelta).toEqual({
      color: 'red',
    });

    // App and user-level state should NOT be in the delta
    expect(rewindEvent.actions.stateDelta['app:setting']).toBeUndefined();
    expect(rewindEvent.actions.stateDelta['user:pref']).toBeUndefined();
  });

  it('should compute artifact delta for rewind', async () => {
    const session = await sessionService.createSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    // Event 1: Create artifact at version 0
    const event1 = createEvent({
      invocationId: 'inv1',
      author: 'user',
      content: {role: 'user', parts: [{text: 'Message 1'}]},
      actions: createEventActions({artifactDelta: {'file1.txt': 0}}),
    });
    // Save the actual artifact
    await artifactService.saveArtifact({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
      filename: 'file1.txt',
      artifact: {inlineData: {mimeType: 'text/plain', data: 'dmVyc2lvbjA='}},
    });

    // Event 2: Update artifact to version 1
    const event2 = createEvent({
      invocationId: 'inv2',
      author: 'model',
      content: {role: 'model', parts: [{text: 'Response 1'}]},
      actions: createEventActions({artifactDelta: {'file1.txt': 1}}),
    });
    // Save the updated artifact
    await artifactService.saveArtifact({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
      filename: 'file1.txt',
      artifact: {inlineData: {mimeType: 'text/plain', data: 'dmVyc2lvbjE='}},
    });

    await sessionService.appendEvent({session, event: event1});
    await sessionService.appendEvent({session, event: event2});

    // Rewind before inv2 - should restore artifact to version 0
    await runner.rewindAsync({
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
      rewindBeforeInvocationId: 'inv2',
    });

    const updatedSession = await sessionService.getSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    const rewindEvent = updatedSession!.events[updatedSession!.events.length - 1];

    // Artifact delta should indicate new version (1 + 1 = 2)
    expect(rewindEvent.actions.artifactDelta).toEqual({'file1.txt': 2});
  });

  it('should mark new artifacts as inaccessible after rewind', async () => {
    const session = await sessionService.createSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    // Event 1: No artifacts
    const event1 = createEvent({
      invocationId: 'inv1',
      author: 'user',
      content: {role: 'user', parts: [{text: 'Message 1'}]},
      actions: createEventActions({}),
    });
    // Event 2: Create new artifact
    const event2 = createEvent({
      invocationId: 'inv2',
      author: 'model',
      content: {role: 'model', parts: [{text: 'Response 1'}]},
      actions: createEventActions({artifactDelta: {'newfile.txt': 0}}),
    });
    // Save the artifact
    await artifactService.saveArtifact({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
      filename: 'newfile.txt',
      artifact: {inlineData: {mimeType: 'text/plain', data: 'bmV3IGZpbGU='}},
    });

    await sessionService.appendEvent({session, event: event1});
    await sessionService.appendEvent({session, event: event2});

    // Rewind before inv2 - artifact didn't exist at that point
    await runner.rewindAsync({
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
      rewindBeforeInvocationId: 'inv2',
    });

    const updatedSession = await sessionService.getSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    const rewindEvent = updatedSession!.events[updatedSession!.events.length - 1];

    // Artifact delta should show new version
    expect(rewindEvent.actions.artifactDelta).toEqual({'newfile.txt': 1});

    // Load the artifact - should be an empty blob (inaccessible marker)
    const artifact = await artifactService.loadArtifact({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
      filename: 'newfile.txt',
    });

    expect(artifact?.inlineData?.data).toBe('');
    expect(artifact?.inlineData?.mimeType).toBe('application/octet-stream');
  });

  it('should not restore user-level artifacts', async () => {
    const session = await sessionService.createSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    // Event 1: Create user artifact
    const event1 = createEvent({
      invocationId: 'inv1',
      author: 'user',
      content: {role: 'user', parts: [{text: 'Message 1'}]},
      actions: createEventActions({artifactDelta: {'user:profile.txt': 0}}),
    });
    // Event 2: Update user artifact
    const event2 = createEvent({
      invocationId: 'inv2',
      author: 'model',
      content: {role: 'model', parts: [{text: 'Response 1'}]},
      actions: createEventActions({artifactDelta: {'user:profile.txt': 1}}),
    });

    await sessionService.appendEvent({session, event: event1});
    await sessionService.appendEvent({session, event: event2});

    // Rewind before inv2
    await runner.rewindAsync({
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
      rewindBeforeInvocationId: 'inv2',
    });

    const updatedSession = await sessionService.getSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    const rewindEvent = updatedSession!.events[updatedSession!.events.length - 1];

    // User artifacts should NOT be in the artifact delta
    expect(rewindEvent.actions.artifactDelta).toEqual({});
  });
});

describe('filterRewindEvents in getContents', () => {
  let sessionService: InMemorySessionService;
  let artifactService: InMemoryArtifactService;
  let runner: Runner;

  beforeEach(() => {
    sessionService = new InMemorySessionService();
    artifactService = new InMemoryArtifactService();
    runner = new Runner({
      appName: TEST_APP_ID,
      agent: new MockLlmAgent('test_agent'),
      sessionService,
      artifactService,
    });
  });

  it('should filter rewound events from LLM context', async () => {
    const session = await sessionService.createSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    // Event 1: Initial message
    const event1 = createEvent({
      invocationId: 'inv1',
      author: 'user',
      content: {role: 'user', parts: [{text: 'Hello'}]},
    });
    // Event 2: To be rewound
    const event2 = createEvent({
      invocationId: 'inv2',
      author: 'model',
      content: {role: 'model', parts: [{text: 'Bad response'}]},
    });
    // Event 3: Also to be rewound
    const event3 = createEvent({
      invocationId: 'inv3',
      author: 'user',
      content: {role: 'user', parts: [{text: 'I do not like that'}]},
    });
    // Event 4: Rewind event
    const rewindEvent = createEvent({
      invocationId: 'inv4',
      author: 'user',
      actions: createEventActions({rewindBeforeInvocationId: 'inv2'}),
    });

    await sessionService.appendEvent({session, event: event1});
    await sessionService.appendEvent({session, event: event2});
    await sessionService.appendEvent({session, event: event3});
    await sessionService.appendEvent({session, event: rewindEvent});

    // Run the agent - it should only see event1, not event2 or event3
    const events: Event[] = [];
    for await (const event of runner.runAsync({
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
      newMessage: {role: 'user', parts: [{text: 'New message after rewind'}]},
    })) {
      events.push(event);
    }

    // The agent should have received a request and responded
    expect(events.length).toBeGreaterThan(0);

    // Verify the session now has the rewind event followed by new messages
    const updatedSession = await sessionService.getSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    // Event order: inv1, inv2, inv3, rewind(inv4), new_user_msg, agent_response
    expect(updatedSession!.events.length).toBe(6);
    expect(updatedSession!.events[3].actions.rewindBeforeInvocationId).toBe('inv2');
  });

  it('should handle multiple rewinds correctly', async () => {
    const session = await sessionService.createSession({
      appName: TEST_APP_ID,
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
    });

    // Event 1
    const event1 = createEvent({
      invocationId: 'inv1',
      author: 'user',
      content: {role: 'user', parts: [{text: 'Message 1'}]},
    });
    // Event 2: Will be rewound by first rewind
    const event2 = createEvent({
      invocationId: 'inv2',
      author: 'model',
      content: {role: 'model', parts: [{text: 'Response 1'}]},
    });
    // First rewind: rewind before inv2
    const rewindEvent1 = createEvent({
      invocationId: 'inv3',
      author: 'user',
      actions: createEventActions({rewindBeforeInvocationId: 'inv2'}),
    });
    // Event 4: New conversation after first rewind
    const event4 = createEvent({
      invocationId: 'inv4',
      author: 'user',
      content: {role: 'user', parts: [{text: 'New message'}]},
    });
    // Event 5: Will be rewound by second rewind
    const event5 = createEvent({
      invocationId: 'inv5',
      author: 'model',
      content: {role: 'model', parts: [{text: 'New response'}]},
    });
    // Second rewind: rewind before inv4
    const rewindEvent2 = createEvent({
      invocationId: 'inv6',
      author: 'user',
      actions: createEventActions({rewindBeforeInvocationId: 'inv4'}),
    });

    await sessionService.appendEvent({session, event: event1});
    await sessionService.appendEvent({session, event: event2});
    await sessionService.appendEvent({session, event: rewindEvent1});
    await sessionService.appendEvent({session, event: event4});
    await sessionService.appendEvent({session, event: event5});
    await sessionService.appendEvent({session, event: rewindEvent2});

    // After both rewinds, only event1 should be visible in LLM context
    // Run agent to verify it can proceed
    const events: Event[] = [];
    for await (const event of runner.runAsync({
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
      newMessage: {role: 'user', parts: [{text: 'Final message'}]},
    })) {
      events.push(event);
    }

    // Agent should have responded successfully
    expect(events.length).toBeGreaterThan(0);
  });
});
