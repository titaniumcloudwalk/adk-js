/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {CallbackContext, ContextFilterPlugin, LlmRequest} from '@google/adk';
import {Content} from '@google/genai';

describe('ContextFilterPlugin', () => {
  // Helper to create Content objects
  const createContent = (
    role: 'user' | 'model',
    text: string,
  ): Content => ({
    role,
    parts: [{text}],
  });

  // Helper to create Content with function call
  const createFunctionCall = (
    callId: string,
    functionName: string,
  ): Content => ({
    role: 'model',
    parts: [
      {
        functionCall: {
          id: callId,
          name: functionName,
          args: {},
        },
      },
    ],
  });

  // Helper to create Content with function response
  const createFunctionResponse = (
    callId: string,
    functionName: string,
    responseText: string,
  ): Content => ({
    role: 'user',
    parts: [
      {
        functionResponse: {
          id: callId,
          name: functionName,
          response: {result: responseText},
        },
      },
    ],
  });

  const mockCallbackContext = {} as CallbackContext;

  const createMockLlmRequest = (contents: Content[]): LlmRequest => ({
    contents,
    toolsDict: {},
    liveConnectConfig: {},
  });

  describe('initialization', () => {
    it('should initialize with default name', () => {
      const plugin = new ContextFilterPlugin();
      expect(plugin.name).toEqual('context_filter_plugin');
    });

    it('should initialize with custom name', () => {
      const plugin = new ContextFilterPlugin({name: 'my_filter'});
      expect(plugin.name).toEqual('my_filter');
    });

    it('should accept numInvocationsToKeep option', () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 5});
      expect(plugin.name).toEqual('context_filter_plugin');
    });

    it('should accept customFilter option', () => {
      const customFilter = (contents: Content[]) => contents;
      const plugin = new ContextFilterPlugin({customFilter});
      expect(plugin.name).toEqual('context_filter_plugin');
    });
  });

  describe('invocation-based filtering', () => {
    it('should not filter when numInvocationsToKeep is not set', async () => {
      const plugin = new ContextFilterPlugin();
      const contents: Content[] = [
        createContent('user', 'message 1'),
        createContent('model', 'response 1'),
        createContent('user', 'message 2'),
        createContent('model', 'response 2'),
        createContent('user', 'message 3'),
        createContent('model', 'response 3'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      expect(llmRequest.contents.length).toEqual(6);
    });

    it('should keep all content when model turns are less than numInvocationsToKeep', async () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 5});
      const contents: Content[] = [
        createContent('user', 'message 1'),
        createContent('model', 'response 1'),
        createContent('user', 'message 2'),
        createContent('model', 'response 2'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      expect(llmRequest.contents.length).toEqual(4);
    });

    it('should filter to keep only the last N invocations', async () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 2});
      const contents: Content[] = [
        createContent('user', 'message 1'),
        createContent('model', 'response 1'),
        createContent('user', 'message 2'),
        createContent('model', 'response 2'),
        createContent('user', 'message 3'),
        createContent('model', 'response 3'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      // Should keep last 2 model turns with their preceding user messages
      expect(llmRequest.contents.length).toEqual(4);
      expect((llmRequest.contents[0].parts![0] as {text: string}).text).toEqual(
        'message 2',
      );
      expect((llmRequest.contents[1].parts![0] as {text: string}).text).toEqual(
        'response 2',
      );
      expect((llmRequest.contents[2].parts![0] as {text: string}).text).toEqual(
        'message 3',
      );
      expect((llmRequest.contents[3].parts![0] as {text: string}).text).toEqual(
        'response 3',
      );
    });

    it('should include consecutive user messages before a model turn', async () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 1});
      const contents: Content[] = [
        createContent('user', 'message 1'),
        createContent('model', 'response 1'),
        createContent('user', 'message 2a'),
        createContent('user', 'message 2b'),
        createContent('user', 'message 2c'),
        createContent('model', 'response 2'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      // Should keep the last model turn with all preceding user messages
      expect(llmRequest.contents.length).toEqual(4);
      expect((llmRequest.contents[0].parts![0] as {text: string}).text).toEqual(
        'message 2a',
      );
      expect((llmRequest.contents[1].parts![0] as {text: string}).text).toEqual(
        'message 2b',
      );
      expect((llmRequest.contents[2].parts![0] as {text: string}).text).toEqual(
        'message 2c',
      );
      expect((llmRequest.contents[3].parts![0] as {text: string}).text).toEqual(
        'response 2',
      );
    });

    it('should handle numInvocationsToKeep = 0 as no filtering', async () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 0});
      const contents: Content[] = [
        createContent('user', 'message 1'),
        createContent('model', 'response 1'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      expect(llmRequest.contents.length).toEqual(2);
    });
  });

  describe('function call/response preservation', () => {
    it('should preserve function call and response pairs', async () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 1});
      const contents: Content[] = [
        createContent('user', 'message 1'),
        createFunctionCall('call-1', 'search'),
        createFunctionResponse('call-1', 'search', 'results'),
        createContent('model', 'response 1'),
        createContent('user', 'message 2'),
        createContent('model', 'response 2'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      // Should keep the last model turn
      expect(llmRequest.contents.length).toEqual(2);
      expect((llmRequest.contents[0].parts![0] as {text: string}).text).toEqual(
        'message 2',
      );
      expect((llmRequest.contents[1].parts![0] as {text: string}).text).toEqual(
        'response 2',
      );
    });

    it('should not orphan function responses by moving split index back', async () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 1});
      const contents: Content[] = [
        createContent('user', 'message 1'),
        createContent('model', 'response 1'),
        createFunctionCall('call-1', 'search'),
        createFunctionResponse('call-1', 'search', 'results'),
        createContent('model', 'response 2'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      // Should keep function call + response + model response (not orphaning the response)
      expect(llmRequest.contents.length).toEqual(3);
      // Should include the function call
      expect(llmRequest.contents[0].parts![0]).toHaveProperty('functionCall');
      // Should include the function response
      expect(llmRequest.contents[1].parts![0]).toHaveProperty('functionResponse');
      // Should include the model response
      expect((llmRequest.contents[2].parts![0] as {text: string}).text).toEqual(
        'response 2',
      );
    });

    it('should handle multiple function calls in sequence', async () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 1});
      const contents: Content[] = [
        createContent('user', 'message 1'),
        createContent('model', 'response 1'),
        createFunctionCall('call-1', 'search1'),
        createFunctionResponse('call-1', 'search1', 'results1'),
        createFunctionCall('call-2', 'search2'),
        createFunctionResponse('call-2', 'search2', 'results2'),
        createContent('model', 'final response'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      // Should keep the second function call pair + model response (3 items)
      // The algorithm moves split back to ensure no orphaned function responses,
      // but since call-2's response comes after call-2's call, they stay paired
      expect(llmRequest.contents.length).toEqual(3);
      // Should have: func_call2, func_resp2, final response
      expect(llmRequest.contents[0].parts![0]).toHaveProperty('functionCall');
      expect(llmRequest.contents[1].parts![0]).toHaveProperty('functionResponse');
      expect((llmRequest.contents[2].parts![0] as {text: string}).text).toEqual(
        'final response',
      );
    });
  });

  describe('custom filter', () => {
    it('should apply custom filter function', async () => {
      const customFilter = (contents: Content[]) =>
        contents.filter((c) => c.role === 'model');
      const plugin = new ContextFilterPlugin({customFilter});
      const contents: Content[] = [
        createContent('user', 'message 1'),
        createContent('model', 'response 1'),
        createContent('user', 'message 2'),
        createContent('model', 'response 2'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      expect(llmRequest.contents.length).toEqual(2);
      expect(llmRequest.contents.every((c) => c.role === 'model')).toBe(true);
    });

    it('should apply custom filter after invocation-based filtering', async () => {
      // Custom filter removes messages containing 'skip'
      const customFilter = (contents: Content[]) =>
        contents.filter(
          (c) =>
            !c.parts?.some(
              (p) => 'text' in p && (p as {text: string}).text.includes('skip'),
            ),
        );
      const plugin = new ContextFilterPlugin({
        numInvocationsToKeep: 2,
        customFilter,
      });
      const contents: Content[] = [
        createContent('user', 'message 1'),
        createContent('model', 'response 1'),
        createContent('user', 'message 2 skip this'),
        createContent('model', 'response 2'),
        createContent('user', 'message 3'),
        createContent('model', 'response 3'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      // First filtered by invocation to 4 items, then custom filter removes the 'skip' message
      expect(llmRequest.contents.length).toEqual(3);
      expect(
        llmRequest.contents.every(
          (c) =>
            !c.parts?.some(
              (p) =>
                'text' in p && (p as {text: string}).text.includes('skip'),
            ),
        ),
      ).toBe(true);
    });

    it('should handle empty result from custom filter', async () => {
      const customFilter = () => [] as Content[];
      const plugin = new ContextFilterPlugin({customFilter});
      const contents: Content[] = [
        createContent('user', 'message 1'),
        createContent('model', 'response 1'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      expect(llmRequest.contents.length).toEqual(0);
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully and not throw', async () => {
      const customFilter = () => {
        throw new Error('Custom filter error');
      };
      const plugin = new ContextFilterPlugin({customFilter});
      const contents: Content[] = [
        createContent('user', 'message 1'),
        createContent('model', 'response 1'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      // Should not throw
      await expect(
        plugin.beforeModelCallback({
          callbackContext: mockCallbackContext,
          llmRequest,
        }),
      ).resolves.toBeUndefined();
    });

    it('should return undefined to allow normal execution', async () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 1});
      const llmRequest = createMockLlmRequest([
        createContent('user', 'message'),
        createContent('model', 'response'),
      ]);

      const result = await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle empty contents', async () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 1});
      const llmRequest = createMockLlmRequest([]);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      expect(llmRequest.contents.length).toEqual(0);
    });

    it('should handle contents with only user messages', async () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 1});
      const contents: Content[] = [
        createContent('user', 'message 1'),
        createContent('user', 'message 2'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      // No model turns, so nothing should be filtered
      expect(llmRequest.contents.length).toEqual(2);
    });

    it('should handle contents with only model messages', async () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 1});
      const contents: Content[] = [
        createContent('model', 'response 1'),
        createContent('model', 'response 2'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      // Should keep last N model turns (no user messages to include)
      expect(llmRequest.contents.length).toEqual(1);
      expect((llmRequest.contents[0].parts![0] as {text: string}).text).toEqual(
        'response 2',
      );
    });

    it('should handle content with undefined parts', async () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 1});
      const contents: Content[] = [
        {role: 'user'} as Content,
        createContent('model', 'response 1'),
        createContent('user', 'message 2'),
        createContent('model', 'response 2'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      // Should handle gracefully
      expect(llmRequest.contents.length).toEqual(2);
    });

    it('should handle single invocation exactly at limit', async () => {
      const plugin = new ContextFilterPlugin({numInvocationsToKeep: 1});
      const contents: Content[] = [
        createContent('user', 'only message'),
        createContent('model', 'only response'),
      ];
      const llmRequest = createMockLlmRequest(contents);

      await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      expect(llmRequest.contents.length).toEqual(2);
    });
  });
});
