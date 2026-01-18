/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Blob} from '@google/genai';

/**
 * Entry for storing realtime audio/video data in the cache.
 *
 * Used by AudioCacheManager to track individual audio chunks
 * before they are flushed to artifact services.
 */
export interface RealtimeCacheEntry {
  /**
   * The role that generated this data, either 'user' or 'model'.
   */
  role: 'user' | 'model';

  /**
   * The audio/video blob data.
   */
  data: Blob;

  /**
   * Timestamp when this entry was created (in seconds since epoch).
   */
  timestamp: number;
}
