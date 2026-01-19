/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Blob,
  Content,
  FunctionResponse,
  LiveServerMessage,
  Session,
} from '@google/genai';

import {filterAudioParts} from '../utils/content_utils.js';
import {logger} from '../utils/logger.js';

import {BaseLlmConnection} from './base_llm_connection.js';
import {LlmResponse} from './llm_response.js';

/**
 * A pending promise that can be resolved externally.
 */
interface PendingPromise<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Creates a pending promise that can be resolved externally.
 */
function createPendingPromise<T>(): PendingPromise<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

/** The Gemini model connection. */
export class GeminiLlmConnection implements BaseLlmConnection {
  private readonly messageQueue: LiveServerMessage[] = [];
  private pendingGet?: PendingPromise<LiveServerMessage | null>;
  private closed = false;
  private inputTranscriptionText = '';
  private outputTranscriptionText = '';
  private geminiSession?: Session;

  constructor(geminiSession?: Session) {
    this.geminiSession = geminiSession;
  }

  /**
   * Sets the Gemini session.
   *
   * This is used when the connection needs to be created before the session
   * is available (e.g., for wiring up callbacks).
   *
   * @param session The Gemini session to set.
   */
  setSession(session: Session): void {
    this.geminiSession = session;
  }

  /**
   * Handles incoming messages from the Gemini session.
   *
   * This method is called by the Gemini SDK when a message is received.
   *
   * @param message The message received from the Gemini session.
   */
  onMessage(message: LiveServerMessage): void {
    if (this.pendingGet) {
      // If there's a pending receive, resolve it directly
      const pending = this.pendingGet;
      this.pendingGet = undefined;
      pending.resolve(message);
    } else {
      // Otherwise, queue the message
      this.messageQueue.push(message);
    }
  }

  /**
   * Signals that the connection has been closed.
   *
   * This method should be called when the session is closed or encounters an
   * error.
   */
  onClose(): void {
    this.closed = true;
    if (this.pendingGet) {
      const pending = this.pendingGet;
      this.pendingGet = undefined;
      pending.resolve(null);
    }
  }

  /**
   * Gets the next message from the queue, waiting if necessary.
   *
   * @returns The next message, or null if the connection is closed.
   */
  private async getNextMessage(): Promise<LiveServerMessage | null> {
    if (this.messageQueue.length > 0) {
      return this.messageQueue.shift()!;
    }

    if (this.closed) {
      return null;
    }

    // Wait for the next message
    this.pendingGet = createPendingPromise<LiveServerMessage | null>();
    return this.pendingGet.promise;
  }

  /**
   * Throws an error if the session is not initialized.
   */
  private ensureSession(): void {
    if (!this.geminiSession) {
      throw new Error('Gemini session is not initialized.');
    }
  }

  /**
   * Sends the conversation history to the gemini model.
   *
   * You call this method right after setting up the model connection.
   * The model will respond if the last content is from user, otherwise it will
   * wait for new user input before responding.
   *
   * Filter out audio parts from history because:
   * 1. Audio has already been transcribed.
   * 2. Sending audio via connection.send or connection.sendLiveContent is
   *    not supported by LIVE API (session will be corrupted).
   *
   * This method is called when:
   * 1. Agent transfer to a new agent
   * 2. Establishing a new live connection with previous ADK session history
   *
   * @param history The conversation history to send to the model.
   */
  async sendHistory(history: Content[]): Promise<void> {
    this.ensureSession();

    // Filter out audio parts, keeping other content (text, images, etc.)
    const contents = history
      .map((content) => filterAudioParts(content))
      .filter((content): content is Content => content !== null);

    if (contents.length > 0) {
      logger.debug('Sending history to live connection:', contents);
      this.geminiSession!.sendClientContent({
        turns: contents,
        turnComplete: contents[contents.length - 1].role === 'user',
      });
    }
  }

  /**
   * Sends a user content to the gemini model.
   *
   * The model will respond immediately upon receiving the content.
   * If you send function responses, all parts in the content should be function
   * responses.
   *
   * @param content The content to send to the model.
   */
  async sendContent(content: Content): Promise<void> {
    this.ensureSession();

    if (!content.parts) {
      throw new Error('Content must have parts.');
    }
    if (content.parts[0].functionResponse) {
      // All parts have to be function responses.
      const functionResponses = content.parts
        .map((part) => part.functionResponse)
        .filter((fr): fr is FunctionResponse => !!fr);
      logger.debug('Sending LLM function response:', functionResponses);
      this.geminiSession!.sendToolResponse({
        functionResponses,
      });
    } else {
      logger.debug('Sending LLM new content', content);
      this.geminiSession!.sendClientContent({
        turns: [content],
        turnComplete: true,
      });
    }
  }

  /**
   * Sends a chunk of audio or a frame of video to the model in realtime.
   *
   * @param blob The blob to send to the model.
   */
  async sendRealtime(blob: Blob): Promise<void> {
    this.ensureSession();

    logger.debug('Sending LLM Blob:', blob);
    this.geminiSession!.sendRealtimeInput({media: blob});
  }

  /**
   * Builds a full text response.
   *
   * The text should not be partial and the returned LlmResponse is not be
   * partial.
   *
   * @param text The text to be included in the response.
   * @returns An LlmResponse containing the full text.
   */
  private buildFullTextResponse(text: string): LlmResponse {
    return {
      content: {
        role: 'model',
        parts: [{text}],
      },
    };
  }

  /**
   * Receives the model response using the llm server connection.
   *
   * This method yields LlmResponse objects as they are received from the model.
   * Text responses are accumulated and yielded when a non-text response is
   * received. Transcription text is also accumulated and included in the
   * response.
   *
   * @yields LlmResponse objects containing model responses.
   */
  async *receive(): AsyncGenerator<LlmResponse, void, void> {
    let text = '';

    while (true) {
      const message = await this.getNextMessage();

      if (!message) {
        // Connection closed
        break;
      }

      logger.debug('Got LLM Live message:', message);

      // Handle usage metadata
      if (message.usageMetadata) {
        yield {
          usageMetadata: message.usageMetadata,
        };
      }

      // Handle server content
      if (message.serverContent) {
        const content = message.serverContent.modelTurn;

        if (content?.parts) {
          const llmResponse: LlmResponse = {
            content: content,
            interrupted: message.serverContent.interrupted,
          };

          if (content.parts[0]?.text) {
            text += content.parts[0].text;
            llmResponse.partial = true;
          } else if (text && !content.parts[0]?.inlineData) {
            // Yield accumulated text before non-text response
            yield this.buildFullTextResponse(text);
            text = '';
          }
          yield llmResponse;
        }

        // Handle input transcription
        if (message.serverContent.inputTranscription) {
          if (message.serverContent.inputTranscription.text) {
            this.inputTranscriptionText +=
              message.serverContent.inputTranscription.text;
          }
          // Yield transcription response
          yield {
            inputTranscription: {
              text: this.inputTranscriptionText,
              finished: message.serverContent.inputTranscription.finished,
            },
            content: {
              role: 'user',
              parts: [{text: this.inputTranscriptionText}],
            },
            partial: !message.serverContent.inputTranscription.finished,
          };
          // Reset if finished
          if (message.serverContent.inputTranscription.finished) {
            this.inputTranscriptionText = '';
          }
        }

        // Handle output transcription
        if (message.serverContent.outputTranscription) {
          if (message.serverContent.outputTranscription.text) {
            this.outputTranscriptionText +=
              message.serverContent.outputTranscription.text;
          }
          // Yield transcription response
          yield {
            outputTranscription: {
              text: this.outputTranscriptionText,
              finished: message.serverContent.outputTranscription.finished,
            },
            partial: !message.serverContent.outputTranscription.finished,
          };
          // Reset if finished
          if (message.serverContent.outputTranscription.finished) {
            this.outputTranscriptionText = '';
          }
        }

        // Check if generation is complete
        if (message.serverContent.generationComplete) {
          // Yield any remaining text
          if (text) {
            yield this.buildFullTextResponse(text);
            text = '';
          }
        }

        // Check for turn completion
        if (message.serverContent.turnComplete) {
          // Yield any remaining text
          if (text) {
            yield this.buildFullTextResponse(text);
            text = '';
          }
        }
      }

      // Handle tool call
      if (message.toolCall) {
        // Yield any remaining text before tool call
        if (text) {
          yield this.buildFullTextResponse(text);
          text = '';
        }

        yield {
          content: {
            role: 'model',
            parts: message.toolCall.functionCalls?.map((fc) => ({
              functionCall: fc,
            })) ?? [],
          },
        };
      }

      // Handle tool call cancellation
      if (message.toolCallCancellation) {
        yield {
          interrupted: true,
          customMetadata: {
            toolCallCancellation: message.toolCallCancellation,
          },
        };
      }

      // Handle session resumption update
      if (message.sessionResumptionUpdate) {
        yield {
          liveSessionResumptionUpdate: message.sessionResumptionUpdate,
        };
      }
    }

    // Yield any remaining accumulated text
    if (text) {
      yield this.buildFullTextResponse(text);
    }
  }

  /**
   * Closes the llm server connection.
   */
  async close(): Promise<void> {
    this.closed = true;
    if (this.pendingGet) {
      const pending = this.pendingGet;
      this.pendingGet = undefined;
      pending.resolve(null);
    }
    if (this.geminiSession) {
      this.geminiSession.close();
    }
  }
}
