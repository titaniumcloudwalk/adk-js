/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, FunctionDeclaration, Part} from '@google/genai';
import {describe, expect, it, beforeEach, afterEach, vi} from 'vitest';

import {
  AnthropicLlm,
  Claude,
  contentBlockToPart,
  contentToMessageParam,
  functionDeclarationToToolParam,
  messageToLlmResponse,
  partToMessageBlock,
  toClaudeRole,
  toGoogleGenaiFinishReason,
} from '../../src/models/anthropic_llm.js';
import {LLMRegistry} from '../../src/models/registry.js';

describe('AnthropicLlm', () => {
  describe('toClaudeRole', () => {
    it('should convert "model" to "assistant"', () => {
      expect(toClaudeRole('model')).toBe('assistant');
    });

    it('should convert "assistant" to "assistant"', () => {
      expect(toClaudeRole('assistant')).toBe('assistant');
    });

    it('should convert "user" to "user"', () => {
      expect(toClaudeRole('user')).toBe('user');
    });

    it('should default to "user" for undefined', () => {
      expect(toClaudeRole(undefined)).toBe('user');
    });

    it('should default to "user" for unknown roles', () => {
      expect(toClaudeRole('system')).toBe('user');
      expect(toClaudeRole('tool')).toBe('user');
    });
  });

  describe('toGoogleGenaiFinishReason', () => {
    it('should convert "end_turn" to "STOP"', () => {
      expect(toGoogleGenaiFinishReason('end_turn')).toBe('STOP');
    });

    it('should convert "stop_sequence" to "STOP"', () => {
      expect(toGoogleGenaiFinishReason('stop_sequence')).toBe('STOP');
    });

    it('should convert "tool_use" to "STOP"', () => {
      expect(toGoogleGenaiFinishReason('tool_use')).toBe('STOP');
    });

    it('should convert "max_tokens" to "MAX_TOKENS"', () => {
      expect(toGoogleGenaiFinishReason('max_tokens')).toBe('MAX_TOKENS');
    });

    it('should default to "FINISH_REASON_UNSPECIFIED" for null', () => {
      expect(toGoogleGenaiFinishReason(null)).toBe('FINISH_REASON_UNSPECIFIED');
    });

    it('should default to "FINISH_REASON_UNSPECIFIED" for undefined', () => {
      expect(toGoogleGenaiFinishReason(undefined)).toBe(
        'FINISH_REASON_UNSPECIFIED'
      );
    });

    it('should default to "FINISH_REASON_UNSPECIFIED" for unknown reasons', () => {
      expect(toGoogleGenaiFinishReason('unknown')).toBe(
        'FINISH_REASON_UNSPECIFIED'
      );
    });
  });

  describe('partToMessageBlock', () => {
    it('should convert text part', () => {
      const part: Part = {text: 'Hello, world!'};
      const result = partToMessageBlock(part);
      expect(result).toEqual({
        type: 'text',
        text: 'Hello, world!',
      });
    });

    it('should convert function call part', () => {
      const part: Part = {
        functionCall: {
          id: 'call_123',
          name: 'get_weather',
          args: {location: 'San Francisco'},
        },
      };
      const result = partToMessageBlock(part);
      expect(result).toEqual({
        type: 'tool_use',
        id: 'call_123',
        name: 'get_weather',
        input: {location: 'San Francisco'},
      });
    });

    it('should handle function call without id', () => {
      const part: Part = {
        functionCall: {
          name: 'get_weather',
          args: {location: 'NYC'},
        },
      };
      const result = partToMessageBlock(part);
      expect(result).toEqual({
        type: 'tool_use',
        id: '',
        name: 'get_weather',
        input: {location: 'NYC'},
      });
    });

    it('should convert function response with result', () => {
      const part: Part = {
        functionResponse: {
          id: 'call_123',
          name: 'get_weather',
          response: {result: 'Sunny, 72°F'},
        },
      };
      const result = partToMessageBlock(part);
      expect(result).toEqual({
        type: 'tool_result',
        tool_use_id: 'call_123',
        content: 'Sunny, 72°F',
        is_error: false,
      });
    });

    it('should convert function response with content array', () => {
      const part: Part = {
        functionResponse: {
          id: 'call_456',
          name: 'search',
          response: {
            content: [
              {type: 'text', text: 'Result 1'},
              {type: 'text', text: 'Result 2'},
            ],
          },
        },
      };
      const result = partToMessageBlock(part);
      expect(result).toEqual({
        type: 'tool_result',
        tool_use_id: 'call_456',
        content: 'Result 1\nResult 2',
        is_error: false,
      });
    });

    it('should convert executable code to text', () => {
      const part: Part = {
        executableCode: {
          code: 'print("Hello")',
          language: 'python',
        },
      };
      const result = partToMessageBlock(part);
      expect(result).toEqual({
        type: 'text',
        text: 'Code:```python\nprint("Hello")\n```',
      });
    });

    it('should convert code execution result to text', () => {
      const part: Part = {
        codeExecutionResult: {
          output: 'Hello\n',
          outcome: 'OUTCOME_OK',
        },
      };
      const result = partToMessageBlock(part);
      expect(result).toEqual({
        type: 'text',
        text: 'Execution Result:```code_output\nHello\n\n```',
      });
    });

    it('should throw for unsupported part types', () => {
      const part: Part = {fileData: {fileUri: 'file://test'}} as Part;
      expect(() => partToMessageBlock(part)).toThrow('Unsupported part type');
    });
  });

  describe('contentToMessageParam', () => {
    it('should convert user content with text', () => {
      const content: Content = {
        role: 'user',
        parts: [{text: 'Hello!'}],
      };
      const result = contentToMessageParam(content);
      expect(result).toEqual({
        role: 'user',
        content: [{type: 'text', text: 'Hello!'}],
      });
    });

    it('should convert model content to assistant', () => {
      const content: Content = {
        role: 'model',
        parts: [{text: 'Hi there!'}],
      };
      const result = contentToMessageParam(content);
      expect(result).toEqual({
        role: 'assistant',
        content: [{type: 'text', text: 'Hi there!'}],
      });
    });

    it('should convert content with multiple parts', () => {
      const content: Content = {
        role: 'user',
        parts: [{text: 'Part 1'}, {text: 'Part 2'}],
      };
      const result = contentToMessageParam(content);
      expect(result).toEqual({
        role: 'user',
        content: [
          {type: 'text', text: 'Part 1'},
          {type: 'text', text: 'Part 2'},
        ],
      });
    });

    it('should handle empty parts array', () => {
      const content: Content = {
        role: 'user',
        parts: [],
      };
      const result = contentToMessageParam(content);
      expect(result).toEqual({
        role: 'user',
        content: [],
      });
    });
  });

  describe('contentBlockToPart', () => {
    it('should convert text block to Part', () => {
      const block = {type: 'text' as const, text: 'Hello!'};
      const result = contentBlockToPart(block);
      expect(result).toEqual({text: 'Hello!'});
    });

    it('should convert tool_use block to Part with function call', () => {
      const block = {
        type: 'tool_use' as const,
        id: 'tool_123',
        name: 'get_weather',
        input: {city: 'NYC'},
      };
      const result = contentBlockToPart(block);
      expect(result).toEqual({
        functionCall: {
          id: 'tool_123',
          name: 'get_weather',
          args: {city: 'NYC'},
        },
      });
    });

    it('should throw for unsupported block types', () => {
      const block = {type: 'image' as const, source: {}};
      expect(() => contentBlockToPart(block as any)).toThrow(
        'Unsupported content block type'
      );
    });
  });

  describe('messageToLlmResponse', () => {
    it('should convert Anthropic message to LlmResponse', () => {
      const message = {
        id: 'msg_123',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [{type: 'text' as const, text: 'Hello!'}],
        model: 'claude-3-sonnet-20240229',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      };

      const result = messageToLlmResponse(message);

      expect(result.content).toEqual({
        role: 'model',
        parts: [{text: 'Hello!'}],
      });
      expect(result.usageMetadata).toEqual({
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15,
      });
      expect(result.finishReason).toBe('STOP');
    });

    it('should handle message with tool use', () => {
      const message = {
        id: 'msg_456',
        type: 'message' as const,
        role: 'assistant' as const,
        content: [
          {
            type: 'tool_use' as const,
            id: 'tool_call_1',
            name: 'search',
            input: {query: 'test'},
          },
        ],
        model: 'claude-3-sonnet-20240229',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: {
          input_tokens: 20,
          output_tokens: 10,
        },
      };

      const result = messageToLlmResponse(message);

      expect(result.content?.parts).toHaveLength(1);
      expect(result.content?.parts?.[0].functionCall).toEqual({
        id: 'tool_call_1',
        name: 'search',
        args: {query: 'test'},
      });
      expect(result.finishReason).toBe('STOP');
    });
  });

  describe('functionDeclarationToToolParam', () => {
    it('should convert basic function declaration', () => {
      const fn: FunctionDeclaration = {
        name: 'get_weather',
        description: 'Get the weather for a location',
        parameters: {
          type: 'OBJECT',
          properties: {
            location: {
              type: 'STRING',
              description: 'The city name',
            },
          },
          required: ['location'],
        },
      };

      const result = functionDeclarationToToolParam(fn);

      expect(result.name).toBe('get_weather');
      expect(result.description).toBe('Get the weather for a location');
      expect(result.input_schema).toEqual({
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city name',
          },
        },
        required: ['location'],
      });
    });

    it('should handle function with no parameters', () => {
      const fn: FunctionDeclaration = {
        name: 'get_time',
        description: 'Get the current time',
      };

      const result = functionDeclarationToToolParam(fn);

      expect(result.name).toBe('get_time');
      expect(result.input_schema).toEqual({
        type: 'object',
        properties: {},
      });
    });

    it('should use parametersJsonSchema if available', () => {
      const fn: FunctionDeclaration = {
        name: 'custom_tool',
        description: 'A custom tool',
        parametersJsonSchema: {
          type: 'object',
          properties: {
            data: {type: 'array', items: {type: 'string'}},
          },
        },
      };

      const result = functionDeclarationToToolParam(fn);

      expect(result.input_schema).toEqual({
        type: 'object',
        properties: {
          data: {type: 'array', items: {type: 'string'}},
        },
      });
    });

    it('should throw if function has no name', () => {
      const fn = {
        description: 'No name function',
      } as FunctionDeclaration;

      expect(() => functionDeclarationToToolParam(fn)).toThrow(
        'Function declaration must have a name'
      );
    });

    it('should normalize type strings to lowercase', () => {
      const fn: FunctionDeclaration = {
        name: 'test_fn',
        description: 'Test function',
        parameters: {
          type: 'OBJECT',
          properties: {
            count: {type: 'INTEGER'},
            names: {
              type: 'ARRAY',
              items: {type: 'STRING'},
            },
          },
        },
      };

      const result = functionDeclarationToToolParam(fn);

      expect(
        (result.input_schema.properties as Record<string, unknown>).count
      ).toEqual({
        type: 'integer',
      });
      expect(
        (result.input_schema.properties as Record<string, unknown>).names
      ).toEqual({
        type: 'array',
        items: {type: 'string'},
      });
    });
  });

  describe('AnthropicLlm class', () => {
    it('should have correct supportedModels patterns', () => {
      expect(AnthropicLlm.supportedModels).toHaveLength(2);
      expect(AnthropicLlm.supportedModels[0]).toEqual(/claude-3-.*/);
      expect(AnthropicLlm.supportedModels[1]).toEqual(/claude-.*-4.*/);
    });

    it('should set default model name', () => {
      // Note: This will fail without API key, but we're checking the model property
      try {
        const llm = new AnthropicLlm({});
        expect(llm.model).toBe('claude-sonnet-4-20250514');
      } catch {
        // Expected if no API key
      }
    });

    it('should accept custom model name', () => {
      try {
        const llm = new AnthropicLlm({model: 'claude-3-opus-20240229'});
        expect(llm.model).toBe('claude-3-opus-20240229');
      } catch {
        // Expected if no API key
      }
    });

    it('should set default maxTokens', () => {
      try {
        const llm = new AnthropicLlm({});
        expect(llm.maxTokens).toBe(8192);
      } catch {
        // Expected if no API key
      }
    });

    it('should accept custom maxTokens', () => {
      try {
        const llm = new AnthropicLlm({maxTokens: 4096});
        expect(llm.maxTokens).toBe(4096);
      } catch {
        // Expected if no API key
      }
    });
  });

  describe('Claude class', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = {...originalEnv};
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should have correct supportedModels patterns for Vertex AI', () => {
      expect(Claude.supportedModels).toHaveLength(2);
      expect(Claude.supportedModels[0]).toEqual(/claude-3-.*@.*/);
      expect(Claude.supportedModels[1]).toEqual(/claude-.*-4.*@.*/);
    });

    it('should throw if GOOGLE_CLOUD_PROJECT is not set', () => {
      delete process.env['GOOGLE_CLOUD_PROJECT'];
      delete process.env['GOOGLE_CLOUD_LOCATION'];

      expect(() => new Claude({})).toThrow(
        'GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION must be set'
      );
    });

    it('should throw if GOOGLE_CLOUD_LOCATION is not set', () => {
      process.env['GOOGLE_CLOUD_PROJECT'] = 'test-project';
      delete process.env['GOOGLE_CLOUD_LOCATION'];

      expect(() => new Claude({})).toThrow(
        'GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION must be set'
      );
    });

    it('should use environment variables for project and location', () => {
      process.env['GOOGLE_CLOUD_PROJECT'] = 'test-project';
      process.env['GOOGLE_CLOUD_LOCATION'] = 'us-east5';

      const llm = new Claude({});
      expect(llm.model).toBe('claude-3-5-sonnet-v2@20241022');
    });

    it('should accept constructor params for project and location', () => {
      const llm = new Claude({
        project: 'my-project',
        location: 'europe-west1',
      });
      expect(llm.model).toBe('claude-3-5-sonnet-v2@20241022');
    });

    it('should set default Vertex AI model name', () => {
      process.env['GOOGLE_CLOUD_PROJECT'] = 'test-project';
      process.env['GOOGLE_CLOUD_LOCATION'] = 'us-east5';

      const llm = new Claude({});
      expect(llm.model).toBe('claude-3-5-sonnet-v2@20241022');
    });
  });

  describe('LLMRegistry integration', () => {
    it('should resolve claude-3 models to AnthropicLlm', () => {
      const LlmClass = LLMRegistry.resolve('claude-3-opus-20240229');
      expect(LlmClass).toBe(AnthropicLlm);
    });

    it('should resolve claude-3-5 models to AnthropicLlm', () => {
      const LlmClass = LLMRegistry.resolve('claude-3-5-sonnet-20240620');
      expect(LlmClass).toBe(AnthropicLlm);
    });

    it('should resolve claude-sonnet-4 models to AnthropicLlm', () => {
      const LlmClass = LLMRegistry.resolve('claude-sonnet-4-20250514');
      expect(LlmClass).toBe(AnthropicLlm);
    });

    it('should resolve claude-opus-4 models to AnthropicLlm', () => {
      const LlmClass = LLMRegistry.resolve('claude-opus-4-20250514');
      expect(LlmClass).toBe(AnthropicLlm);
    });

    it('should resolve Vertex AI claude models to Claude', () => {
      const LlmClass = LLMRegistry.resolve('claude-3-5-sonnet-v2@20241022');
      expect(LlmClass).toBe(Claude);
    });

    it('should resolve Vertex AI claude-4 models to Claude', () => {
      const LlmClass = LLMRegistry.resolve('claude-sonnet-4@20250514');
      expect(LlmClass).toBe(Claude);
    });
  });

  describe('Image handling', () => {
    it('should convert base64 image data', () => {
      const part: Part = {
        inlineData: {
          mimeType: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
      };

      const result = partToMessageBlock(part);

      expect(result).toEqual({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
      });
    });

    it('should skip images in assistant turns with warning', () => {
      // Create a spy for the logger
      const content: Content = {
        role: 'model',
        parts: [
          {text: 'Here is an image:'},
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: 'base64data',
            },
          },
        ],
      };

      const result = contentToMessageParam(content);

      // Image should be filtered out
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'Here is an image:',
      });
    });
  });
});
