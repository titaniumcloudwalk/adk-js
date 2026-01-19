/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, Session} from '@google/genai';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {GeminiLlmConnection} from '../../src/models/gemini_llm_connection.js';

describe('GeminiLlmConnection', () => {
  describe('sendHistory', () => {
    let mockSession: {
      sendClientContent: ReturnType<typeof vi.fn>;
      sendToolResponse: ReturnType<typeof vi.fn>;
      sendRealtimeInput: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    let connection: GeminiLlmConnection;

    beforeEach(() => {
      mockSession = {
        sendClientContent: vi.fn(),
        sendToolResponse: vi.fn(),
        sendRealtimeInput: vi.fn(),
        close: vi.fn(),
      };
      connection = new GeminiLlmConnection(mockSession as unknown as Session);
    });

    it('filters out audio parts from inline data', async () => {
      const history: Content[] = [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: 'base64audio',
                mimeType: 'audio/pcm',
              },
            },
          ],
        },
        {
          role: 'model',
          parts: [{text: 'I heard you'}],
        },
      ];

      await connection.sendHistory(history);

      expect(mockSession.sendClientContent).toHaveBeenCalledTimes(1);
      const callArgs = mockSession.sendClientContent.mock.calls[0][0];
      // Only the model response should be sent (user audio filtered out)
      expect(callArgs.turns).toHaveLength(1);
      expect(callArgs.turns[0].role).toBe('model');
      expect(callArgs.turns[0].parts).toEqual([{text: 'I heard you'}]);
    });

    it('filters out audio parts from file data', async () => {
      const history: Content[] = [
        {
          role: 'user',
          parts: [
            {
              fileData: {
                fileUri: 'artifact://app/user/session/_adk_live/audio.pcm#1',
                mimeType: 'audio/pcm',
              },
            },
          ],
        },
        {
          role: 'model',
          parts: [{text: 'Response text'}],
        },
      ];

      await connection.sendHistory(history);

      expect(mockSession.sendClientContent).toHaveBeenCalledTimes(1);
      const callArgs = mockSession.sendClientContent.mock.calls[0][0];
      expect(callArgs.turns).toHaveLength(1);
      expect(callArgs.turns[0].role).toBe('model');
    });

    it('keeps image data and does not filter it out', async () => {
      const imageBlob = {
        data: 'base64pngdata',
        mimeType: 'image/png',
      };
      const history: Content[] = [
        {
          role: 'user',
          parts: [{inlineData: imageBlob}],
        },
        {
          role: 'model',
          parts: [{text: 'Nice image!'}],
        },
      ];

      await connection.sendHistory(history);

      expect(mockSession.sendClientContent).toHaveBeenCalledTimes(1);
      const callArgs = mockSession.sendClientContent.mock.calls[0][0];
      // Both contents should be sent (image is not filtered)
      expect(callArgs.turns).toHaveLength(2);
      expect(callArgs.turns[0].parts[0].inlineData).toEqual(imageBlob);
    });

    it('filters only audio from mixed content', async () => {
      const history: Content[] = [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: 'base64audio',
                mimeType: 'audio/wav',
              },
            },
            {text: 'transcribed text'},
          ],
        },
      ];

      await connection.sendHistory(history);

      expect(mockSession.sendClientContent).toHaveBeenCalledTimes(1);
      const callArgs = mockSession.sendClientContent.mock.calls[0][0];
      // Content should be sent but only with the text part
      expect(callArgs.turns).toHaveLength(1);
      expect(callArgs.turns[0].parts).toHaveLength(1);
      expect(callArgs.turns[0].parts[0].text).toBe('transcribed text');
    });

    it('does not call sendClientContent when all content is audio', async () => {
      const history: Content[] = [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: 'base64audio',
                mimeType: 'audio/pcm',
              },
            },
            {
              fileData: {
                fileUri: 'artifact://audio.pcm#1',
                mimeType: 'audio/wav',
              },
            },
          ],
        },
      ];

      await connection.sendHistory(history);

      // No content should be sent since all parts are audio
      expect(mockSession.sendClientContent).not.toHaveBeenCalled();
    });

    it('does not call sendClientContent for empty history', async () => {
      await connection.sendHistory([]);

      expect(mockSession.sendClientContent).not.toHaveBeenCalled();
    });

    it('filters various audio mime types', async () => {
      const audioMimeTypes = [
        'audio/pcm',
        'audio/wav',
        'audio/mp3',
        'audio/ogg',
      ];

      for (const mimeType of audioMimeTypes) {
        mockSession.sendClientContent.mockClear();
        const history: Content[] = [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  data: 'audiodata',
                  mimeType,
                },
              },
            ],
          },
        ];

        await connection.sendHistory(history);

        // No content should be sent since the only part is audio
        expect(mockSession.sendClientContent).not.toHaveBeenCalled();
      }
    });

    it('sets turnComplete to true when last content is from user', async () => {
      const history: Content[] = [
        {
          role: 'model',
          parts: [{text: 'Hello'}],
        },
        {
          role: 'user',
          parts: [{text: 'Hi'}],
        },
      ];

      await connection.sendHistory(history);

      expect(mockSession.sendClientContent).toHaveBeenCalledTimes(1);
      const callArgs = mockSession.sendClientContent.mock.calls[0][0];
      expect(callArgs.turnComplete).toBe(true);
    });

    it('sets turnComplete to false when last content is from model', async () => {
      const history: Content[] = [
        {
          role: 'user',
          parts: [{text: 'Hello'}],
        },
        {
          role: 'model',
          parts: [{text: 'Hi'}],
        },
      ];

      await connection.sendHistory(history);

      expect(mockSession.sendClientContent).toHaveBeenCalledTimes(1);
      const callArgs = mockSession.sendClientContent.mock.calls[0][0];
      expect(callArgs.turnComplete).toBe(false);
    });
  });
});
