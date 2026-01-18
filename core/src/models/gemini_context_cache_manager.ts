/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, GoogleGenAI} from '@google/genai';
import {createHash} from 'crypto';

import {logger} from '../utils/logger.js';

import {CacheMetadata, ContextCacheConfig, createContextCacheConfig} from './cache_metadata.js';

/**
 * Manages Gemini context caches for optimizing API costs and performance.
 *
 * The cache manager handles the lifecycle of context caches:
 * - Creating caches for frequently used content
 * - Validating cache freshness and validity
 * - Cleaning up expired caches
 * - Generating fingerprints for cache validation
 *
 * @example
 * ```typescript
 * const manager = new GeminiContextCacheManager(
 *   new GoogleGenAI({apiKey: 'YOUR_API_KEY'}),
 *   {cacheIntervals: 10, ttlSeconds: 1800}
 * );
 *
 * // Create a cache for static content
 * const metadata = await manager.createCache(contents, 'my-cache');
 *
 * // Check if cache is still valid
 * if (manager.validateCache(metadata)) {
 *   // Use cached content...
 * }
 * ```
 */
export class GeminiContextCacheManager {
  private readonly client: GoogleGenAI;
  private readonly config: ContextCacheConfig;
  private readonly caches: Map<string, CacheMetadata> = new Map();
  private invocationCount: number = 0;

  /**
   * Creates a new GeminiContextCacheManager.
   *
   * @param client The GoogleGenAI client for cache operations.
   * @param config Configuration for cache behavior.
   */
  constructor(client: GoogleGenAI, config?: Partial<ContextCacheConfig>) {
    this.client = client;
    this.config = createContextCacheConfig(config);
  }

  /**
   * Creates a new context cache for the given contents.
   *
   * @param contents The content to cache.
   * @param displayName Optional display name for the cache.
   * @param model The model identifier for the cache.
   * @returns The cache metadata.
   */
  async createCache(
    contents: Content[],
    displayName?: string,
    model?: string
  ): Promise<CacheMetadata> {
    // Check minimum token requirement
    const tokenCount = this.estimateTokenCount(contents);
    if (tokenCount < (this.config.minTokens ?? 0)) {
      throw new Error(
        `Content token count (${tokenCount}) is below minimum threshold (${this.config.minTokens}). ` +
        'Cache creation skipped.'
      );
    }

    const fingerprint = this.generateFingerprint(contents);
    logger.debug(`Creating context cache with fingerprint: ${fingerprint}`);

    try {
      // Calculate expiration time
      const ttl = this.config.ttlSeconds ?? 1800;
      const expireTime = new Date(Date.now() + ttl * 1000);

      // Note: The actual cache creation via Google GenAI SDK would happen here.
      // For now, we create a placeholder cache metadata.
      // In production, this would call:
      // const cache = await this.client.cacheManager.create({...});

      const cacheMetadata: CacheMetadata = {
        name: `cache_${fingerprint.substring(0, 16)}`,
        createTime: new Date(),
        updateTime: new Date(),
        expireTime,
        displayName: displayName ?? `Context cache ${fingerprint.substring(0, 8)}`,
        model,
        usageMetadata: {
          totalTokenCount: tokenCount,
        },
      };

      this.caches.set(cacheMetadata.name, cacheMetadata);
      logger.info(`Created context cache: ${cacheMetadata.name}, expires: ${expireTime.toISOString()}`);

      return cacheMetadata;
    } catch (error) {
      logger.error('Failed to create context cache', error);
      throw new Error(`Cache creation failed: ${error}`);
    }
  }

  /**
   * Retrieves cache metadata by name.
   *
   * @param name The cache name/ID.
   * @returns The cache metadata, or undefined if not found.
   */
  async getCache(name: string): Promise<CacheMetadata | undefined> {
    // Check in-memory cache first
    const cached = this.caches.get(name);
    if (cached) {
      return cached;
    }

    // In production, this would fetch from the API:
    // const cache = await this.client.cacheManager.get(name);
    // return this.convertApiCacheToMetadata(cache);

    return undefined;
  }

  /**
   * Validates whether a cache is still valid and not expired.
   *
   * @param metadata The cache metadata to validate.
   * @returns True if the cache is valid, false otherwise.
   */
  validateCache(metadata: CacheMetadata): boolean {
    const now = new Date();

    // Check if cache has expired
    if (metadata.expireTime <= now) {
      logger.debug(`Cache ${metadata.name} has expired`);
      return false;
    }

    // Check if we've exceeded the invocation interval
    const intervals = this.config.cacheIntervals ?? 10;
    if (this.invocationCount % intervals === 0 && this.invocationCount > 0) {
      logger.debug(
        `Cache ${metadata.name} invalidated: reached invocation interval ` +
        `(count: ${this.invocationCount}, interval: ${intervals})`
      );
      return false;
    }

    return true;
  }

  /**
   * Increments the invocation counter.
   *
   * This should be called for each LLM invocation to track cache intervals.
   */
  incrementInvocationCount(): void {
    this.invocationCount++;
  }

  /**
   * Resets the invocation counter.
   *
   * This is useful when starting a new session or conversation.
   */
  resetInvocationCount(): void {
    this.invocationCount = 0;
  }

  /**
   * Cleans up expired caches from the local cache map.
   *
   * This does not delete caches from the remote API; they will
   * expire automatically based on their TTL.
   */
  cleanupExpiredCaches(): void {
    const now = new Date();
    const expiredCaches: string[] = [];

    for (const [name, metadata] of this.caches.entries()) {
      if (metadata.expireTime <= now) {
        expiredCaches.push(name);
      }
    }

    for (const name of expiredCaches) {
      this.caches.delete(name);
      logger.debug(`Removed expired cache from local map: ${name}`);
    }

    if (expiredCaches.length > 0) {
      logger.info(`Cleaned up ${expiredCaches.length} expired cache(s)`);
    }
  }

  /**
   * Generates a content fingerprint for cache validation.
   *
   * The fingerprint is a hash of the content that can be used to detect
   * when content has changed and caches need to be invalidated.
   *
   * @param contents The contents to fingerprint.
   * @returns A hex-encoded SHA-256 hash of the content.
   */
  generateFingerprint(contents: Content[]): string {
    // Serialize content to a stable string representation
    const contentString = JSON.stringify(contents, (key, value) => {
      // Sort object keys for stable serialization
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value)
          .sort()
          .reduce((sorted, key) => {
            sorted[key] = value[key];
            return sorted;
          }, {} as Record<string, unknown>);
      }
      return value;
    });

    // Generate SHA-256 hash
    const hash = createHash('sha256');
    hash.update(contentString);
    return hash.digest('hex');
  }

  /**
   * Estimates the token count for the given contents.
   *
   * This is a rough approximation based on character count.
   * In production, you would use the actual token counting API.
   *
   * @param contents The contents to estimate.
   * @returns Estimated token count.
   */
  private estimateTokenCount(contents: Content[]): number {
    let charCount = 0;

    for (const content of contents) {
      if (content.parts) {
        for (const part of content.parts) {
          if ('text' in part && part.text) {
            charCount += part.text.length;
          }
          // For other part types (inline_data, file_data, etc.),
          // we could add more sophisticated estimation
        }
      }
    }

    // Rough approximation: ~4 characters per token
    return Math.ceil(charCount / 4);
  }

  /**
   * Gets the current configuration.
   */
  getConfig(): ContextCacheConfig {
    return {...this.config};
  }

  /**
   * Gets the current invocation count.
   */
  getInvocationCount(): number {
    return this.invocationCount;
  }

  /**
   * Gets all cached metadata entries.
   */
  getAllCaches(): CacheMetadata[] {
    return Array.from(this.caches.values());
  }
}
