/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Event} from '../../src/events/event.js';
import {InMemoryMemoryService} from '../../src/memory/in_memory_memory_service.js';
import {Session} from '../../src/sessions/session.js';

describe('InMemoryMemoryService', () => {
  let memoryService: InMemoryMemoryService;

  beforeEach(() => {
    memoryService = new InMemoryMemoryService();
  });

  function createSession(
    appName: string,
    userId: string,
    sessionId: string,
    events: Event[],
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
    author: string,
    text: string,
    timestamp?: number,
  ): Event {
    return {
      invocationId: 'inv-1',
      author,
      timestamp: timestamp ?? Date.now(),
      content: {
        role: author === 'user' ? 'user' : 'model',
        parts: [{text}],
      },
    };
  }

  describe('addSessionToMemory', () => {
    it('should add session events to memory', async () => {
      const session = createSession('testApp', 'user1', 'session1', [
        createEvent('user', 'Hello, how are you?'),
        createEvent('model', 'I am doing well, thank you!'),
      ]);

      await memoryService.addSessionToMemory(session);

      const response = await memoryService.searchMemory({
        appName: 'testApp',
        userId: 'user1',
        query: 'hello',
      });

      expect(response.memories.length).toBeGreaterThan(0);
    });

    it('should filter out events without content', async () => {
      const eventWithContent = createEvent('user', 'This has content');
      const eventWithoutParts: Event = {
        invocationId: 'inv-2',
        author: 'user',
        timestamp: Date.now(),
        content: {role: 'user', parts: []},
      };

      const session = createSession('testApp', 'user1', 'session1', [
        eventWithContent,
        eventWithoutParts,
      ]);

      await memoryService.addSessionToMemory(session);

      const response = await memoryService.searchMemory({
        appName: 'testApp',
        userId: 'user1',
        query: 'content',
      });

      expect(response.memories.length).toBe(1);
    });
  });

  describe('searchMemory', () => {
    beforeEach(async () => {
      const session = createSession('testApp', 'user1', 'session1', [
        createEvent('user', 'I want to book a flight to Paris'),
        createEvent('model', 'Sure, I can help you book a flight to Paris.'),
        createEvent('user', 'The date should be January 15th'),
      ]);

      await memoryService.addSessionToMemory(session);
    });

    it('should find memories matching query words', async () => {
      const response = await memoryService.searchMemory({
        appName: 'testApp',
        userId: 'user1',
        query: 'Paris flight',
      });

      expect(response.memories.length).toBe(2);
    });

    it('should return empty array for non-matching query', async () => {
      const response = await memoryService.searchMemory({
        appName: 'testApp',
        userId: 'user1',
        query: 'completely unrelated topic xyz',
      });

      expect(response.memories).toEqual([]);
    });

    it('should return empty array for unknown user', async () => {
      const response = await memoryService.searchMemory({
        appName: 'testApp',
        userId: 'unknownUser',
        query: 'Paris',
      });

      expect(response.memories).toEqual([]);
    });

    it('should return empty array for unknown app', async () => {
      const response = await memoryService.searchMemory({
        appName: 'unknownApp',
        userId: 'user1',
        query: 'Paris',
      });

      expect(response.memories).toEqual([]);
    });
  });

  describe('MemoryEntry structure', () => {
    it('should return MemoryEntry with content, author, and timestamp fields', async () => {
      const timestamp = Date.now();
      const session = createSession('testApp', 'user1', 'session1', [
        createEvent('user', 'Test message', timestamp),
      ]);

      await memoryService.addSessionToMemory(session);

      const response = await memoryService.searchMemory({
        appName: 'testApp',
        userId: 'user1',
        query: 'Test',
      });

      expect(response.memories.length).toBe(1);
      const memory = response.memories[0];

      // Check content
      expect(memory.content.parts?.[0]).toEqual({text: 'Test message'});

      // Check author
      expect(memory.author).toBe('user');

      // Check timestamp is ISO format
      expect(memory.timestamp).toBeDefined();
      expect(new Date(memory.timestamp!).toISOString()).toBe(memory.timestamp);

      // New fields should be undefined (not set by InMemoryMemoryService)
      expect(memory.id).toBeUndefined();
      expect(memory.customMetadata).toBeUndefined();
    });

    it('should format timestamp as ISO 8601', async () => {
      const specificTime = new Date('2025-01-15T10:30:00.000Z').getTime();
      const session = createSession('testApp', 'user1', 'session1', [
        createEvent('user', 'Specific time test', specificTime),
      ]);

      await memoryService.addSessionToMemory(session);

      const response = await memoryService.searchMemory({
        appName: 'testApp',
        userId: 'user1',
        query: 'time',
      });

      expect(response.memories[0].timestamp).toBe('2025-01-15T10:30:00.000Z');
    });
  });

  describe('user isolation', () => {
    it('should keep memories separate per user', async () => {
      const session1 = createSession('testApp', 'user1', 'session1', [
        createEvent('user', 'User one private data'),
      ]);
      const session2 = createSession('testApp', 'user2', 'session2', [
        createEvent('user', 'User two private data'),
      ]);

      await memoryService.addSessionToMemory(session1);
      await memoryService.addSessionToMemory(session2);

      const response1 = await memoryService.searchMemory({
        appName: 'testApp',
        userId: 'user1',
        query: 'private',
      });

      const response2 = await memoryService.searchMemory({
        appName: 'testApp',
        userId: 'user2',
        query: 'private',
      });

      expect(response1.memories.length).toBe(1);
      expect(response1.memories[0].content.parts?.[0]).toEqual({
        text: 'User one private data',
      });

      expect(response2.memories.length).toBe(1);
      expect(response2.memories[0].content.parts?.[0]).toEqual({
        text: 'User two private data',
      });
    });
  });

  describe('app isolation', () => {
    it('should keep memories separate per app', async () => {
      const session1 = createSession('app1', 'user1', 'session1', [
        createEvent('user', 'App one specific data'),
      ]);
      const session2 = createSession('app2', 'user1', 'session2', [
        createEvent('user', 'App two specific data'),
      ]);

      await memoryService.addSessionToMemory(session1);
      await memoryService.addSessionToMemory(session2);

      const response1 = await memoryService.searchMemory({
        appName: 'app1',
        userId: 'user1',
        query: 'specific',
      });

      const response2 = await memoryService.searchMemory({
        appName: 'app2',
        userId: 'user1',
        query: 'specific',
      });

      expect(response1.memories.length).toBe(1);
      expect(response1.memories[0].content.parts?.[0]).toEqual({
        text: 'App one specific data',
      });

      expect(response2.memories.length).toBe(1);
      expect(response2.memories[0].content.parts?.[0]).toEqual({
        text: 'App two specific data',
      });
    });
  });
});
