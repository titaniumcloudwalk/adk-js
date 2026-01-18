/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, GoogleGenAI} from '@google/genai';
import {describe, expect, it, beforeEach, vi} from 'vitest';

import {GeminiContextCacheManager} from '../../src/models/gemini_context_cache_manager.js';
import {ContextCacheConfig} from '../../src/models/cache_metadata.js';

describe('GeminiContextCacheManager', () => {
  let mockClient: GoogleGenAI;
  let manager: GeminiContextCacheManager;

  beforeEach(() => {
    // Create a mock GoogleGenAI client
    mockClient = {} as GoogleGenAI;
  });

  describe('constructor', () => {
    it('should create manager with default config', () => {
      manager = new GeminiContextCacheManager(mockClient);

      const config = manager.getConfig();
      expect(config.cacheIntervals).toBe(10);
      expect(config.ttlSeconds).toBe(1800);
      expect(config.minTokens).toBe(0);
    });

    it('should create manager with custom config', () => {
      const customConfig: Partial<ContextCacheConfig> = {
        cacheIntervals: 5,
        ttlSeconds: 3600,
        minTokens: 1000,
      };

      manager = new GeminiContextCacheManager(mockClient, customConfig);

      const config = manager.getConfig();
      expect(config.cacheIntervals).toBe(5);
      expect(config.ttlSeconds).toBe(3600);
      expect(config.minTokens).toBe(1000);
    });

    it('should merge partial config with defaults', () => {
      manager = new GeminiContextCacheManager(mockClient, {
        cacheIntervals: 20,
      });

      const config = manager.getConfig();
      expect(config.cacheIntervals).toBe(20);
      expect(config.ttlSeconds).toBe(1800); // default
      expect(config.minTokens).toBe(0); // default
    });
  });

  describe('createCache', () => {
    beforeEach(() => {
      manager = new GeminiContextCacheManager(mockClient, {
        minTokens: 100,
      });
    });

    it('should create cache with sufficient content', async () => {
      const contents: Content[] = [
        {
          role: 'user',
          parts: [{text: 'a'.repeat(500)}], // ~125 tokens
        },
      ];

      const metadata = await manager.createCache(
        contents,
        'test-cache',
        'gemini-2.5-flash'
      );

      expect(metadata.name).toMatch(/^cache_/);
      expect(metadata.displayName).toBe('test-cache');
      expect(metadata.model).toBe('gemini-2.5-flash');
      expect(metadata.createTime).toBeInstanceOf(Date);
      expect(metadata.updateTime).toBeInstanceOf(Date);
      expect(metadata.expireTime).toBeInstanceOf(Date);
      expect(metadata.expireTime.getTime()).toBeGreaterThan(
        metadata.createTime.getTime()
      );
      expect(metadata.usageMetadata?.totalTokenCount).toBeGreaterThan(0);
    });

    it('should throw error when content below minimum tokens', async () => {
      const contents: Content[] = [
        {
          role: 'user',
          parts: [{text: 'short'}], // < 100 tokens
        },
      ];

      await expect(
        manager.createCache(contents, 'test-cache')
      ).rejects.toThrow(/below minimum threshold/);
    });

    it('should store cache in internal map', async () => {
      const contents: Content[] = [
        {
          role: 'user',
          parts: [{text: 'a'.repeat(500)}],
        },
      ];

      const metadata = await manager.createCache(contents);

      const retrieved = await manager.getCache(metadata.name);
      expect(retrieved).toEqual(metadata);
    });

    it('should generate expiration time based on TTL', async () => {
      const customManager = new GeminiContextCacheManager(mockClient, {
        ttlSeconds: 7200, // 2 hours
        minTokens: 0,
      });

      const contents: Content[] = [
        {
          role: 'user',
          parts: [{text: 'test content'}],
        },
      ];

      const beforeCreate = Date.now();
      const metadata = await customManager.createCache(contents);
      const afterCreate = Date.now();

      const expectedExpiry = beforeCreate + 7200 * 1000;
      const actualExpiry = metadata.expireTime.getTime();

      // Allow for a small time difference due to execution time
      expect(actualExpiry).toBeGreaterThanOrEqual(expectedExpiry - 1000);
      expect(actualExpiry).toBeLessThanOrEqual(afterCreate + 7200 * 1000);
    });
  });

  describe('getCache', () => {
    beforeEach(() => {
      manager = new GeminiContextCacheManager(mockClient, {minTokens: 0});
    });

    it('should retrieve existing cache', async () => {
      const contents: Content[] = [
        {
          role: 'user',
          parts: [{text: 'test'}],
        },
      ];

      const created = await manager.createCache(contents);
      const retrieved = await manager.getCache(created.name);

      expect(retrieved).toEqual(created);
    });

    it('should return undefined for non-existent cache', async () => {
      const retrieved = await manager.getCache('non-existent-cache');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('validateCache', () => {
    beforeEach(() => {
      manager = new GeminiContextCacheManager(mockClient, {
        cacheIntervals: 5,
        minTokens: 0,
      });
    });

    it('should validate non-expired cache', async () => {
      const contents: Content[] = [
        {
          role: 'user',
          parts: [{text: 'test'}],
        },
      ];

      const metadata = await manager.createCache(contents);
      const isValid = manager.validateCache(metadata);

      expect(isValid).toBe(true);
    });

    it('should invalidate expired cache', () => {
      const expiredMetadata = {
        name: 'expired-cache',
        createTime: new Date(Date.now() - 10000),
        updateTime: new Date(Date.now() - 10000),
        expireTime: new Date(Date.now() - 1000), // Expired 1 second ago
      };

      const isValid = manager.validateCache(expiredMetadata);

      expect(isValid).toBe(false);
    });

    it('should invalidate cache at interval boundaries', async () => {
      const contents: Content[] = [
        {
          role: 'user',
          parts: [{text: 'test'}],
        },
      ];

      const metadata = await manager.createCache(contents);

      // Cache should be valid initially
      expect(manager.validateCache(metadata)).toBe(true);

      // Increment to just before interval
      for (let i = 0; i < 4; i++) {
        manager.incrementInvocationCount();
        expect(manager.validateCache(metadata)).toBe(true);
      }

      // At interval boundary (count = 5, interval = 5), should invalidate
      manager.incrementInvocationCount();
      expect(manager.getInvocationCount()).toBe(5);
      expect(manager.validateCache(metadata)).toBe(false);
    });

    it('should not invalidate at interval when count is 0', async () => {
      const contents: Content[] = [
        {
          role: 'user',
          parts: [{text: 'test'}],
        },
      ];

      const metadata = await manager.createCache(contents);

      // At count = 0, should still be valid
      expect(manager.getInvocationCount()).toBe(0);
      expect(manager.validateCache(metadata)).toBe(true);
    });
  });

  describe('invocation count management', () => {
    beforeEach(() => {
      manager = new GeminiContextCacheManager(mockClient);
    });

    it('should start with count of 0', () => {
      expect(manager.getInvocationCount()).toBe(0);
    });

    it('should increment count', () => {
      manager.incrementInvocationCount();
      expect(manager.getInvocationCount()).toBe(1);

      manager.incrementInvocationCount();
      expect(manager.getInvocationCount()).toBe(2);
    });

    it('should reset count to 0', () => {
      manager.incrementInvocationCount();
      manager.incrementInvocationCount();
      manager.incrementInvocationCount();
      expect(manager.getInvocationCount()).toBe(3);

      manager.resetInvocationCount();
      expect(manager.getInvocationCount()).toBe(0);
    });
  });

  describe('cleanupExpiredCaches', () => {
    beforeEach(() => {
      manager = new GeminiContextCacheManager(mockClient, {minTokens: 0});
    });

    it('should remove expired caches from local map', async () => {
      // Create a valid cache
      const validContents: Content[] = [
        {
          role: 'user',
          parts: [{text: 'valid'}],
        },
      ];
      const validCache = await manager.createCache(validContents);

      // Create an expired cache by directly adding to the internal map
      const expiredCache = await manager.createCache([
        {
          role: 'user',
          parts: [{text: 'expired'}],
        },
      ]);
      // Manually expire it
      expiredCache.expireTime = new Date(Date.now() - 1000);

      // Before cleanup, should have 2 caches
      expect(manager.getAllCaches().length).toBe(2);

      // Cleanup
      manager.cleanupExpiredCaches();

      // After cleanup, should have only valid cache
      const remainingCaches = manager.getAllCaches();
      expect(remainingCaches.length).toBe(1);
      expect(remainingCaches[0].name).toBe(validCache.name);
    });

    it('should not remove valid caches', async () => {
      const contents1: Content[] = [
        {
          role: 'user',
          parts: [{text: 'test1'}],
        },
      ];

      const contents2: Content[] = [
        {
          role: 'user',
          parts: [{text: 'test2'}],
        },
      ];

      const cache1 = await manager.createCache(contents1);
      const cache2 = await manager.createCache(contents2);

      manager.cleanupExpiredCaches();

      expect(manager.getAllCaches().length).toBe(2);
    });

    it('should handle cleanup when no caches exist', () => {
      expect(() => manager.cleanupExpiredCaches()).not.toThrow();
      expect(manager.getAllCaches().length).toBe(0);
    });
  });

  describe('generateFingerprint', () => {
    beforeEach(() => {
      manager = new GeminiContextCacheManager(mockClient);
    });

    it('should generate consistent fingerprints for same content', () => {
      const contents: Content[] = [
        {
          role: 'user',
          parts: [{text: 'test content'}],
        },
      ];

      const fingerprint1 = manager.generateFingerprint(contents);
      const fingerprint2 = manager.generateFingerprint(contents);

      expect(fingerprint1).toBe(fingerprint2);
      expect(fingerprint1).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    });

    it('should generate different fingerprints for different content', () => {
      const contents1: Content[] = [
        {
          role: 'user',
          parts: [{text: 'content 1'}],
        },
      ];

      const contents2: Content[] = [
        {
          role: 'user',
          parts: [{text: 'content 2'}],
        },
      ];

      const fingerprint1 = manager.generateFingerprint(contents1);
      const fingerprint2 = manager.generateFingerprint(contents2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it('should generate same fingerprint regardless of object key order', () => {
      const contents1: Content[] = [
        {
          role: 'user',
          parts: [{text: 'test'}],
        },
      ];

      // Create contents with different internal key order (simulated)
      const contents2: Content[] = JSON.parse(
        JSON.stringify([
          {
            parts: [{text: 'test'}],
            role: 'user',
          },
        ])
      );

      const fingerprint1 = manager.generateFingerprint(contents1);
      const fingerprint2 = manager.generateFingerprint(contents2);

      expect(fingerprint1).toBe(fingerprint2);
    });
  });

  describe('getAllCaches', () => {
    beforeEach(() => {
      manager = new GeminiContextCacheManager(mockClient, {minTokens: 0});
    });

    it('should return empty array when no caches exist', () => {
      expect(manager.getAllCaches()).toEqual([]);
    });

    it('should return all cached metadata', async () => {
      const contents1: Content[] = [
        {
          role: 'user',
          parts: [{text: 'test 1'}],
        },
      ];

      const contents2: Content[] = [
        {
          role: 'user',
          parts: [{text: 'test 2'}],
        },
      ];

      const cache1 = await manager.createCache(contents1);
      const cache2 = await manager.createCache(contents2);

      const allCaches = manager.getAllCaches();

      expect(allCaches.length).toBe(2);
      expect(allCaches).toContainEqual(cache1);
      expect(allCaches).toContainEqual(cache2);
    });
  });

  describe('getConfig', () => {
    it('should return a copy of the config', () => {
      manager = new GeminiContextCacheManager(mockClient, {
        cacheIntervals: 15,
      });

      const config1 = manager.getConfig();
      const config2 = manager.getConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different objects

      // Modifying returned config should not affect internal config
      config1.cacheIntervals = 999;
      expect(manager.getConfig().cacheIntervals).toBe(15);
    });
  });
});
