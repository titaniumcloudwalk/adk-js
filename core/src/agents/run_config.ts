/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {AudioTranscriptionConfig, ContextWindowCompressionConfig, Modality, ProactivityConfig, RealtimeInputConfig, SessionResumptionConfig, SpeechConfig} from '@google/genai';

import {logger} from '../utils/logger.js';

/**
 * The streaming mode for the run config.
 */
export enum StreamingMode {
  NONE = 'none',
  SSE = 'sse',
  BIDI = 'bidi',
}

/**
 * Configs for runtime behavior of agents.
 */
export interface RunConfig {
  /**
   * Speech configuration for the live agent.
   */
  speechConfig?: SpeechConfig;

  /**
   * The output modalities. If not set, it's default to AUDIO.
   */
  responseModalities?: Modality[];

  /**
   * Whether or not to save the input blobs as artifacts.
   */
  saveInputBlobsAsArtifacts?: boolean;

  /**
   * Whether to support CFC (Compositional Function Calling). Only applicable
   * for StreamingMode.SSE. If it's true. the LIVE API will be invoked. Since
   * only LIVE API supports CFC
   *
   * WARNING: This feature is **experimental** and its API or behavior may
   * change in future releases.
   */
  supportCfc?: boolean;

  /**
   * Streaming mode, None or StreamingMode.SSE or StreamingMode.BIDI.
   */
  streamingMode?: StreamingMode;

  /**
   * Output audio transcription config.
   */
  outputAudioTranscription?: AudioTranscriptionConfig;

  /**
   * Input transcription for live agents with audio input from user.
   */
  inputAudioTranscription?: AudioTranscriptionConfig;

  /**
   * If enabled, the model will detect emotions and adapt its responses
   * accordingly.
   */
  enableAffectiveDialog?: boolean;

  /**
   * Configures the proactivity of the model. This allows the model to respond
   * proactively to the input and to ignore irrelevant input.
   */
  proactivity?: ProactivityConfig;

  /**
   * Realtime input config for live agents with audio input from user.
   */
  realtimeInputConfig?: RealtimeInputConfig;

  /**
   * Configures session resumption mechanism. Only supports transparent
   * session resumption mode currently.
   */
  sessionResumption?: SessionResumptionConfig;

  /**
   * Configuration for context window compression. If set, this will
   * enable context window compression for LLM input.
   */
  contextWindowCompression?: ContextWindowCompressionConfig;

  /**
   * Saves live video and audio data to session and artifact service.
   */
  saveLiveBlob?: boolean;

  /**
   * @deprecated Use saveLiveBlob instead. If set to true, it saves
   * live video and audio data to session and artifact service.
   */
  saveLiveAudio?: boolean;

  /**
   * Custom metadata for the current invocation. This can be used by plugins,
   * A2A protocol, and other components to store invocation-specific data.
   */
  customMetadata?: Record<string, unknown>;

  /**
   * A limit on the total number of llm calls for a given run.
   *
   * Valid Values:
   *   - More than 0 and less than sys.maxsize: The bound on the number of llm
   *     calls is enforced, if the value is set in this range.
   *   - Less than or equal to 0: This allows for unbounded number of llm calls.
   */
  maxLlmCalls?: number;
}

function warnDeprecated(field: string, replacement: string): void {
  logger.warn(
    `The '${field}' config is deprecated and will be removed in a future ` +
    `release. Please use '${replacement}' instead.`
  );
}

export function createRunConfig(params: Partial<RunConfig> = {}): RunConfig {
  // Handle deprecated saveLiveAudio field - migrate to saveLiveBlob
  let saveLiveBlob = params.saveLiveBlob ?? false;
  if (params.saveLiveAudio !== undefined) {
    warnDeprecated('saveLiveAudio', 'saveLiveBlob');
    if (params.saveLiveAudio) {
      saveLiveBlob = true;
    }
  }

  // Warn if deprecated saveInputBlobsAsArtifacts is used
  if (params.saveInputBlobsAsArtifacts === true) {
    warnDeprecated('saveInputBlobsAsArtifacts', 'artifact handling in tool context');
  }

  return {
    saveInputBlobsAsArtifacts: false,
    supportCfc: false,
    enableAffectiveDialog: false,
    streamingMode: StreamingMode.NONE,
    saveLiveBlob,
    maxLlmCalls: validateMaxLlmCalls(params.maxLlmCalls ?? 500),
    ...params,
  };
}

function validateMaxLlmCalls(value: number): number {
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new Error(
        `maxLlmCalls should be less than ${Number.MAX_SAFE_INTEGER}.`,
    );
  }

  if (value <= 0) {
    logger.warn(
        'maxLlmCalls is less than or equal to 0. This will result in no enforcement on total number of llm calls that will be made for a run. This may not be ideal, as this could result in a never ending communication between the model and the agent in certain cases.');
  }
  return value;
}