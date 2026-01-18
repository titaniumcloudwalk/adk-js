/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {createEvent, Event} from '../../src/events/event.js';
import {AlreadyExistsError} from '../../src/errors/already_exists_error.js';
import {DatabaseSessionService} from '../../src/sessions/database_session_service.js';
import {Session} from '../../src/sessions/session.js';

describe('DatabaseSessionService', () => {
  let service: DatabaseSessionService;

  beforeEach(async () => {
    // Use in-memory SQLite for tests
    service = new DatabaseSessionService({dbUrl: 'sqlite://:memory:'});
    await service.initialize();
  });

  afterEach(async () => {
    await service.close();
  });

  describe('initialization', () => {
    it('should initialize without error', async () => {
      const testService = new DatabaseSessionService({dbUrl: 'sqlite://:memory:'});
      await expect(testService.initialize()).resolves.not.toThrow();
      await testService.close();
    });

    it('should throw error for invalid URL format', async () => {
      const testService = new DatabaseSessionService({dbUrl: 'invalid://database'});
      await expect(testService.initialize()).rejects.toThrow('Invalid database URL format');
    });

    it('should allow multiple initialize calls', async () => {
      await expect(service.initialize()).resolves.not.toThrow();
      await expect(service.initialize()).resolves.not.toThrow();
    });

    it('should throw error if operating without initialization', async () => {
      const uninitializedService = new DatabaseSessionService({dbUrl: 'sqlite://:memory:'});
      await expect(uninitializedService.createSession({
        appName: 'test-app',
        userId: 'user-1',
      })).rejects.toThrow('not initialized');
    });
  });

  describe('createSession', () => {
    it('should create a session with basic info', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
      });

      expect(session.appName).toBe('test-app');
      expect(session.userId).toBe('user-1');
      expect(session.id).toBeDefined();
      expect(session.events).toEqual([]);
      expect(session.lastUpdateTime).toBeGreaterThan(0);
    });

    it('should create a session with custom id', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'custom-session-id',
      });

      expect(session.id).toBe('custom-session-id');
    });

    it('should create a session with initial state', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        state: {counter: 0, name: 'test'},
      });

      expect(session.state.counter).toBe(0);
      expect(session.state.name).toBe('test');
    });

    it('should throw AlreadyExistsError for duplicate session id', async () => {
      await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'duplicate-id',
      });

      await expect(service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'duplicate-id',
      })).rejects.toThrow(AlreadyExistsError);
    });

    it('should handle app-level state correctly', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        state: {'app:config': 'app-value'},
      });

      expect(session.state['app:config']).toBe('app-value');

      // Create another session for a different user and verify app state is shared
      const session2 = await service.createSession({
        appName: 'test-app',
        userId: 'user-2',
      });

      expect(session2.state['app:config']).toBe('app-value');
    });

    it('should handle user-level state correctly', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        state: {'user:preference': 'user-value'},
      });

      expect(session.state['user:preference']).toBe('user-value');

      // Create another session for same user and verify user state is shared
      const session2 = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'session-2',
      });

      expect(session2.state['user:preference']).toBe('user-value');
    });

    it('should not persist temp state', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        state: {'temp:temporary': 'temp-value', 'permanent': 'perm-value'},
      });

      // temp: keys are not persisted but may be in initial creation
      // Retrieve from storage to verify
      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: session.id,
      });

      expect(retrieved?.state['permanent']).toBe('perm-value');
      expect(retrieved?.state['temp:temporary']).toBeUndefined();
    });
  });

  describe('getSession', () => {
    it('should retrieve an existing session', async () => {
      const created = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'session-1',
        state: {counter: 42},
      });

      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'session-1',
      });

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.appName).toBe(created.appName);
      expect(retrieved?.userId).toBe(created.userId);
      expect(retrieved?.state.counter).toBe(42);
    });

    it('should return undefined for non-existent session', async () => {
      const session = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'non-existent',
      });

      expect(session).toBeUndefined();
    });

    it('should include events in retrieved session', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
      });

      const event = createEvent({
        invocationId: 'inv-1',
        author: 'user',
      });
      await service.appendEvent({session, event});

      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: session.id,
      });

      expect(retrieved?.events).toHaveLength(1);
      expect(retrieved?.events[0].invocationId).toBe('inv-1');
    });

    it('should limit recent events when numRecentEvents is specified', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
      });

      // Add 5 events
      for (let i = 0; i < 5; i++) {
        const event = createEvent({
          invocationId: `inv-${i}`,
          timestamp: Date.now() + i * 1000,
        });
        await service.appendEvent({session, event});
      }

      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: session.id,
        config: {numRecentEvents: 3},
      });

      expect(retrieved?.events).toHaveLength(3);
    });

    it('should filter events by afterTimestamp', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
      });

      const baseTime = Date.now();

      // Add events at different timestamps
      for (let i = 0; i < 5; i++) {
        const event = createEvent({
          invocationId: `inv-${i}`,
          timestamp: baseTime + i * 1000,
        });
        await service.appendEvent({session, event});
      }

      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: session.id,
        config: {afterTimestamp: baseTime + 2500}, // Should get events 3, 4
      });

      expect(retrieved?.events).toHaveLength(2);
    });
  });

  describe('listSessions', () => {
    it('should return empty array when no sessions exist', async () => {
      const response = await service.listSessions({
        appName: 'test-app',
        userId: 'user-1',
      });

      expect(response.sessions).toEqual([]);
    });

    it('should list all sessions for a user', async () => {
      await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'session-1',
      });

      await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'session-2',
      });

      const response = await service.listSessions({
        appName: 'test-app',
        userId: 'user-1',
      });

      expect(response.sessions).toHaveLength(2);
      expect(response.sessions.map(s => s.id).sort()).toEqual(['session-1', 'session-2']);
    });

    it('should not return sessions from different users', async () => {
      await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'session-1',
      });

      await service.createSession({
        appName: 'test-app',
        userId: 'user-2',
        sessionId: 'session-2',
      });

      const response = await service.listSessions({
        appName: 'test-app',
        userId: 'user-1',
      });

      expect(response.sessions).toHaveLength(1);
      expect(response.sessions[0].id).toBe('session-1');
    });

    it('should include merged state in listed sessions', async () => {
      await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        state: {'app:config': 'app-value', 'user:pref': 'user-value', 'counter': 1},
      });

      const response = await service.listSessions({
        appName: 'test-app',
        userId: 'user-1',
      });

      expect(response.sessions[0].state['app:config']).toBe('app-value');
      expect(response.sessions[0].state['user:pref']).toBe('user-value');
      expect(response.sessions[0].state['counter']).toBe(1);
    });
  });

  describe('deleteSession', () => {
    it('should delete an existing session', async () => {
      await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'session-to-delete',
      });

      await service.deleteSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'session-to-delete',
      });

      const session = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'session-to-delete',
      });

      expect(session).toBeUndefined();
    });

    it('should not throw when deleting non-existent session', async () => {
      await expect(service.deleteSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'non-existent',
      })).resolves.not.toThrow();
    });

    it('should cascade delete events', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
      });

      const event = createEvent({invocationId: 'inv-1'});
      await service.appendEvent({session, event});

      await service.deleteSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: session.id,
      });

      // Session should be gone
      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: session.id,
      });

      expect(retrieved).toBeUndefined();
    });
  });

  describe('appendEvent', () => {
    it('should append event to session', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
      });

      const event = createEvent({
        invocationId: 'inv-1',
        author: 'user',
      });

      const appended = await service.appendEvent({session, event});

      expect(appended.id).toBe(event.id);

      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: session.id,
      });

      expect(retrieved?.events).toHaveLength(1);
      expect(retrieved?.events[0].id).toBe(event.id);
    });

    it('should skip partial events', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
      });

      const event = createEvent({
        invocationId: 'inv-1',
        partial: true,
      });

      await service.appendEvent({session, event});

      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: session.id,
      });

      expect(retrieved?.events).toHaveLength(0);
    });

    it('should update session state from event state delta', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        state: {counter: 0},
      });

      const event = createEvent({
        invocationId: 'inv-1',
        actions: {
          stateDelta: {counter: 5, newKey: 'newValue'},
          artifactDelta: {},
          requestedAuthConfigs: {},
          requestedToolConfirmations: {},
        },
      });

      await service.appendEvent({session, event});

      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: session.id,
      });

      expect(retrieved?.state.counter).toBe(5);
      expect(retrieved?.state.newKey).toBe('newValue');
    });

    it('should update app state from event state delta', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
      });

      const event = createEvent({
        invocationId: 'inv-1',
        actions: {
          stateDelta: {'app:globalConfig': 'updated'},
          artifactDelta: {},
          requestedAuthConfigs: {},
          requestedToolConfirmations: {},
        },
      });

      await service.appendEvent({session, event});

      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: session.id,
      });

      expect(retrieved?.state['app:globalConfig']).toBe('updated');
    });

    it('should update user state from event state delta', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
      });

      const event = createEvent({
        invocationId: 'inv-1',
        actions: {
          stateDelta: {'user:preference': 'dark-mode'},
          artifactDelta: {},
          requestedAuthConfigs: {},
          requestedToolConfirmations: {},
        },
      });

      await service.appendEvent({session, event});

      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: session.id,
      });

      expect(retrieved?.state['user:preference']).toBe('dark-mode');
    });

    it('should not persist temp state from events', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
      });

      const event = createEvent({
        invocationId: 'inv-1',
        actions: {
          stateDelta: {'temp:scratch': 'temp-value', 'permanent': 'perm-value'},
          artifactDelta: {},
          requestedAuthConfigs: {},
          requestedToolConfirmations: {},
        },
      });

      await service.appendEvent({session, event});

      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: session.id,
      });

      expect(retrieved?.state['permanent']).toBe('perm-value');
      expect(retrieved?.state['temp:scratch']).toBeUndefined();
    });

    it('should update lastUpdateTime', async () => {
      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
      });

      const originalUpdateTime = session.lastUpdateTime;

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      const event = createEvent({
        invocationId: 'inv-1',
        timestamp: Date.now(),
      });

      await service.appendEvent({session, event});

      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: session.id,
      });

      expect(retrieved?.lastUpdateTime).toBeGreaterThan(originalUpdateTime);
    });

    it('should throw error for non-existent session', async () => {
      const fakeSession: Session = {
        id: 'non-existent',
        appName: 'test-app',
        userId: 'user-1',
        state: {},
        events: [],
        lastUpdateTime: Date.now(),
      };

      const event = createEvent({invocationId: 'inv-1'});

      await expect(service.appendEvent({
        session: fakeSession,
        event,
      })).rejects.toThrow('not found');
    });
  });

  describe('state sharing across sessions', () => {
    it('should share app state across all sessions', async () => {
      // User 1 creates session with app state
      const session1 = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        state: {'app:sharedConfig': 'initial'},
      });

      // User 2 creates session and sees app state
      const session2 = await service.createSession({
        appName: 'test-app',
        userId: 'user-2',
      });

      expect(session2.state['app:sharedConfig']).toBe('initial');

      // User 1 updates app state via event
      const event = createEvent({
        invocationId: 'inv-1',
        actions: {
          stateDelta: {'app:sharedConfig': 'updated'},
          artifactDelta: {},
          requestedAuthConfigs: {},
          requestedToolConfirmations: {},
        },
      });
      await service.appendEvent({session: session1, event});

      // User 2 retrieves session and sees updated app state
      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-2',
        sessionId: session2.id,
      });

      expect(retrieved?.state['app:sharedConfig']).toBe('updated');
    });

    it('should share user state across sessions of same user', async () => {
      // Create first session with user state
      const session1 = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        state: {'user:theme': 'dark'},
      });

      // Create second session for same user
      const session2 = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'session-2',
      });

      expect(session2.state['user:theme']).toBe('dark');

      // Update user state via event in session 1
      const event = createEvent({
        invocationId: 'inv-1',
        actions: {
          stateDelta: {'user:theme': 'light'},
          artifactDelta: {},
          requestedAuthConfigs: {},
          requestedToolConfirmations: {},
        },
      });
      await service.appendEvent({session: session1, event});

      // Retrieve session 2 and verify updated user state
      const retrieved = await service.getSession({
        appName: 'test-app',
        userId: 'user-1',
        sessionId: 'session-2',
      });

      expect(retrieved?.state['user:theme']).toBe('light');
    });

    it('should not share user state across different users', async () => {
      // User 1 creates session with user state
      await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
        state: {'user:private': 'user-1-value'},
      });

      // User 2 creates session - should not see user 1's user state
      const session2 = await service.createSession({
        appName: 'test-app',
        userId: 'user-2',
      });

      expect(session2.state['user:private']).toBeUndefined();
    });
  });

  describe('close', () => {
    it('should close database connection', async () => {
      await service.close();

      // After close, operations should fail
      await expect(service.createSession({
        appName: 'test-app',
        userId: 'user-1',
      })).rejects.toThrow('not initialized');
    });

    it('should allow re-initialization after close', async () => {
      await service.close();
      await service.initialize();

      const session = await service.createSession({
        appName: 'test-app',
        userId: 'user-1',
      });

      expect(session.id).toBeDefined();
    });
  });
});

describe('session_util', () => {
  // Import utilities dynamically
  let extractStateDelta: typeof import('../../src/sessions/session_util.js').extractStateDelta;
  let mergeState: typeof import('../../src/sessions/session_util.js').mergeState;

  beforeAll(async () => {
    const utils = await import('../../src/sessions/session_util.js');
    extractStateDelta = utils.extractStateDelta;
    mergeState = utils.mergeState;
  });

  describe('extractStateDelta', () => {
    it('should extract app-level state', () => {
      const state = {'app:config': 'value1', 'other': 'value2'};
      const deltas = extractStateDelta(state);

      expect(deltas.app).toEqual({config: 'value1'});
      expect(deltas.session).toEqual({other: 'value2'});
    });

    it('should extract user-level state', () => {
      const state = {'user:pref': 'value1', 'other': 'value2'};
      const deltas = extractStateDelta(state);

      expect(deltas.user).toEqual({pref: 'value1'});
      expect(deltas.session).toEqual({other: 'value2'});
    });

    it('should ignore temp state', () => {
      const state = {'temp:scratch': 'value1', 'other': 'value2'};
      const deltas = extractStateDelta(state);

      expect(deltas.app).toEqual({});
      expect(deltas.user).toEqual({});
      expect(deltas.session).toEqual({other: 'value2'});
    });

    it('should handle undefined state', () => {
      const deltas = extractStateDelta(undefined);

      expect(deltas).toEqual({app: {}, user: {}, session: {}});
    });

    it('should handle mixed state', () => {
      const state = {
        'app:global': 'g1',
        'user:prefs': 'u1',
        'temp:scratch': 'temp',
        'local': 'l1',
      };
      const deltas = extractStateDelta(state);

      expect(deltas.app).toEqual({global: 'g1'});
      expect(deltas.user).toEqual({prefs: 'u1'});
      expect(deltas.session).toEqual({local: 'l1'});
    });
  });

  describe('mergeState', () => {
    it('should merge all state types with correct prefixes', () => {
      const appState = {config: 'app-value'};
      const userState = {pref: 'user-value'};
      const sessionState = {local: 'session-value'};

      const merged = mergeState(appState, userState, sessionState);

      expect(merged).toEqual({
        'app:config': 'app-value',
        'user:pref': 'user-value',
        'local': 'session-value',
      });
    });

    it('should handle empty states', () => {
      const merged = mergeState({}, {}, {});
      expect(merged).toEqual({});
    });

    it('should preserve session state as-is', () => {
      const merged = mergeState({}, {}, {key1: 'value1', key2: 42});
      expect(merged).toEqual({key1: 'value1', key2: 42});
    });
  });
});
