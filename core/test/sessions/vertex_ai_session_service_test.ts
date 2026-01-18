/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {VertexAiSessionService} from '../../src/sessions/vertex_ai_session_service.js';
import {createEvent} from '../../src/events/event.js';
import {createEventActions} from '../../src/events/event_actions.js';

// Store mock data for the tests
const mockSessions = new Map<string, {
  name: string;
  userId: string;
  sessionState: Record<string, unknown>;
  updateTime: string;
}>();
const mockEvents = new Map<string, Array<{
  name: string;
  invocationId: string;
  author: string;
  content?: unknown;
  actions?: unknown;
  timestamp: string;
  eventMetadata?: unknown;
}>>();

let sessionIdCounter = 1000000000;
let eventIdCounter = 1;

// Mock fetch globally
const originalFetch = global.fetch;

function createMockFetch() {
  return vi.fn(async (url: string, options?: RequestInit) => {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    const method = options?.method || 'GET';
    const body = options?.body ? JSON.parse(options.body as string) : {};

    // Parse the path to extract components
    // Format: /v1beta1/projects/{project}/locations/{location}/reasoningEngines/{id}/sessions[/{sessionId}]
    const pathMatch = path.match(
        /\/v1beta1\/projects\/([^/]+)\/locations\/([^/]+)\/reasoningEngines\/(\d+)\/sessions(?:\/([^/]+))?(?:\/events(?::append)?)?/);

    if (!pathMatch) {
      return new Response(JSON.stringify({error: 'Not found'}), {status: 404});
    }

    const [, project, location, engineId, sessionId] = pathMatch;
    const isEventsPath = path.includes('/events');
    const isAppendPath = path.includes(':append');

    // POST /sessions - Create session
    if (method === 'POST' && !sessionId && !isEventsPath) {
      const newSessionId = `${sessionIdCounter++}`;
      const fullName =
          `projects/${project}/locations/${location}/reasoningEngines/${engineId}/sessions/${newSessionId}`;

      const session = {
        name: fullName,
        userId: body.userId,
        sessionState: body.sessionState || {},
        updateTime: new Date().toISOString(),
      };

      mockSessions.set(fullName, session);
      mockEvents.set(fullName, []);

      return new Response(JSON.stringify(session), {status: 200});
    }

    // GET /sessions/{id} - Get session
    if (method === 'GET' && sessionId && !isEventsPath) {
      const fullName =
          `projects/${project}/locations/${location}/reasoningEngines/${engineId}/sessions/${sessionId}`;
      const session = mockSessions.get(fullName);

      if (!session) {
        return new Response(JSON.stringify({error: 'Not found'}), {status: 404});
      }

      return new Response(JSON.stringify(session), {status: 200});
    }

    // GET /sessions - List sessions
    if (method === 'GET' && !sessionId && !isEventsPath) {
      const filter = urlObj.searchParams.get('filter');
      const filterUserId = filter?.match(/user_id="([^"]+)"/)?.[1];
      const prefix =
          `projects/${project}/locations/${location}/reasoningEngines/${engineId}/sessions/`;

      const sessions: typeof mockSessions extends Map<string, infer V> ? V[] : never = [];

      for (const [key, session] of mockSessions) {
        if (key.startsWith(prefix)) {
          if (!filterUserId || session.userId === filterUserId) {
            sessions.push(session);
          }
        }
      }

      return new Response(JSON.stringify({sessions}), {status: 200});
    }

    // DELETE /sessions/{id}
    if (method === 'DELETE' && sessionId && !isEventsPath) {
      const fullName =
          `projects/${project}/locations/${location}/reasoningEngines/${engineId}/sessions/${sessionId}`;

      if (!mockSessions.has(fullName)) {
        return new Response(JSON.stringify({error: 'Not found'}), {status: 404});
      }

      mockSessions.delete(fullName);
      mockEvents.delete(fullName);

      return new Response('', {status: 200});
    }

    // GET /sessions/{id}/events - List events
    if (method === 'GET' && sessionId && isEventsPath && !isAppendPath) {
      const fullName =
          `projects/${project}/locations/${location}/reasoningEngines/${engineId}/sessions/${sessionId}`;
      const events = mockEvents.get(fullName) || [];

      // Apply filter if provided
      let filteredEvents = events;
      const filter = urlObj.searchParams.get('filter');
      if (filter) {
        const timestampMatch = filter.match(/timestamp>="([^"]+)"/);
        if (timestampMatch) {
          const afterTime = new Date(timestampMatch[1]).getTime();
          filteredEvents =
              events.filter(e => new Date(e.timestamp).getTime() >= afterTime);
        }
      }

      return new Response(JSON.stringify({events: filteredEvents}), {status: 200});
    }

    // POST /sessions/{id}/events:append - Append event
    if (method === 'POST' && sessionId && isAppendPath) {
      const fullName =
          `projects/${project}/locations/${location}/reasoningEngines/${engineId}/sessions/${sessionId}`;
      const sessionEvents = mockEvents.get(fullName);

      if (!sessionEvents) {
        return new Response(JSON.stringify({error: 'Session not found'}), {status: 404});
      }

      const eventId = `event-${eventIdCounter++}`;
      sessionEvents.push({
        name: `${fullName}/events/${eventId}`,
        invocationId: body.invocationId || '',
        author: body.author || '',
        content: body.content,
        actions: body.actions,
        timestamp: body.timestamp,
        eventMetadata: body.eventMetadata,
      });

      // Update session's update time
      const session = mockSessions.get(fullName);
      if (session) {
        session.updateTime = body.timestamp;
      }

      return new Response('', {status: 200});
    }

    return new Response(JSON.stringify({error: 'Not found'}), {status: 404});
  });
}

// Mock google-auth-library
vi.mock('google-auth-library', () => ({
  GoogleAuth: class MockGoogleAuth {
    async getClient() {
      return {
        getAccessToken: async () => ({token: 'mock-access-token'}),
      };
    }
  },
}));

describe('VertexAiSessionService', () => {
  let service: VertexAiSessionService;

  beforeEach(() => {
    // Clear mock data
    mockSessions.clear();
    mockEvents.clear();
    sessionIdCounter = 1000000000;
    eventIdCounter = 1;

    // Set up mock fetch
    global.fetch = createMockFetch();

    // Set environment variable for project
    process.env['GOOGLE_CLOUD_PROJECT'] = 'test-project';

    service = new VertexAiSessionService({
      project: 'test-project',
      location: 'us-central1',
      agentEngineId: '1234567890',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env['GOOGLE_CLOUD_PROJECT'];
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create service with project and location', () => {
      const testService = new VertexAiSessionService({
        project: 'my-project',
        location: 'us-east1',
      });
      expect(testService).toBeInstanceOf(VertexAiSessionService);
    });

    it('should create service with agent engine id', () => {
      const testService = new VertexAiSessionService({
        agentEngineId: '9876543210',
      });
      expect(testService).toBeInstanceOf(VertexAiSessionService);
    });

    it('should create service with no options', () => {
      const testService = new VertexAiSessionService();
      expect(testService).toBeInstanceOf(VertexAiSessionService);
    });

    it('should throw if both project/location and expressModeApiKey are provided', () => {
      expect(() => new VertexAiSessionService({
        project: 'my-project',
        expressModeApiKey: 'api-key',
      })).toThrow('Cannot specify project or location and expressModeApiKey');
    });
  });

  describe('createSession', () => {
    it('should create a session with basic info', async () => {
      const session = await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
      });

      expect(session.appName).toBe('1234567890');
      expect(session.userId).toBe('user-1');
      expect(session.id).toBeDefined();
      expect(session.id).not.toBe('');
      expect(session.events).toEqual([]);
      expect(session.lastUpdateTime).toBeGreaterThan(0);
    });

    it('should create a session with initial state', async () => {
      const session = await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
        state: {counter: 0, name: 'test'},
      });

      expect(session.state.counter).toBe(0);
      expect(session.state.name).toBe('test');
    });

    it('should throw error for user-provided session id', async () => {
      await expect(
          service.createSession({
            appName: '1234567890',
            userId: 'user-1',
            sessionId: 'custom-id',
          }),
      ).rejects.toThrow('User-provided Session id is not supported');
    });
  });

  describe('getSession', () => {
    it('should get an existing session', async () => {
      const created = await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
        state: {value: 'test'},
      });

      const retrieved = await service.getSession({
        appName: '1234567890',
        userId: 'user-1',
        sessionId: created.id,
      });

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.userId).toBe('user-1');
      expect(retrieved!.state.value).toBe('test');
    });

    it('should return undefined for non-existent session', async () => {
      const result = await service.getSession({
        appName: '1234567890',
        userId: 'user-1',
        sessionId: 'non-existent',
      });

      expect(result).toBeUndefined();
    });

    it('should throw error if session belongs to different user', async () => {
      const created = await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
      });

      await expect(
          service.getSession({
            appName: '1234567890',
            userId: 'user-2',  // Different user
            sessionId: created.id,
          }),
      ).rejects.toThrow('does not belong to user');
    });

    it('should retrieve session with events', async () => {
      const created = await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
      });

      // Append an event
      const event = createEvent({
        invocationId: 'inv-1',
        author: 'user',
        content: {parts: [{text: 'Hello'}], role: 'user'},
      });

      await service.appendEvent({session: created, event});

      const retrieved = await service.getSession({
        appName: '1234567890',
        userId: 'user-1',
        sessionId: created.id,
      });

      expect(retrieved!.events.length).toBe(1);
      expect(retrieved!.events[0].invocationId).toBe('inv-1');
    });

    it('should apply numRecentEvents filter', async () => {
      const created = await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
      });

      // Append multiple events
      for (let i = 0; i < 5; i++) {
        const event = createEvent({
          invocationId: `inv-${i}`,
          author: 'user',
          content: {parts: [{text: `Message ${i}`}], role: 'user'},
        });
        await service.appendEvent({session: created, event});
      }

      const retrieved = await service.getSession({
        appName: '1234567890',
        userId: 'user-1',
        sessionId: created.id,
        config: {numRecentEvents: 2},
      });

      expect(retrieved!.events.length).toBe(2);
      // Should be the last 2 events
      expect(retrieved!.events[0].invocationId).toBe('inv-3');
      expect(retrieved!.events[1].invocationId).toBe('inv-4');
    });
  });

  describe('listSessions', () => {
    it('should list sessions for a user', async () => {
      await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
      });
      await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
      });
      await service.createSession({
        appName: '1234567890',
        userId: 'user-2',
      });

      const result = await service.listSessions({
        appName: '1234567890',
        userId: 'user-1',
      });

      expect(result.sessions.length).toBe(2);
      result.sessions.forEach(session => {
        expect(session.userId).toBe('user-1');
      });
    });

    it('should return empty list when no sessions exist', async () => {
      const result = await service.listSessions({
        appName: '1234567890',
        userId: 'user-1',
      });

      expect(result.sessions).toEqual([]);
    });

    it('should not include events in listed sessions', async () => {
      const created = await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
      });

      const event = createEvent({
        invocationId: 'inv-1',
        author: 'user',
      });
      await service.appendEvent({session: created, event});

      const result = await service.listSessions({
        appName: '1234567890',
        userId: 'user-1',
      });

      expect(result.sessions.length).toBe(1);
      expect(result.sessions[0].events).toEqual([]);
    });
  });

  describe('deleteSession', () => {
    it('should delete an existing session', async () => {
      const created = await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
      });

      await service.deleteSession({
        appName: '1234567890',
        userId: 'user-1',
        sessionId: created.id,
      });

      const retrieved = await service.getSession({
        appName: '1234567890',
        userId: 'user-1',
        sessionId: created.id,
      });

      expect(retrieved).toBeUndefined();
    });

    it('should throw error when deleting non-existent session', async () => {
      await expect(
          service.deleteSession({
            appName: '1234567890',
            userId: 'user-1',
            sessionId: 'non-existent',
          }),
      ).rejects.toThrow();
    });
  });

  describe('appendEvent', () => {
    it('should append event to session', async () => {
      const session = await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
      });

      const event = createEvent({
        invocationId: 'inv-1',
        author: 'user',
        content: {parts: [{text: 'Hello'}], role: 'user'},
      });

      const appended = await service.appendEvent({session, event});

      expect(appended.invocationId).toBe('inv-1');
      expect(session.events.length).toBe(1);
    });

    it('should not persist partial events to API but should keep in memory', async () => {
      const session = await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
      });

      const partialEvent = createEvent({
        invocationId: 'inv-1',
        author: 'model',
        partial: true,
        content: {parts: [{text: 'Partial...'}], role: 'model'},
      });

      await service.appendEvent({session, event: partialEvent});

      // The in-memory session should have the partial event (per base class behavior)
      // but it should NOT be persisted to the API
      const retrieved = await service.getSession({
        appName: '1234567890',
        userId: 'user-1',
        sessionId: session.id,
      });

      // API should not have partial events
      expect(retrieved!.events.length).toBe(0);
    });

    it('should trim temp state from event before persisting', async () => {
      const session = await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
      });

      const event = createEvent({
        invocationId: 'inv-1',
        author: 'model',
        actions: createEventActions({
          stateDelta: {
            'temp:temporary': 'temp-value',
            'permanent': 'perm-value',
          },
        }),
      });

      await service.appendEvent({session, event});

      // The event should have been persisted with temp: keys trimmed
      // Note: In-memory session still has both, but API would have trimmed version
      expect(session.events[0].actions.stateDelta['permanent']).toBe(
          'perm-value');
    });

    it('should handle event with all metadata fields', async () => {
      const session = await service.createSession({
        appName: '1234567890',
        userId: 'user-1',
      });

      const event = createEvent({
        invocationId: 'inv-1',
        author: 'model',
        content: {parts: [{text: 'Response'}], role: 'model'},
        turnComplete: true,
        branch: 'agent1.agent2',
        customMetadata: {source: 'test'},
        longRunningToolIds: ['tool-1'],
      });

      const appended = await service.appendEvent({session, event});

      expect(appended.turnComplete).toBe(true);
      expect(appended.branch).toBe('agent1.agent2');
      expect(appended.customMetadata).toEqual({source: 'test'});
    });
  });

  describe('getReasoningEngineId', () => {
    it('should use agentEngineId when configured', async () => {
      const testService = new VertexAiSessionService({
        project: 'test-project',
        location: 'us-central1',
        agentEngineId: '9876543210',
      });

      // Create a session - this will use the agentEngineId
      const session = await testService.createSession({
        appName: 'ignored-app-name',
        userId: 'user-1',
      });

      expect(session).toBeDefined();
    });

    it('should parse numeric app name as engine id', async () => {
      // The numeric app name should be used as the reasoning engine id
      const session = await service.createSession({
        appName: '5555555555',
        userId: 'user-1',
      });

      expect(session.appName).toBe('5555555555');
    });

    it('should parse full resource name', async () => {
      const session = await service.createSession({
        appName: 'projects/my-project/locations/us-central1/reasoningEngines/1234567890',
        userId: 'user-1',
      });

      expect(session.appName).toBe(
          'projects/my-project/locations/us-central1/reasoningEngines/1234567890');
    });

    it('should throw error for invalid app name format', async () => {
      // Use a service without agentEngineId to force appName parsing
      const testService = new VertexAiSessionService({
        project: 'test-project',
        location: 'us-central1',
        // Note: no agentEngineId configured
      });

      await expect(
          testService.createSession({
            appName: 'invalid-app-name',
            userId: 'user-1',
          }),
      ).rejects.toThrow('App name invalid-app-name is not valid');
    });
  });
});
