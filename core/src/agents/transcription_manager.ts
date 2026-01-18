/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Transcription} from '@google/genai';

import {createEvent, Event} from '../events/event.js';
import {logger} from '../utils/logger.js';

import {InvocationContext} from './invocation_context.js';

/**
 * Manages transcription events for live streaming flows.
 *
 * The TranscriptionManager handles both input (user) and output (model)
 * transcriptions, creating Event objects that can be saved to the session
 * for later retrieval and processing.
 */
export class TranscriptionManager {
  /**
   * Handle user input transcription events.
   *
   * Creates a transcription event with the user's transcribed audio
   * and returns it for session storage.
   *
   * @param invocationContext - The current invocation context.
   * @param transcription - The transcription data from user input.
   * @returns The created transcription event.
   */
  async handleInputTranscription(
      invocationContext: InvocationContext,
      transcription: Transcription,
  ): Promise<Event> {
    return this.createAndSaveTranscriptionEvent(
        invocationContext,
        transcription,
        'user',
        true,
    );
  }

  /**
   * Handle model output transcription events.
   *
   * Creates a transcription event with the model's transcribed audio
   * and returns it for session storage.
   *
   * @param invocationContext - The current invocation context.
   * @param transcription - The transcription data from model output.
   * @returns The created transcription event.
   */
  async handleOutputTranscription(
      invocationContext: InvocationContext,
      transcription: Transcription,
  ): Promise<Event> {
    return this.createAndSaveTranscriptionEvent(
        invocationContext,
        transcription,
        invocationContext.agent.name,
        false,
    );
  }

  /**
   * Create and save a transcription event to session service.
   *
   * @param invocationContext - The current invocation context.
   * @param transcription - The transcription data.
   * @param author - The author of the transcription event.
   * @param isInput - Whether this is an input (user) or output (model)
   *   transcription.
   * @returns The created transcription event.
   * @throws If the transcription event cannot be created.
   */
  private async createAndSaveTranscriptionEvent(
      invocationContext: InvocationContext,
      transcription: Transcription,
      author: string,
      isInput: boolean,
  ): Promise<Event> {
    try {
      const transcriptionEvent = createEvent({
        invocationId: invocationContext.invocationId,
        author,
        inputTranscription: isInput ? transcription : undefined,
        outputTranscription: isInput ? undefined : transcription,
        timestamp: Date.now(),
      });

      const transcriptionText =
          transcription.text ?? 'audio transcription';

      logger.debug(
          `Saved ${isInput ? 'input' : 'output'} transcription event for ${
              author}: ${transcriptionText}`,
      );

      return transcriptionEvent;
    } catch (error) {
      logger.error(
          `Failed to save ${isInput ? 'input' : 'output'} transcription event`,
          error,
      );
      throw error;
    }
  }

  /**
   * Get statistics about transcription events in the session.
   *
   * @param invocationContext - The current invocation context.
   * @returns Dictionary containing transcription statistics.
   */
  getTranscriptionStats(invocationContext: InvocationContext): {
    inputTranscriptions: number;
    outputTranscriptions: number;
    totalTranscriptions: number;
  } {
    let inputCount = 0;
    let outputCount = 0;

    for (const event of invocationContext.session.events) {
      if (event.inputTranscription) {
        inputCount++;
      }
      if (event.outputTranscription) {
        outputCount++;
      }
    }

    return {
      inputTranscriptions: inputCount,
      outputTranscriptions: outputCount,
      totalTranscriptions: inputCount + outputCount,
    };
  }
}
