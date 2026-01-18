/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content} from '@google/genai';
import {MemoryEntry} from '../../src/memory/memory_entry.js';

describe('MemoryEntry', () => {
  describe('interface structure', () => {
    it('should allow creating a MemoryEntry with only required field (content)', () => {
      const content: Content = {
        role: 'user',
        parts: [{text: 'Hello, world!'}],
      };

      const entry: MemoryEntry = {
        content,
      };

      expect(entry.content).toEqual(content);
      expect(entry.id).toBeUndefined();
      expect(entry.customMetadata).toBeUndefined();
      expect(entry.author).toBeUndefined();
      expect(entry.timestamp).toBeUndefined();
    });

    it('should allow creating a MemoryEntry with all optional fields', () => {
      const content: Content = {
        role: 'model',
        parts: [{text: 'Hello! How can I help you?'}],
      };

      const entry: MemoryEntry = {
        content,
        id: 'memory-123',
        customMetadata: {
          source: 'chat',
          importance: 'high',
          tags: ['greeting', 'initial'],
        },
        author: 'assistant',
        timestamp: '2025-01-15T10:30:00.000Z',
      };

      expect(entry.content).toEqual(content);
      expect(entry.id).toBe('memory-123');
      expect(entry.customMetadata).toEqual({
        source: 'chat',
        importance: 'high',
        tags: ['greeting', 'initial'],
      });
      expect(entry.author).toBe('assistant');
      expect(entry.timestamp).toBe('2025-01-15T10:30:00.000Z');
    });
  });

  describe('id field', () => {
    it('should support string id', () => {
      const entry: MemoryEntry = {
        content: {role: 'user', parts: [{text: 'test'}]},
        id: 'unique-memory-id-456',
      };

      expect(entry.id).toBe('unique-memory-id-456');
    });

    it('should support UUID-style id', () => {
      const entry: MemoryEntry = {
        content: {role: 'user', parts: [{text: 'test'}]},
        id: '550e8400-e29b-41d4-a716-446655440000',
      };

      expect(entry.id).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should allow undefined id', () => {
      const entry: MemoryEntry = {
        content: {role: 'user', parts: [{text: 'test'}]},
        id: undefined,
      };

      expect(entry.id).toBeUndefined();
    });
  });

  describe('customMetadata field', () => {
    it('should support empty object', () => {
      const entry: MemoryEntry = {
        content: {role: 'user', parts: [{text: 'test'}]},
        customMetadata: {},
      };

      expect(entry.customMetadata).toEqual({});
    });

    it('should support simple key-value pairs', () => {
      const entry: MemoryEntry = {
        content: {role: 'user', parts: [{text: 'test'}]},
        customMetadata: {
          key1: 'value1',
          key2: 123,
          key3: true,
        },
      };

      expect(entry.customMetadata).toEqual({
        key1: 'value1',
        key2: 123,
        key3: true,
      });
    });

    it('should support nested objects', () => {
      const entry: MemoryEntry = {
        content: {role: 'user', parts: [{text: 'test'}]},
        customMetadata: {
          nested: {
            level1: {
              level2: 'deep value',
            },
          },
        },
      };

      expect(entry.customMetadata?.['nested']).toEqual({
        level1: {level2: 'deep value'},
      });
    });

    it('should support arrays in metadata', () => {
      const entry: MemoryEntry = {
        content: {role: 'user', parts: [{text: 'test'}]},
        customMetadata: {
          tags: ['important', 'reviewed', 'archived'],
          scores: [0.9, 0.85, 0.7],
        },
      };

      expect(entry.customMetadata?.['tags']).toEqual([
        'important',
        'reviewed',
        'archived',
      ]);
      expect(entry.customMetadata?.['scores']).toEqual([0.9, 0.85, 0.7]);
    });

    it('should allow undefined customMetadata', () => {
      const entry: MemoryEntry = {
        content: {role: 'user', parts: [{text: 'test'}]},
        customMetadata: undefined,
      };

      expect(entry.customMetadata).toBeUndefined();
    });
  });

  describe('backward compatibility', () => {
    it('should work with existing code that only uses content, author, timestamp', () => {
      // This simulates how InMemoryMemoryService creates entries
      const entry: MemoryEntry = {
        content: {role: 'user', parts: [{text: 'Hello'}]},
        author: 'user',
        timestamp: '2025-01-15T10:00:00.000Z',
      };

      // Access all original fields
      expect(entry.content.parts?.[0]).toEqual({text: 'Hello'});
      expect(entry.author).toBe('user');
      expect(entry.timestamp).toBe('2025-01-15T10:00:00.000Z');

      // New fields should be undefined but accessible
      expect(entry.id).toBeUndefined();
      expect(entry.customMetadata).toBeUndefined();
    });

    it('should allow adding new fields to existing entry pattern', () => {
      // Existing pattern
      const baseEntry: Partial<MemoryEntry> = {
        content: {role: 'model', parts: [{text: 'Response'}]},
        author: 'assistant',
        timestamp: '2025-01-15T10:05:00.000Z',
      };

      // New enhanced pattern with additional fields
      const enhancedEntry: MemoryEntry = {
        ...baseEntry,
        content: baseEntry.content!,
        id: 'memory-789',
        customMetadata: {
          generatedBy: 'gemini-2.0-flash',
          confidence: 0.95,
        },
      };

      expect(enhancedEntry.id).toBe('memory-789');
      expect(enhancedEntry.customMetadata).toEqual({
        generatedBy: 'gemini-2.0-flash',
        confidence: 0.95,
      });
      // Original fields preserved
      expect(enhancedEntry.author).toBe('assistant');
      expect(enhancedEntry.timestamp).toBe('2025-01-15T10:05:00.000Z');
    });
  });

  describe('real-world use cases', () => {
    it('should support memory entry from Vertex AI Memory Bank', () => {
      // Simulates entry returned from VertexAiMemoryBankService
      const entry: MemoryEntry = {
        content: {
          role: 'user',
          parts: [{text: 'User prefers dark mode in all applications.'}],
        },
        id: 'memories/abc123',
        customMetadata: {
          memoryType: 'preference',
          extractedFrom: 'session-456',
          scope: {appName: 'myApp', userId: 'user123'},
        },
        author: 'system',
        timestamp: '2025-01-10T14:30:00.000Z',
      };

      expect(entry.id).toBe('memories/abc123');
      expect(entry.customMetadata?.['memoryType']).toBe('preference');
    });

    it('should support memory entry from RAG retrieval', () => {
      // Simulates entry returned from VertexAiRagMemoryService
      const entry: MemoryEntry = {
        content: {
          role: 'user',
          parts: [
            {
              text: 'The project deadline is February 28th, 2025.',
            },
          ],
        },
        id: 'rag-doc-789',
        customMetadata: {
          sourceDocumentId: 'doc-001',
          chunkIndex: 3,
          relevanceScore: 0.92,
          ragCorpus: 'projects/my-project/locations/us-central1/ragCorpora/123',
        },
        author: 'user',
        timestamp: '2025-01-08T09:00:00.000Z',
      };

      expect(entry.customMetadata?.['relevanceScore']).toBe(0.92);
      expect(entry.customMetadata?.['chunkIndex']).toBe(3);
    });
  });
});
