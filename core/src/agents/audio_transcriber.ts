/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Blob, Content, Part} from '@google/genai';

import {logger} from '../utils/logger.js';

import {InvocationContext} from './invocation_context.js';
import {TranscriptionEntry} from './transcription_entry.js';

/**
 * Interface for speech-to-text client implementations.
 *
 * This allows for different speech recognition backends to be used
 * (e.g., Google Cloud Speech-to-Text, browser Web Speech API, etc.)
 */
export interface SpeechClient {
  /**
   * Transcribe audio data to text.
   *
   * @param audioData - The raw audio bytes.
   * @param config - Configuration for the recognition.
   * @returns The transcribed text, or undefined if no speech was detected.
   */
  recognize(
      audioData: Uint8Array,
      config: SpeechRecognitionConfig,
  ): Promise<string | undefined>;
}

/**
 * Configuration for speech recognition.
 */
export interface SpeechRecognitionConfig {
  /**
   * Audio encoding (e.g., 'LINEAR16', 'FLAC', 'MP3').
   * @default 'LINEAR16'
   */
  encoding?: string;

  /**
   * Sample rate in hertz.
   * @default 16000
   */
  sampleRateHertz?: number;

  /**
   * Language code for recognition (e.g., 'en-US').
   * @default 'en-US'
   */
  languageCode?: string;
}

const DEFAULT_SPEECH_CONFIG: Required<SpeechRecognitionConfig> = {
  encoding: 'LINEAR16',
  sampleRateHertz: 16000,
  languageCode: 'en-US',
};

/**
 * Transcribes audio using a configurable speech-to-text client.
 *
 * The AudioTranscriber handles bundling consecutive audio segments from
 * the same speaker to reduce transcription latency, then transcribes
 * them to text content objects.
 */
export class AudioTranscriber {
  private readonly client?: SpeechClient;
  private readonly config: Required<SpeechRecognitionConfig>;

  /**
   * Initialize the audio transcriber.
   *
   * @param client - Optional speech client for transcription.
   *   If not provided, transcription will not be performed.
   * @param config - Configuration for speech recognition.
   */
  constructor(client?: SpeechClient, config?: SpeechRecognitionConfig) {
    this.client = client;
    this.config = {...DEFAULT_SPEECH_CONFIG, ...config};
  }

  /**
   * Transcribe audio, bundling consecutive segments from the same speaker.
   *
   * The ordering of speakers will be preserved. Audio blobs will be merged
   * for the same speaker as much as possible to reduce transcription latency.
   *
   * @param invocationContext - The invocation context to access the
   *   transcription cache.
   * @returns A list of Content objects containing the transcribed text.
   */
  async transcribeFile(invocationContext: InvocationContext): Promise<Content[]> {
    const transcriptionCache = invocationContext.transcriptionCache ?? [];

    if (transcriptionCache.length === 0) {
      return [];
    }

    // Step 1: Bundle audio blobs by speaker
    const bundledAudio = this.bundleAudioBySpeaker(transcriptionCache);

    // Reset the cache
    invocationContext.transcriptionCache = [];

    // Step 2: Transcribe each bundle
    const contents: Content[] = [];

    for (const [speaker, data] of bundledAudio) {
      if (data instanceof Uint8Array) {
        // Audio data that needs transcription
        const transcript = await this.transcribeAudio(data);
        if (transcript) {
          const parts: Part[] = [{text: transcript}];
          const role = speaker.toLowerCase() as 'user' | 'model';
          const content: Content = {role, parts};
          contents.push(content);
        }
      } else {
        // Already text content, no transcription needed
        contents.push(data);
      }
    }

    return contents;
  }

  /**
   * Bundle transcription entries by speaker.
   *
   * Consecutive audio from the same speaker is merged into a single
   * Uint8Array. Content entries are preserved as-is.
   *
   * @param transcriptionCache - The transcription cache entries.
   * @returns Array of tuples with [speaker, data] where data is either
   *   Uint8Array (merged audio) or Content (existing text).
   */
  private bundleAudioBySpeaker(
      transcriptionCache: TranscriptionEntry[],
  ): Array<[string, Uint8Array | Content]> {
    const bundledAudio: Array<[string, Uint8Array | Content]> = [];
    let currentSpeaker: string | undefined;
    const currentAudioChunks: Uint8Array[] = [];

    const flushCurrentAudio = () => {
      if (currentSpeaker !== undefined && currentAudioChunks.length > 0) {
        // Merge all chunks
        const totalLength = currentAudioChunks.reduce(
            (sum, chunk) => sum + chunk.length, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of currentAudioChunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        bundledAudio.push([currentSpeaker, merged]);
        currentAudioChunks.length = 0;
      }
    };

    for (const entry of transcriptionCache) {
      const speaker = entry.role ?? 'unknown';
      const data = entry.data;

      // Check if data is Content (has parts property)
      if ('parts' in data) {
        // It's Content - flush current audio and add the content
        flushCurrentAudio();
        currentSpeaker = undefined;
        bundledAudio.push([speaker, data as Content]);
        continue;
      }

      // It's a Blob
      const blob = data as Blob;
      if (!blob.data) {
        continue;
      }

      const audioBytes = this.toUint8Array(blob.data);

      if (speaker === currentSpeaker) {
        // Same speaker, accumulate
        currentAudioChunks.push(audioBytes);
      } else {
        // Different speaker, flush previous and start new
        flushCurrentAudio();
        currentSpeaker = speaker;
        currentAudioChunks.push(audioBytes);
      }
    }

    // Flush any remaining audio
    flushCurrentAudio();

    return bundledAudio;
  }

  /**
   * Transcribe audio data to text using the configured client.
   *
   * @param audioData - The raw audio bytes.
   * @returns The transcribed text, or undefined if no client or no speech.
   */
  private async transcribeAudio(audioData: Uint8Array): Promise<string | undefined> {
    if (!this.client) {
      logger.warn(
          'No speech client configured - audio transcription skipped');
      return undefined;
    }

    try {
      const transcript = await this.client.recognize(audioData, this.config);
      return transcript;
    } catch (error) {
      logger.error('Failed to transcribe audio', error);
      return undefined;
    }
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
}

/**
 * A no-op speech client that returns undefined for all transcriptions.
 *
 * Useful for testing or when speech transcription is not needed.
 */
export class NoOpSpeechClient implements SpeechClient {
  async recognize(): Promise<undefined> {
    return undefined;
  }
}
