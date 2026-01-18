/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Part} from '@google/genai';
import {expect} from 'chai';

import {CallbackContext} from '../../src/agents/callback_context.js';
import {InvocationContext} from '../../src/agents/invocation_context.js';
import {LlmRequest} from '../../src/models/llm_request.js';
import {
  MultimodalToolResultsPlugin,
  PARTS_RETURNED_BY_TOOLS_ID,
} from '../../src/plugins/multimodal_tool_results_plugin.js';
import {Session} from '../../src/sessions/session.js';
import {State} from '../../src/sessions/state.js';
import {BaseTool} from '../../src/tools/base_tool.js';
import {ToolContext} from '../../src/tools/tool_context.js';

describe('MultimodalToolResultsPlugin', () => {
  let plugin: MultimodalToolResultsPlugin;
  let mockTool: BaseTool;
  let state: State;
  let toolContext: ToolContext;
  let callbackContext: CallbackContext;

  beforeEach(() => {
    plugin = new MultimodalToolResultsPlugin();
    mockTool = {
      name: 'test_tool',
      description: 'A test tool',
    } as BaseTool;

    state = new State({});

    // Create minimal mock invocation context
    const mockInvocationContext = {
      session: {
        id: 'test-session',
        appName: 'test-app',
        userId: 'test-user',
        state: state,
        events: [],
        lastUpdateTime: Date.now(),
      } as Session,
      invocationId: 'test-invocation',
      state: state,
      artifactService: undefined,
    } as unknown as InvocationContext;

    // Create tool context with the state
    toolContext = {
      state: state,
      invocationContext: mockInvocationContext,
      functionCallId: 'test-function-call-id',
    } as unknown as ToolContext;

    // Create callback context
    callbackContext = {
      state: state,
      invocationContext: mockInvocationContext,
    } as unknown as CallbackContext;
  });


  describe('constructor', () => {
    it('should use default name when no options provided', () => {
      const defaultPlugin = new MultimodalToolResultsPlugin();
      expect(defaultPlugin.name).to.equal('multimodal_tool_results_plugin');
    });

    it('should use custom name when provided', () => {
      const customPlugin = new MultimodalToolResultsPlugin({
        name: 'custom_multimodal_plugin',
      });
      expect(customPlugin.name).to.equal('custom_multimodal_plugin');
    });
  });

  describe('afterToolCallback', () => {
    it('should return non-Part results unchanged', async () => {
      const jsonResult = {status: 'success', data: 'test'};

      const result = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: jsonResult as unknown as Record<string, unknown>,
      });

      expect(result).to.deep.equal(jsonResult);
      expect(state.get(PARTS_RETURNED_BY_TOOLS_ID)).to.be.undefined;
    });

    it('should capture a single text Part', async () => {
      const textPart: Part = {text: 'Hello, world!'};

      const result = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: textPart as unknown as Record<string, unknown>,
      });

      expect(result).to.be.undefined;
      const savedParts = state.get(PARTS_RETURNED_BY_TOOLS_ID) as Part[];
      expect(savedParts).to.have.lengthOf(1);
      expect(savedParts[0]).to.deep.equal(textPart);
    });

    it('should capture a single inlineData Part', async () => {
      const imagePart: Part = {
        inlineData: {
          mimeType: 'image/png',
          data: 'base64encodeddata',
        },
      };

      const result = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: imagePart as unknown as Record<string, unknown>,
      });

      expect(result).to.be.undefined;
      const savedParts = state.get(PARTS_RETURNED_BY_TOOLS_ID) as Part[];
      expect(savedParts).to.have.lengthOf(1);
      expect(savedParts[0]).to.deep.equal(imagePart);
    });

    it('should capture a fileData Part', async () => {
      const filePart: Part = {
        fileData: {
          fileUri: 'gs://bucket/file.pdf',
          mimeType: 'application/pdf',
        },
      };

      const result = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: filePart as unknown as Record<string, unknown>,
      });

      expect(result).to.be.undefined;
      const savedParts = state.get(PARTS_RETURNED_BY_TOOLS_ID) as Part[];
      expect(savedParts).to.have.lengthOf(1);
      expect(savedParts[0]).to.deep.equal(filePart);
    });

    it('should capture an array of Parts', async () => {
      const parts: Part[] = [
        {text: 'Here is the screenshot:'},
        {
          inlineData: {
            mimeType: 'image/png',
            data: 'base64encodeddata',
          },
        },
      ];

      const result = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: parts as unknown as Record<string, unknown>,
      });

      expect(result).to.be.undefined;
      const savedParts = state.get(PARTS_RETURNED_BY_TOOLS_ID) as Part[];
      expect(savedParts).to.have.lengthOf(2);
      expect(savedParts).to.deep.equal(parts);
    });

    it('should append to existing parts', async () => {
      // First tool call
      const firstPart: Part = {text: 'First result'};
      await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: firstPart as unknown as Record<string, unknown>,
      });

      // Second tool call
      const secondPart: Part = {text: 'Second result'};
      await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: secondPart as unknown as Record<string, unknown>,
      });

      const savedParts = state.get(PARTS_RETURNED_BY_TOOLS_ID) as Part[];
      expect(savedParts).to.have.lengthOf(2);
      expect(savedParts[0]).to.deep.equal(firstPart);
      expect(savedParts[1]).to.deep.equal(secondPart);
    });

    it('should return undefined for null result', async () => {
      const result = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: null as unknown as Record<string, unknown>,
      });

      expect(result).to.be.null;
    });

    it('should return empty array unchanged', async () => {
      const emptyArray: Part[] = [];

      const result = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: emptyArray as unknown as Record<string, unknown>,
      });

      expect(result).to.deep.equal(emptyArray);
    });

    it('should capture functionCall Parts', async () => {
      const functionCallPart: Part = {
        functionCall: {
          name: 'some_function',
          args: {param: 'value'},
        },
      };

      const result = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: functionCallPart as unknown as Record<string, unknown>,
      });

      expect(result).to.be.undefined;
      const savedParts = state.get(PARTS_RETURNED_BY_TOOLS_ID) as Part[];
      expect(savedParts).to.have.lengthOf(1);
    });

    it('should capture executableCode Parts', async () => {
      const executableCodePart: Part = {
        executableCode: {
          language: 'PYTHON',
          code: 'print("hello")',
        },
      };

      const result = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: executableCodePart as unknown as Record<string, unknown>,
      });

      expect(result).to.be.undefined;
      const savedParts = state.get(PARTS_RETURNED_BY_TOOLS_ID) as Part[];
      expect(savedParts).to.have.lengthOf(1);
    });

    it('should capture codeExecutionResult Parts', async () => {
      const codeResultPart: Part = {
        codeExecutionResult: {
          outcome: 'OUTCOME_OK',
          output: 'hello',
        },
      };

      const result = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: codeResultPart as unknown as Record<string, unknown>,
      });

      expect(result).to.be.undefined;
      const savedParts = state.get(PARTS_RETURNED_BY_TOOLS_ID) as Part[];
      expect(savedParts).to.have.lengthOf(1);
    });

    it('should capture thought Parts', async () => {
      const thoughtPart: Part = {
        thought: true,
        text: 'Let me think about this...',
      };

      const result = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: thoughtPart as unknown as Record<string, unknown>,
      });

      expect(result).to.be.undefined;
      const savedParts = state.get(PARTS_RETURNED_BY_TOOLS_ID) as Part[];
      expect(savedParts).to.have.lengthOf(1);
    });
  });

  describe('beforeModelCallback', () => {
    it('should not modify request when no parts are saved', async () => {
      const llmRequest: LlmRequest = {
        contents: [
          {
            role: 'user',
            parts: [{text: 'Hello'}],
          },
        ],
      };

      const result = await plugin.beforeModelCallback({
        callbackContext,
        llmRequest,
      });

      expect(result).to.be.undefined;
      expect(llmRequest.contents![0].parts).to.have.lengthOf(1);
    });

    it('should append saved parts to the last content', async () => {
      // Save some parts first
      const savedParts: Part[] = [
        {
          inlineData: {
            mimeType: 'image/png',
            data: 'base64data',
          },
        },
      ];
      state.set(PARTS_RETURNED_BY_TOOLS_ID, savedParts);

      const llmRequest: LlmRequest = {
        contents: [
          {
            role: 'user',
            parts: [{text: 'Describe this image:'}],
          },
        ],
      };

      const result = await plugin.beforeModelCallback({
        callbackContext,
        llmRequest,
      });

      expect(result).to.be.undefined;
      expect(llmRequest.contents![0].parts).to.have.lengthOf(2);
      expect(llmRequest.contents![0].parts![0]).to.deep.equal({
        text: 'Describe this image:',
      });
      expect(llmRequest.contents![0].parts![1]).to.deep.equal(savedParts[0]);
    });

    it('should clear saved parts after appending', async () => {
      const savedParts: Part[] = [{text: 'Tool output'}];
      state.set(PARTS_RETURNED_BY_TOOLS_ID, savedParts);

      const llmRequest: LlmRequest = {
        contents: [
          {
            role: 'user',
            parts: [{text: 'Hello'}],
          },
        ],
      };

      await plugin.beforeModelCallback({
        callbackContext,
        llmRequest,
      });

      const clearedParts = state.get(PARTS_RETURNED_BY_TOOLS_ID) as Part[];
      expect(clearedParts).to.have.lengthOf(0);
    });

    it('should handle multiple saved parts', async () => {
      const savedParts: Part[] = [
        {text: 'Part 1'},
        {text: 'Part 2'},
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: 'base64',
          },
        },
      ];
      state.set(PARTS_RETURNED_BY_TOOLS_ID, savedParts);

      const llmRequest: LlmRequest = {
        contents: [
          {
            role: 'user',
            parts: [{text: 'Original'}],
          },
        ],
      };

      await plugin.beforeModelCallback({
        callbackContext,
        llmRequest,
      });

      expect(llmRequest.contents![0].parts).to.have.lengthOf(4);
    });

    it('should not modify empty contents array', async () => {
      const savedParts: Part[] = [{text: 'Saved'}];
      state.set(PARTS_RETURNED_BY_TOOLS_ID, savedParts);

      const llmRequest: LlmRequest = {
        contents: [],
      };

      const result = await plugin.beforeModelCallback({
        callbackContext,
        llmRequest,
      });

      expect(result).to.be.undefined;
      // Parts won't be appended since there's nothing to append to
      // But the lookup will still find the last element (which doesn't exist)
      // so contents remains unchanged (empty)
      expect(llmRequest.contents).to.have.lengthOf(0);
    });

    it('should handle undefined contents', async () => {
      const savedParts: Part[] = [{text: 'Saved'}];
      state.set(PARTS_RETURNED_BY_TOOLS_ID, savedParts);

      const llmRequest: LlmRequest = {};

      const result = await plugin.beforeModelCallback({
        callbackContext,
        llmRequest,
      });

      expect(result).to.be.undefined;
    });

    it('should append to multi-content requests', async () => {
      const savedParts: Part[] = [{text: 'Tool result'}];
      state.set(PARTS_RETURNED_BY_TOOLS_ID, savedParts);

      const llmRequest: LlmRequest = {
        contents: [
          {
            role: 'user',
            parts: [{text: 'First message'}],
          },
          {
            role: 'model',
            parts: [{text: 'Response'}],
          },
          {
            role: 'user',
            parts: [{text: 'Follow up'}],
          },
        ],
      };

      await plugin.beforeModelCallback({
        callbackContext,
        llmRequest,
      });

      // Should append to last content (third one)
      expect(llmRequest.contents![0].parts).to.have.lengthOf(1);
      expect(llmRequest.contents![1].parts).to.have.lengthOf(1);
      expect(llmRequest.contents![2].parts).to.have.lengthOf(2);
      expect(llmRequest.contents![2].parts![1]).to.deep.equal(savedParts[0]);
    });
  });

  describe('integration flow', () => {
    it('should capture parts from tool and pass to next model call', async () => {
      // Step 1: Tool returns a Part
      const imagePart: Part = {
        inlineData: {
          mimeType: 'image/png',
          data: 'screenshot_data',
        },
      };

      const toolResult = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: imagePart as unknown as Record<string, unknown>,
      });

      expect(toolResult).to.be.undefined;

      // Step 2: Before next model call, parts are attached
      const llmRequest: LlmRequest = {
        contents: [
          {
            role: 'user',
            parts: [{text: 'What is in this image?'}],
          },
        ],
      };

      await plugin.beforeModelCallback({
        callbackContext,
        llmRequest,
      });

      // Verify image was appended
      expect(llmRequest.contents![0].parts).to.have.lengthOf(2);
      expect(llmRequest.contents![0].parts![1]).to.deep.equal(imagePart);

      // Verify state was cleared
      const clearedParts = state.get(PARTS_RETURNED_BY_TOOLS_ID) as Part[];
      expect(clearedParts).to.have.lengthOf(0);
    });

    it('should accumulate parts from multiple tool calls', async () => {
      // First tool returns text
      await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: {text: 'Analysis complete'} as unknown as Record<
          string,
          unknown
        >,
      });

      // Second tool returns image
      await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: {
          inlineData: {mimeType: 'image/png', data: 'img1'},
        } as unknown as Record<string, unknown>,
      });

      // Third tool returns another image
      await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext,
        result: {
          inlineData: {mimeType: 'image/png', data: 'img2'},
        } as unknown as Record<string, unknown>,
      });

      // All three should be saved
      const savedParts = state.get(PARTS_RETURNED_BY_TOOLS_ID) as Part[];
      expect(savedParts).to.have.lengthOf(3);

      // Before model callback should append all
      const llmRequest: LlmRequest = {
        contents: [
          {
            role: 'user',
            parts: [{text: 'Compare these'}],
          },
        ],
      };

      await plugin.beforeModelCallback({
        callbackContext,
        llmRequest,
      });

      expect(llmRequest.contents![0].parts).to.have.lengthOf(4);
    });
  });

  describe('PARTS_RETURNED_BY_TOOLS_ID constant', () => {
    it('should use temp: prefix for automatic exclusion from persistence', () => {
      expect(PARTS_RETURNED_BY_TOOLS_ID).to.match(/^temp:/);
    });
  });
});
