/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Event} from '../../src/events/event.js';
import {VertexAiRagMemoryService} from '../../src/memory/vertex_ai_rag_memory_service.js';
import {Session} from '../../src/sessions/session.js';

// Mock google-auth-library before any imports
vi.mock('google-auth-library', () => ({
  GoogleAuth: class {
    async getClient() {
      return {
        getAccessToken: async () => ({token: 'mock-access-token'}),
      };
    }
  },
}));

const MOCK_APP_NAME = 'test-app';
const MOCK_USER_ID = 'test-user';
const MOCK_SESSION_ID = 'test-session-123';

function createSession(
  appName: string,
  userId: string,
  sessionId: string,
  events: Event[]
): Session {
  return {
    id: sessionId,
    appName,
    userId,
    events,
    lastUpdateTime: Date.now(),
    state: {},
  };
}

function createEvent(
  id: string,
  invocationId: string,
  author: string,
  timestamp: number,
  content?: {
    role: 'user' | 'model';
    parts?: Array<{text?: string; functionCall?: unknown}>;
  }
): Event {
  return {
    id,
    invocationId,
    author,
    timestamp,
    content,
    actions: {},
  } as Event;
}

const MOCK_SESSION: Session = createSession(
  MOCK_APP_NAME,
  MOCK_USER_ID,
  MOCK_SESSION_ID,
  [
    createEvent('e1', 'inv1', 'user', 1000, {
      role: 'user',
      parts: [{text: 'Hello, how are you?'}],
    }),
    createEvent('e2', 'inv1', 'agent', 2000, {
      role: 'model',
      parts: [{text: 'I am fine, thank you!'}],
    }),
    createEvent('e3', 'inv2', 'user', 3000, {
      role: 'user',
      parts: [{text: 'Tell me a joke'}],
    }),
  ]
);

const MOCK_SESSION_WITH_EMPTY_EVENTS: Session = createSession(
  MOCK_APP_NAME,
  MOCK_USER_ID,
  MOCK_SESSION_ID,
  [
    // Empty event - no content
    createEvent('e1', 'inv1', 'user', 1000),
    // Event with empty parts
    createEvent('e2', 'inv2', 'user', 2000, {
      role: 'user',
      parts: [],
    }),
    // Event with only function call (no text)
    createEvent('e3', 'inv3', 'agent', 3000, {
      role: 'model',
      parts: [{functionCall: {name: 'test_func'}}],
    }),
  ]
);

// Store original fetch and env
const originalFetch = global.fetch;
const originalEnv = {...process.env};

describe('VertexAiRagMemoryService', () => {
  beforeEach(() => {
    // Reset environment variables before each test
    process.env['GOOGLE_CLOUD_PROJECT'] = 'test-project';
    delete process.env['GCLOUD_PROJECT'];
    delete process.env['GCP_PROJECT'];
  });

  afterEach(() => {
    // Restore original environment and fetch
    process.env = {...originalEnv};
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create service with ragCorpus', () => {
      const service = new VertexAiRagMemoryService({
        ragCorpus: 'projects/my-project/locations/us-central1/ragCorpora/my-corpus',
      });

      expect(service).toBeDefined();
    });

    it('should create service with just ragCorpus ID', () => {
      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus-id',
        project: 'my-project',
      });

      expect(service).toBeDefined();
    });

    it('should set default vectorDistanceThreshold to 10', () => {
      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
      });

      expect(service).toBeDefined();
    });

    it('should accept custom similarityTopK', () => {
      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        similarityTopK: 5,
      });

      expect(service).toBeDefined();
    });

    it('should accept custom location', () => {
      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        location: 'europe-west1',
      });

      expect(service).toBeDefined();
    });
  });

  describe('addSessionToMemory', () => {
    it('should throw error when RAG corpus is not set', async () => {
      const service = new VertexAiRagMemoryService({});

      await expect(service.addSessionToMemory(MOCK_SESSION)).rejects.toThrow(
        'RAG resources not set. Provide ragCorpus in constructor options.'
      );
    });

    it('should skip events with no text content', async () => {
      let uploadCalled = false;

      global.fetch = vi.fn(async () => {
        uploadCalled = true;
        return new Response('{}', {status: 200});
      }) as unknown as typeof fetch;

      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        project: 'test-project',
      });

      await service.addSessionToMemory(MOCK_SESSION_WITH_EMPTY_EVENTS);

      // Since no events have text content, upload should not be called
      expect(uploadCalled).toBe(false);
    });

    it('should call RAG upload API for valid session', async () => {
      let capturedUrl: string | undefined;
      let capturedBody: Record<string, unknown> | undefined;

      global.fetch = vi.fn(async (url: string, options?: RequestInit) => {
        capturedUrl = url;
        capturedBody = options?.body
          ? JSON.parse(options.body as string)
          : undefined;
        return new Response('{}', {status: 200});
      }) as unknown as typeof fetch;

      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        project: 'test-project',
      });

      await service.addSessionToMemory(MOCK_SESSION);

      expect(capturedUrl).toContain('ragFiles:import');
      expect(capturedBody).toBeDefined();
      expect(capturedBody?.inlineSource?.ragFileInputs?.[0]?.displayName).toBe(
        `${MOCK_APP_NAME}.${MOCK_USER_ID}.${MOCK_SESSION_ID}`
      );
    });
  });

  describe('searchMemory', () => {
    it('should throw error when RAG corpus is not set', async () => {
      const service = new VertexAiRagMemoryService({});

      await expect(
        service.searchMemory({
          appName: MOCK_APP_NAME,
          userId: MOCK_USER_ID,
          query: 'test query',
        })
      ).rejects.toThrow(
        'RAG resources not set. Provide ragCorpus in constructor options.'
      );
    });

    it('should return memories matching user prefix', async () => {
      const mockContexts = [
        {
          sourceDisplayName: `${MOCK_APP_NAME}.${MOCK_USER_ID}.session1`,
          text: '{"author":"user","timestamp":"2024-01-01T00:00:00.000Z","text":"Hello"}',
        },
        {
          // Different user, should be filtered out
          sourceDisplayName: `${MOCK_APP_NAME}.other-user.session1`,
          text: '{"author":"user","timestamp":"2024-01-01T00:00:00.000Z","text":"Hi"}',
        },
      ];

      global.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({contexts: {contexts: mockContexts}}),
          {status: 200}
        );
      }) as unknown as typeof fetch;

      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        project: 'test-project',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'test query',
      });

      // Should only return the matching user's memory
      expect(result.memories.length).toBe(1);
      expect(result.memories[0].content.parts?.[0]).toEqual({text: 'Hello'});
    });

    it('should parse JSON lines from context text', async () => {
      const jsonLines = [
        '{"author":"user","timestamp":"2024-01-01T00:00:00.000Z","text":"First message"}',
        '{"author":"agent","timestamp":"2024-01-01T00:01:00.000Z","text":"Second message"}',
      ].join('\n');

      const mockContexts = [
        {
          sourceDisplayName: `${MOCK_APP_NAME}.${MOCK_USER_ID}.session1`,
          text: jsonLines,
        },
      ];

      global.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({contexts: {contexts: mockContexts}}),
          {status: 200}
        );
      }) as unknown as typeof fetch;

      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        project: 'test-project',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'test',
      });

      expect(result.memories.length).toBe(2);
      expect(result.memories[0].content.parts?.[0]).toEqual({
        text: 'First message',
      });
      expect(result.memories[1].content.parts?.[0]).toEqual({
        text: 'Second message',
      });
    });

    it('should sort events by timestamp', async () => {
      // Events are out of order
      const jsonLines = [
        '{"author":"user","timestamp":"2024-01-01T00:02:00.000Z","text":"Third"}',
        '{"author":"user","timestamp":"2024-01-01T00:00:00.000Z","text":"First"}',
        '{"author":"user","timestamp":"2024-01-01T00:01:00.000Z","text":"Second"}',
      ].join('\n');

      const mockContexts = [
        {
          sourceDisplayName: `${MOCK_APP_NAME}.${MOCK_USER_ID}.session1`,
          text: jsonLines,
        },
      ];

      global.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({contexts: {contexts: mockContexts}}),
          {status: 200}
        );
      }) as unknown as typeof fetch;

      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        project: 'test-project',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'test',
      });

      // Events should be sorted by timestamp
      expect(result.memories[0].content.parts?.[0]).toEqual({text: 'First'});
      expect(result.memories[1].content.parts?.[0]).toEqual({text: 'Second'});
      expect(result.memories[2].content.parts?.[0]).toEqual({text: 'Third'});
    });

    it('should return empty array when no contexts match', async () => {
      global.fetch = vi.fn(async () => {
        return new Response(JSON.stringify({contexts: {contexts: []}}), {
          status: 200,
        });
      }) as unknown as typeof fetch;

      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        project: 'test-project',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'test',
      });

      expect(result.memories.length).toBe(0);
    });

    it('should handle missing contexts in response', async () => {
      global.fetch = vi.fn(async () => {
        return new Response(JSON.stringify({}), {status: 200});
      }) as unknown as typeof fetch;

      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        project: 'test-project',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'test',
      });

      expect(result.memories.length).toBe(0);
    });
  });

  describe('mergeEventLists', () => {
    it('should merge event lists from different sessions with overlapping timestamps', async () => {
      // Two contexts from DIFFERENT sessions with overlapping timestamps
      const mockContexts = [
        {
          sourceDisplayName: `${MOCK_APP_NAME}.${MOCK_USER_ID}.session1`,
          text: [
            '{"author":"user","timestamp":"2024-01-01T00:00:00.000Z","text":"Event A"}',
            '{"author":"user","timestamp":"2024-01-01T00:01:00.000Z","text":"Event B"}',
          ].join('\n'),
        },
        {
          // Different session with overlapping timestamp (same B timestamp)
          sourceDisplayName: `${MOCK_APP_NAME}.${MOCK_USER_ID}.session2`,
          text: [
            '{"author":"user","timestamp":"2024-01-01T00:01:00.000Z","text":"Event B from session2"}',
            '{"author":"user","timestamp":"2024-01-01T00:02:00.000Z","text":"Event C"}',
          ].join('\n'),
        },
      ];

      global.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({contexts: {contexts: mockContexts}}),
          {status: 200}
        );
      }) as unknown as typeof fetch;

      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        project: 'test-project',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'test',
      });

      // Events from different sessions with overlapping timestamps get merged.
      // Final merged list has 3 unique timestamps
      expect(result.memories.length).toBe(3);
    });

    it('should combine events from same session into single list', async () => {
      // Two contexts from the SAME session
      const mockContexts = [
        {
          sourceDisplayName: `${MOCK_APP_NAME}.${MOCK_USER_ID}.session1`,
          text: '{"author":"user","timestamp":"2024-01-01T00:00:00.000Z","text":"Event A"}',
        },
        {
          sourceDisplayName: `${MOCK_APP_NAME}.${MOCK_USER_ID}.session1`,
          text: '{"author":"user","timestamp":"2024-01-01T00:01:00.000Z","text":"Event B"}',
        },
      ];

      global.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({contexts: {contexts: mockContexts}}),
          {status: 200}
        );
      }) as unknown as typeof fetch;

      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        project: 'test-project',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'test',
      });

      // Both events from same session should be included
      expect(result.memories.length).toBe(2);
    });

    it('should keep separate lists for non-overlapping sessions', async () => {
      const mockContexts = [
        {
          sourceDisplayName: `${MOCK_APP_NAME}.${MOCK_USER_ID}.session1`,
          text: '{"author":"user","timestamp":"2024-01-01T00:00:00.000Z","text":"Session 1"}',
        },
        {
          sourceDisplayName: `${MOCK_APP_NAME}.${MOCK_USER_ID}.session2`,
          text: '{"author":"user","timestamp":"2024-01-02T00:00:00.000Z","text":"Session 2"}',
        },
      ];

      global.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({contexts: {contexts: mockContexts}}),
          {status: 200}
        );
      }) as unknown as typeof fetch;

      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        project: 'test-project',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'test',
      });

      // Should have both events since they're from different sessions (no overlap)
      expect(result.memories.length).toBe(2);
    });
  });

  describe('error handling', () => {
    it('should throw error on RAG API failure', async () => {
      global.fetch = vi.fn(async () => {
        return new Response('Permission denied', {status: 403});
      }) as unknown as typeof fetch;

      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        project: 'test-project',
      });

      await expect(
        service.searchMemory({
          appName: MOCK_APP_NAME,
          userId: MOCK_USER_ID,
          query: 'test',
        })
      ).rejects.toThrow('RAG retrieval query failed: 403');
    });

    it('should handle JSON parse errors gracefully', async () => {
      // Include one valid and one invalid JSON line
      const mockContexts = [
        {
          sourceDisplayName: `${MOCK_APP_NAME}.${MOCK_USER_ID}.session1`,
          text: [
            '{"author":"user","timestamp":"2024-01-01T00:00:00.000Z","text":"Valid"}',
            'not valid json',
            '{"author":"user","timestamp":"2024-01-01T00:01:00.000Z","text":"Also valid"}',
          ].join('\n'),
        },
      ];

      global.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({contexts: {contexts: mockContexts}}),
          {status: 200}
        );
      }) as unknown as typeof fetch;

      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        project: 'test-project',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'test',
      });

      // Should still return valid events, skipping the invalid one
      expect(result.memories.length).toBe(2);
    });
  });

  describe('timestamp formatting', () => {
    it('should format timestamp to ISO string', async () => {
      const mockContexts = [
        {
          sourceDisplayName: `${MOCK_APP_NAME}.${MOCK_USER_ID}.session1`,
          text: '{"author":"user","timestamp":"2024-06-15T10:30:00.000Z","text":"Test"}',
        },
      ];

      global.fetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({contexts: {contexts: mockContexts}}),
          {status: 200}
        );
      }) as unknown as typeof fetch;

      const service = new VertexAiRagMemoryService({
        ragCorpus: 'my-corpus',
        project: 'test-project',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'test',
      });

      expect(result.memories[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
