/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Blob, Content, FileData, Part} from '@google/genai';

import {createEvent, Event} from '../events/event.js';
import {logger} from '../utils/logger.js';

import {InvocationContext} from './invocation_context.js';
import {RealtimeCacheEntry} from './realtime_cache_entry.js';

/**
 * Configuration for audio caching behavior.
 */
export interface AudioCacheConfig {
  /**
   * Maximum cache size in bytes before auto-flush.
   * @default 10MB
   */
  maxCacheSizeBytes?: number;

  /**
   * Maximum duration to keep data in cache (in seconds).
   * @default 300 (5 minutes)
   */
  maxCacheDurationSeconds?: number;

  /**
   * Number of chunks that triggers auto-flush.
   * @default 100
   */
  autoFlushThreshold?: number;
}

const DEFAULT_CONFIG: Required<AudioCacheConfig> = {
  maxCacheSizeBytes: 10 * 1024 * 1024, // 10MB
  maxCacheDurationSeconds: 300, // 5 minutes
  autoFlushThreshold: 100,
};

/**
 * Manages audio caching and flushing for live streaming flows.
 *
 * The AudioCacheManager handles both input (user) and output (model)
 * audio data, accumulating chunks in memory before flushing them
 * to artifact services as combined audio files.
 */
export class AudioCacheManager {
  private readonly config: Required<AudioCacheConfig>;

  /**
   * Initialize the audio cache manager.
   *
   * @param config - Configuration for audio caching behavior.
   */
  constructor(config?: AudioCacheConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  /**
   * Cache incoming user or outgoing model audio data.
   *
   * @param invocationContext - The current invocation context.
   * @param audioBlob - The audio data to cache.
   * @param cacheType - Type of audio to cache, either 'input' or 'output'.
   * @throws If cacheType is not 'input' or 'output'.
   */
  cacheAudio(
      invocationContext: InvocationContext,
      audioBlob: Blob,
      cacheType: 'input' | 'output',
  ): void {
    let cache: RealtimeCacheEntry[];
    let role: 'user' | 'model';

    if (cacheType === 'input') {
      if (!invocationContext.inputRealtimeCache) {
        invocationContext.inputRealtimeCache = [];
      }
      cache = invocationContext.inputRealtimeCache;
      role = 'user';
    } else if (cacheType === 'output') {
      if (!invocationContext.outputRealtimeCache) {
        invocationContext.outputRealtimeCache = [];
      }
      cache = invocationContext.outputRealtimeCache;
      role = 'model';
    } else {
      throw new Error("cacheType must be either 'input' or 'output'");
    }

    const audioEntry: RealtimeCacheEntry = {
      role,
      data: audioBlob,
      timestamp: Date.now() / 1000, // Convert to seconds
    };
    cache.push(audioEntry);

    const dataLength = this.getBlobDataLength(audioBlob);

    logger.debug(
        `Cached ${cacheType} audio chunk: ${dataLength} bytes, cache size: ${
            cache.length}`,
    );
  }

  /**
   * Flush audio caches to artifact services.
   *
   * The multimodality data is saved in artifact service in the format of
   * audio file. The file data reference is added to the session as an event.
   *
   * @param invocationContext - The invocation context containing audio caches.
   * @param flushUserAudio - Whether to flush the input (user) audio cache.
   * @param flushModelAudio - Whether to flush the output (model) audio cache.
   * @returns A list of Event objects created from the flushed caches.
   */
  async flushCaches(
      invocationContext: InvocationContext,
      flushUserAudio: boolean = true,
      flushModelAudio: boolean = true,
  ): Promise<Event[]> {
    const flushedEvents: Event[] = [];

    if (flushUserAudio && invocationContext.inputRealtimeCache?.length) {
      const audioEvent = await this.flushCacheToServices(
          invocationContext,
          invocationContext.inputRealtimeCache,
          'input_audio',
      );
      if (audioEvent) {
        flushedEvents.push(audioEvent);
        invocationContext.inputRealtimeCache = [];
      }
    }

    if (flushModelAudio && invocationContext.outputRealtimeCache?.length) {
      logger.debug('Flushed output audio cache');
      const audioEvent = await this.flushCacheToServices(
          invocationContext,
          invocationContext.outputRealtimeCache,
          'output_audio',
      );
      if (audioEvent) {
        flushedEvents.push(audioEvent);
        invocationContext.outputRealtimeCache = [];
      }
    }

    return flushedEvents;
  }

  /**
   * Flush a list of audio cache entries to artifact services.
   *
   * The artifact service stores the actual blob. The session stores the
   * reference to the stored blob.
   *
   * @param invocationContext - The invocation context.
   * @param audioCache - The audio cache to flush.
   * @param cacheType - Type identifier for the cache.
   * @returns The created Event if the cache was successfully flushed.
   */
  private async flushCacheToServices(
      invocationContext: InvocationContext,
      audioCache: RealtimeCacheEntry[],
      cacheType: string,
  ): Promise<Event | undefined> {
    if (!invocationContext.artifactService || !audioCache.length) {
      logger.debug('Skipping cache flush: no artifact service or empty cache');
      return undefined;
    }

    try {
      // Combine audio chunks into a single buffer
      const audioChunks: Uint8Array[] = [];
      const mimeType = audioCache[0].data.mimeType ?? 'audio/pcm';

      for (const entry of audioCache) {
        if (entry.data.data) {
          const chunk = this.toUint8Array(entry.data.data);
          audioChunks.push(chunk);
        }
      }

      // Concatenate all chunks
      const totalLength =
          audioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combinedAudioData = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of audioChunks) {
        combinedAudioData.set(chunk, offset);
        offset += chunk.length;
      }

      // Generate filename with timestamp from first audio chunk
      const timestamp = Math.floor(audioCache[0].timestamp * 1000);
      const extension = mimeType.split('/').pop() ?? 'pcm';
      const filename = `adk_live_audio_storage_${cacheType}_${timestamp}.${
          extension}`;

      // Save to artifact service
      const combinedAudioPart: Part = {
        inlineData: {
          data: this.uint8ArrayToBase64(combinedAudioData),
          mimeType,
        },
      };

      const revisionId = await invocationContext.artifactService.saveArtifact({
        appName: invocationContext.appName,
        userId: invocationContext.userId,
        sessionId: invocationContext.session.id,
        filename,
        artifact: combinedAudioPart,
      });

      // Create artifact reference for session service
      const artifactRef =
          `artifact://${invocationContext.appName}/${invocationContext.userId}/${
              invocationContext.session.id}/_adk_live/${filename}#${
              revisionId}`;

      // Create event with file data reference to add to session
      // For model events, author should be the agent name, not the role
      const author = audioCache[0].role === 'model' ?
          invocationContext.agent.name :
          audioCache[0].role;

      const fileData: FileData = {
        fileUri: artifactRef,
        mimeType,
      };

      const content: Content = {
        role: audioCache[0].role,
        parts: [{fileData}],
      };

      const audioEvent = createEvent({
        invocationId: invocationContext.invocationId,
        author,
        content,
        timestamp: Math.floor(audioCache[0].timestamp * 1000),
      });

      logger.debug(
          `Successfully flushed ${cacheType} cache: ${audioCache.length} chunks, ${
              combinedAudioData.length} bytes, saved as ${filename}`,
      );
      return audioEvent;
    } catch (error) {
      logger.error(`Failed to flush ${cacheType} cache`, error);
      return undefined;
    }
  }

  /**
   * Get statistics about current cache state.
   *
   * @param invocationContext - The invocation context.
   * @returns Dictionary containing cache statistics.
   */
  getCacheStats(invocationContext: InvocationContext): {
    inputChunks: number;
    outputChunks: number;
    inputBytes: number;
    outputBytes: number;
    totalChunks: number;
    totalBytes: number;
  } {
    const inputCache = invocationContext.inputRealtimeCache ?? [];
    const outputCache = invocationContext.outputRealtimeCache ?? [];

    const inputCount = inputCache.length;
    const outputCount = outputCache.length;

    const inputBytes = inputCache.reduce((sum, entry) => {
      return sum + this.getBlobDataLength(entry.data);
    }, 0);

    const outputBytes = outputCache.reduce((sum, entry) => {
      return sum + this.getBlobDataLength(entry.data);
    }, 0);

    return {
      inputChunks: inputCount,
      outputChunks: outputCount,
      inputBytes,
      outputBytes,
      totalChunks: inputCount + outputCount,
      totalBytes: inputBytes + outputBytes,
    };
  }

  /**
   * Get the length of blob data in bytes.
   *
   * Note: In @google/genai, Blob.data is always a base64 string.
   * The length returned is the base64 string length, which is approximately
   * 4/3 of the actual byte length.
   */
  private getBlobDataLength(blob: Blob): number {
    const data = blob.data;
    if (!data) return 0;
    // @google/genai Blob.data is always a base64 string
    return data.length;
  }

  /**
   * Convert base64 encoded string to Uint8Array.
   *
   * @param data - The base64 encoded string from Blob.data
   */
  private toUint8Array(data: string): Uint8Array {
    // Blob.data in @google/genai is base64 encoded
    const binaryString = atob(data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Convert Uint8Array to base64 string.
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
