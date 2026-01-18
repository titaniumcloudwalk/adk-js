/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Metadata for a Gemini context cache.
 *
 * Context caching allows storing frequently used content to reduce costs
 * and improve performance for long conversations.
 */
export interface CacheMetadata {
  /**
   * The resource name of the cached content.
   * Format: 'projects/{project}/locations/{location}/cachedContents/{cache_id}'
   * or just the cache ID for Gemini API (without project/location).
   */
  name: string;

  /**
   * The timestamp when the cached content was created.
   */
  createTime: Date;

  /**
   * The timestamp when the cached content was last updated.
   */
  updateTime: Date;

  /**
   * The timestamp when the cached content will expire.
   * After this time, the cache will be automatically deleted.
   */
  expireTime: Date;

  /**
   * A human-readable display name for the cached content.
   */
  displayName?: string;

  /**
   * The model identifier for which this cache was created.
   */
  model?: string;

  /**
   * Usage metadata for the cache, such as token counts.
   */
  usageMetadata?: {
    /**
     * Total number of tokens in the cached content.
     */
    totalTokenCount?: number;
  };
}

/**
 * Configuration for Gemini context caching.
 *
 * Controls when and how context caching is used to optimize costs
 * and performance.
 *
 * @example
 * ```typescript
 * const cacheConfig: ContextCacheConfig = {
 *   cacheIntervals: 10,    // Create new cache every 10 invocations
 *   ttlSeconds: 1800,      // Cache expires after 30 minutes
 *   minTokens: 1000,       // Only cache if content > 1000 tokens
 * };
 * ```
 */
export interface ContextCacheConfig {
  /**
   * Number of invocations between cache updates.
   *
   * A cache is created or updated every N invocations. For example:
   * - cacheIntervals = 1: Update cache on every invocation
   * - cacheIntervals = 10: Update cache every 10 invocations
   *
   * Valid range: 1-100
   * Default: 10
   */
  cacheIntervals?: number;

  /**
   * Time-to-live for the cache in seconds.
   *
   * After this duration, the cache will expire and be automatically deleted.
   * The cache expiry time is extended by this duration on each cache update.
   *
   * Default: 1800 (30 minutes)
   */
  ttlSeconds?: number;

  /**
   * Minimum number of tokens required to create a cache.
   *
   * Caching is only beneficial for large contexts. If the content is below
   * this threshold, no cache will be created.
   *
   * Default: 0 (no minimum)
   */
  minTokens?: number;
}

/**
 * Creates a default ContextCacheConfig with standard settings.
 */
export function createContextCacheConfig(
  config: Partial<ContextCacheConfig> = {}
): ContextCacheConfig {
  return {
    cacheIntervals: config.cacheIntervals ?? 10,
    ttlSeconds: config.ttlSeconds ?? 1800,
    minTokens: config.minTokens ?? 0,
  };
}
