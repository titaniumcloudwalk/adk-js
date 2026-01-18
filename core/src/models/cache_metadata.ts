/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Metadata for context cache associated with LLM responses.
 *
 * This class stores cache identification, usage tracking, and lifecycle
 * information for a particular cache instance. It can be in two states:
 *
 * 1. Active cache state: cacheName is set, all fields populated
 * 2. Fingerprint-only state: cacheName is undefined, only fingerprint and
 *    contentsCount are set for prefix matching
 *
 * Token counts (cached and total) are available in the LlmResponse.usageMetadata
 * and should be accessed from there to avoid duplication.
 */
export interface CacheMetadata {
  /**
   * The full resource name of the cached content (e.g.,
   * 'projects/123/locations/us-central1/cachedContents/456').
   * Undefined when no active cache exists (fingerprint-only state).
   */
  cacheName?: string;

  /**
   * The time when the cache expires.
   *
   * Can be either:
   * - A Date object (legacy format)
   * - A Unix timestamp in milliseconds (Python SDK format)
   *
   * Undefined when no active cache exists.
   */
  expireTime?: Date | number;

  /**
   * Hash of cacheable contents (instruction + tools + contents).
   * Always present for prefix matching.
   */
  fingerprint?: string;

  /**
   * Number of invocations this cache has been used for.
   * Undefined when no active cache exists.
   */
  invocationsUsed?: number;

  /**
   * Number of contents. When active cache exists, this is the count of
   * cached contents. When no active cache exists, this is the total
   * count of contents in the request.
   */
  contentsCount?: number;

  /**
   * Unix timestamp when the cache was created.
   * Undefined when no active cache exists.
   */
  createdAt?: number;

  // Legacy fields for backward compatibility with older cache implementations
  /**
   * The resource name of the cached content.
   * @deprecated Use cacheName instead for consistency with Python SDK.
   */
  name?: string;

  /**
   * The timestamp when the cached content was created.
   * @deprecated Use createdAt (Unix timestamp) instead.
   */
  createTime?: Date;

  /**
   * The timestamp when the cached content was last updated.
   * @deprecated No longer used in the Python SDK.
   */
  updateTime?: Date;

  /**
   * A human-readable display name for the cached content.
   * @deprecated No longer used in the Python SDK.
   */
  displayName?: string;

  /**
   * The model identifier for which this cache was created.
   * @deprecated No longer used in the Python SDK.
   */
  model?: string;

  /**
   * Usage metadata for the cache, such as token counts.
   * @deprecated Use LlmResponse.usageMetadata instead.
   */
  usageMetadata?: {
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
