/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Event} from '../../src/events/event.js';
import {VertexAiMemoryBankService} from '../../src/memory/vertex_ai_memory_bank_service.js';
import {Session} from '../../src/sessions/session.js';

const MOCK_APP_NAME = 'test-app';
const MOCK_USER_ID = 'test-user';

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

const MOCK_SESSION: Session = createSession(MOCK_APP_NAME, MOCK_USER_ID, '333', [
  createEvent('444', '123', 'user', 12345, {
    role: 'user',
    parts: [{text: 'test_content'}],
  }),
  // Empty event, should be ignored
  createEvent('555', '456', 'user', 12345),
  // Function call event, should be ignored
  createEvent('666', '456', 'agent', 23456, {
    role: 'model',
    parts: [{functionCall: {name: 'test_function'}}],
  }),
]);

const MOCK_SESSION_WITH_EMPTY_EVENTS: Session = createSession(
  MOCK_APP_NAME,
  MOCK_USER_ID,
  '444',
  []
);

// Store original fetch and env
const originalFetch = global.fetch;
const originalEnv = {...process.env};

describe('VertexAiMemoryBankService', () => {
  beforeEach(() => {
    // Reset environment variables before each test
    delete process.env['GOOGLE_GENAI_USE_VERTEXAI'];
    delete process.env['GOOGLE_API_KEY'];
  });

  afterEach(() => {
    // Restore original environment and fetch
    process.env = {...originalEnv};
    global.fetch = originalFetch;
  });

  describe('constructor', () => {
    it('should create service with project and location', () => {
      const service = new VertexAiMemoryBankService({
        project: 'test-project',
        location: 'test-location',
        agentEngineId: '123',
      });

      expect(service).toBeDefined();
    });

    it('should throw error when project/location and expressModeApiKey are both specified', () => {
      expect(() => {
        new VertexAiMemoryBankService({
          project: 'test-project',
          location: 'test-location',
          expressModeApiKey: 'test-api-key',
        });
      }).toThrow(
        'Cannot specify project or location and expressModeApiKey. ' +
          'Either use project and location, or just the expressModeApiKey.'
      );
    });

    it('should create service with just expressModeApiKey when GOOGLE_GENAI_USE_VERTEXAI is true', () => {
      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';

      const service = new VertexAiMemoryBankService({
        expressModeApiKey: 'test-api-key',
        agentEngineId: '123',
      });

      expect(service).toBeDefined();
    });

    it('should create service with full resource path in agentEngineId (with warning)', () => {
      // The service should still be created even with a full resource path
      const service = new VertexAiMemoryBankService({
        project: 'test-project',
        agentEngineId: 'projects/p/locations/l/reasoningEngines/123',
      });

      expect(service).toBeDefined();
    });
  });

  describe('addSessionToMemory', () => {
    it('should throw error when agentEngineId is not set', async () => {
      const service = new VertexAiMemoryBankService({
        project: 'test-project',
        location: 'test-location',
      });

      await expect(service.addSessionToMemory(MOCK_SESSION)).rejects.toThrow(
        'Agent Engine ID is required for Memory Bank.'
      );
    });

    it('should filter out empty events', async () => {
      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';

      let capturedBody: Record<string, unknown> | undefined;

      global.fetch = vi.fn(async (_url: string, options?: RequestInit) => {
        capturedBody = options?.body
          ? JSON.parse(options.body as string)
          : undefined;
        return new Response('{}', {status: 200});
      }) as unknown as typeof fetch;

      const service = new VertexAiMemoryBankService({
        expressModeApiKey: 'test-api-key',
        agentEngineId: '123',
      });

      await service.addSessionToMemory(MOCK_SESSION);

      // Should only have 1 event (text content), not 3
      // Empty event and function call event should be filtered
      expect(capturedBody).toBeDefined();
      const events = (capturedBody?.direct_contents_source as {events: unknown[]})
        ?.events;
      expect(events?.length).toBe(1);
      expect((events?.[0] as {content: {parts: Array<{text: string}>}}).content.parts[0].text).toBe(
        'test_content'
      );
    });

    it('should not call API when session has no valid events', async () => {
      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';

      const mockFetch = vi.fn();
      global.fetch = mockFetch as unknown as typeof fetch;

      const service = new VertexAiMemoryBankService({
        expressModeApiKey: 'test-api-key',
        agentEngineId: '123',
      });

      await service.addSessionToMemory(MOCK_SESSION_WITH_EMPTY_EVENTS);

      // Verify fetch was NOT called since there are no events
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should send correct request structure', async () => {
      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';

      let capturedUrl: string | undefined;
      let capturedBody: Record<string, unknown> | undefined;

      global.fetch = vi.fn(async (url: string, options?: RequestInit) => {
        capturedUrl = url;
        capturedBody = options?.body
          ? JSON.parse(options.body as string)
          : undefined;
        return new Response('{}', {status: 200});
      }) as unknown as typeof fetch;

      const service = new VertexAiMemoryBankService({
        expressModeApiKey: 'test-api-key',
        agentEngineId: '123',
      });

      await service.addSessionToMemory(MOCK_SESSION);

      // Check URL contains correct path
      expect(capturedUrl).toContain('reasoningEngines/123:generateMemories');
      expect(capturedUrl).toContain('key=test-api-key');

      // Check body structure
      expect(capturedBody?.scope).toEqual({
        app_name: MOCK_APP_NAME,
        user_id: MOCK_USER_ID,
      });
      expect(capturedBody?.config).toEqual({wait_for_completion: false});
    });
  });

  describe('searchMemory', () => {
    it('should throw error when agentEngineId is not set', async () => {
      const service = new VertexAiMemoryBankService({
        project: 'test-project',
        location: 'test-location',
      });

      await expect(
        service.searchMemory({
          appName: MOCK_APP_NAME,
          userId: MOCK_USER_ID,
          query: 'test query',
        })
      ).rejects.toThrow('Agent Engine ID is required for Memory Bank.');
    });

    it('should return memories from API response', async () => {
      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';

      const mockResponse = {
        memories: [
          {
            memory: {
              fact: 'User prefers dark mode',
              updateTime: '2024-12-12T12:12:12.123456Z',
            },
          },
        ],
      };

      global.fetch = vi.fn(async () => {
        return new Response(JSON.stringify(mockResponse), {status: 200});
      }) as unknown as typeof fetch;

      const service = new VertexAiMemoryBankService({
        expressModeApiKey: 'test-api-key',
        agentEngineId: '123',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'preferences',
      });

      expect(result.memories.length).toBe(1);
      expect(result.memories[0].content.parts?.[0]).toEqual({
        text: 'User prefers dark mode',
      });
      expect(result.memories[0].author).toBe('user');
      expect(result.memories[0].timestamp).toBe('2024-12-12T12:12:12.123Z');
    });

    it('should return empty array when no memories found', async () => {
      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';

      global.fetch = vi.fn(async () => {
        return new Response(JSON.stringify({memories: []}), {status: 200});
      }) as unknown as typeof fetch;

      const service = new VertexAiMemoryBankService({
        expressModeApiKey: 'test-api-key',
        agentEngineId: '123',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'unknown topic',
      });

      expect(result.memories.length).toBe(0);
    });

    it('should send correct request structure', async () => {
      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';

      let capturedUrl: string | undefined;
      let capturedBody: Record<string, unknown> | undefined;

      global.fetch = vi.fn(async (url: string, options?: RequestInit) => {
        capturedUrl = url;
        capturedBody = options?.body
          ? JSON.parse(options.body as string)
          : undefined;
        return new Response(JSON.stringify({memories: []}), {status: 200});
      }) as unknown as typeof fetch;

      const service = new VertexAiMemoryBankService({
        expressModeApiKey: 'test-api-key',
        agentEngineId: '123',
      });

      await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'test query',
      });

      // Check URL
      expect(capturedUrl).toContain('reasoningEngines/123:retrieveMemories');
      expect(capturedUrl).toContain('key=test-api-key');

      // Check body
      expect(capturedBody?.scope).toEqual({
        app_name: MOCK_APP_NAME,
        user_id: MOCK_USER_ID,
      });
      expect(capturedBody?.similarity_search_params).toEqual({
        search_query: 'test query',
      });
    });
  });

  describe('timestamp formatting', () => {
    it('should handle ISO string timestamp from API', async () => {
      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';

      const mockResponse = {
        memories: [
          {
            memory: {
              fact: 'test fact',
              updateTime: '2024-12-12T12:12:12.000Z',
            },
          },
        ],
      };

      global.fetch = vi.fn(async () => {
        return new Response(JSON.stringify(mockResponse), {status: 200});
      }) as unknown as typeof fetch;

      const service = new VertexAiMemoryBankService({
        expressModeApiKey: 'test-api-key',
        agentEngineId: '123',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'test',
      });

      // The timestamp should be formatted as ISO 8601
      expect(result.memories[0].timestamp).toBe('2024-12-12T12:12:12.000Z');
    });

    it('should handle snake_case update_time from API', async () => {
      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';

      const mockResponse = {
        memories: [
          {
            memory: {
              fact: 'test fact',
              update_time: '2024-12-12T12:12:12.123456Z',
            },
          },
        ],
      };

      global.fetch = vi.fn(async () => {
        return new Response(JSON.stringify(mockResponse), {status: 200});
      }) as unknown as typeof fetch;

      const service = new VertexAiMemoryBankService({
        expressModeApiKey: 'test-api-key',
        agentEngineId: '123',
      });

      const result = await service.searchMemory({
        appName: MOCK_APP_NAME,
        userId: MOCK_USER_ID,
        query: 'test',
      });

      expect(result.memories[0].timestamp).toBe('2024-12-12T12:12:12.123Z');
    });
  });

  describe('error handling', () => {
    it('should throw error on API failure', async () => {
      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';
      // Set GOOGLE_CLOUD_PROJECT to avoid metadata service call
      process.env['GOOGLE_CLOUD_PROJECT'] = 'test-project';

      global.fetch = vi.fn(async () => {
        return new Response('Permission denied', {status: 403});
      }) as unknown as typeof fetch;

      // Use expressModeApiKey to skip OAuth authentication
      const service = new VertexAiMemoryBankService({
        expressModeApiKey: 'test-api-key',
        agentEngineId: '123',
      });

      await expect(
        service.searchMemory({
          appName: MOCK_APP_NAME,
          userId: MOCK_USER_ID,
          query: 'test',
        })
      ).rejects.toThrow('API request failed: 403');
    });
  });

  describe('content serialization', () => {
    it('should serialize event content correctly', async () => {
      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';

      let capturedBody: Record<string, unknown> | undefined;

      global.fetch = vi.fn(async (_url: string, options?: RequestInit) => {
        capturedBody = options?.body
          ? JSON.parse(options.body as string)
          : undefined;
        return new Response('{}', {status: 200});
      }) as unknown as typeof fetch;

      const session = createSession(MOCK_APP_NAME, MOCK_USER_ID, 'test-session', [
        createEvent('1', 'inv1', 'user', 12345, {
          role: 'user',
          parts: [{text: 'Hello world'}],
        }),
      ]);

      const service = new VertexAiMemoryBankService({
        expressModeApiKey: 'test-api-key',
        agentEngineId: '123',
      });

      await service.addSessionToMemory(session);

      const events = (capturedBody?.direct_contents_source as {events: unknown[]})
        ?.events;
      expect(events?.length).toBe(1);

      const content = (events?.[0] as {content: unknown}).content as {
        role: string;
        parts: Array<{text: string}>;
      };
      expect(content.role).toBe('user');
      expect(content.parts[0].text).toBe('Hello world');
    });
  });
});
