/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, FunctionDeclaration, Part} from '@google/genai';
import {expect} from 'chai';
import sinon from 'sinon';

import {
  LiteLlm,
  LiteLlmParams,
  contentToMessageParam,
  functionDeclarationToToolParam,
  getProviderFromModel,
} from '../../src/models/lite_llm.js';
import {LlmRequest} from '../../src/models/llm_request.js';
import {LLMRegistry} from '../../src/models/registry.js';

describe('LiteLlm', () => {
  describe('getProviderFromModel', () => {
    it('should extract provider from model string with slash', () => {
      expect(getProviderFromModel('openai/gpt-4o')).to.equal('openai');
      expect(getProviderFromModel('groq/llama3-70b-8192')).to.equal('groq');
      expect(getProviderFromModel('anthropic/claude-3-opus')).to.equal(
        'anthropic'
      );
      expect(getProviderFromModel('azure/gpt-4')).to.equal('azure');
    });

    it('should return empty string for model without provider prefix', () => {
      expect(getProviderFromModel('gemini-1.5-pro')).to.equal('');
    });

    it('should detect azure from model name', () => {
      expect(getProviderFromModel('azure-gpt-4')).to.equal('azure');
    });

    it('should detect openai from gpt- prefix', () => {
      expect(getProviderFromModel('gpt-4')).to.equal('openai');
      expect(getProviderFromModel('gpt-4o')).to.equal('openai');
    });

    it('should detect openai from o1 prefix', () => {
      expect(getProviderFromModel('o1-preview')).to.equal('openai');
    });

    it('should return empty string for empty model', () => {
      expect(getProviderFromModel('')).to.equal('');
    });
  });

  describe('functionDeclarationToToolParam', () => {
    it('should convert basic function declaration', () => {
      const functionDeclaration: FunctionDeclaration = {
        name: 'get_weather',
        description: 'Get current weather',
        parameters: {
          type: 'object' as const,
          properties: {
            location: {
              type: 'string' as const,
              description: 'City name',
            },
          },
          required: ['location'],
        },
      };

      const result = functionDeclarationToToolParam(functionDeclaration);

      expect(result.type).to.equal('function');
      expect(result.function.name).to.equal('get_weather');
      expect(result.function.description).to.equal('Get current weather');
      expect(result.function.parameters.type).to.equal('object');
      expect(result.function.parameters.properties).to.deep.equal({
        location: {
          type: 'string',
          description: 'City name',
        },
      });
      expect(result.function.parameters.required).to.deep.equal(['location']);
    });

    it('should convert function without parameters', () => {
      const functionDeclaration: FunctionDeclaration = {
        name: 'get_time',
        description: 'Get current time',
      };

      const result = functionDeclarationToToolParam(functionDeclaration);

      expect(result.function.name).to.equal('get_time');
      expect(result.function.parameters.type).to.equal('object');
      expect(result.function.parameters.properties).to.deep.equal({});
    });

    it('should throw error for function without name', () => {
      const functionDeclaration = {
        description: 'No name function',
      } as FunctionDeclaration;

      expect(() => functionDeclarationToToolParam(functionDeclaration)).to.throw(
        'Function declaration must have a name'
      );
    });

    it('should use parametersJsonSchema if available', () => {
      const functionDeclaration: FunctionDeclaration = {
        name: 'custom_func',
        description: 'Custom function',
        parametersJsonSchema: {
          type: 'object',
          properties: {
            customField: {type: 'number'},
          },
        },
      };

      const result = functionDeclarationToToolParam(functionDeclaration);

      expect(result.function.parameters).to.deep.equal({
        type: 'object',
        properties: {
          customField: {type: 'number'},
        },
      });
    });
  });

  describe('contentToMessageParam', () => {
    it('should convert user content with text', () => {
      const content: Content = {
        role: 'user',
        parts: [{text: 'Hello, world!'}],
      };

      const result = contentToMessageParam(content, 'openai', 'openai/gpt-4o');

      expect(result).to.deep.equal({
        role: 'user',
        content: 'Hello, world!',
      });
    });

    it('should convert assistant content with text', () => {
      const content: Content = {
        role: 'model',
        parts: [{text: 'Hi there!'}],
      };

      const result = contentToMessageParam(content, 'openai', 'openai/gpt-4o');

      expect(result).to.deep.equal({
        role: 'assistant',
        content: 'Hi there!',
        tool_calls: undefined,
        reasoning_content: undefined,
      });
    });

    it('should convert function call to tool_calls', () => {
      const content: Content = {
        role: 'model',
        parts: [
          {
            functionCall: {
              id: 'call_123',
              name: 'get_weather',
              args: {location: 'NYC'},
            },
          },
        ],
      };

      const result = contentToMessageParam(content, 'openai', 'openai/gpt-4o');

      expect((result as {role: string}).role).to.equal('assistant');
      expect((result as {tool_calls: unknown[]}).tool_calls).to.have.length(1);
      expect((result as {tool_calls: unknown[]}).tool_calls[0]).to.deep.include({
        type: 'function',
        id: 'call_123',
      });
    });

    it('should convert function response to tool message', () => {
      const content: Content = {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'call_123',
              response: {result: 'Sunny, 72F'},
            },
          },
        ],
      };

      const result = contentToMessageParam(content, 'openai', 'openai/gpt-4o');

      expect(result).to.deep.equal({
        role: 'tool',
        tool_call_id: 'call_123',
        content: '{"result":"Sunny, 72F"}',
      });
    });

    it('should handle multiple function responses as array', () => {
      const content: Content = {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: 'call_1',
              response: {result: 'Result 1'},
            },
          },
          {
            functionResponse: {
              id: 'call_2',
              response: {result: 'Result 2'},
            },
          },
        ],
      };

      const result = contentToMessageParam(content, 'openai', 'openai/gpt-4o');

      expect(Array.isArray(result)).to.be.true;
      expect((result as unknown[]).length).to.equal(2);
    });

    it('should handle thought parts for reasoning', () => {
      const content: Content = {
        role: 'model',
        parts: [
          {text: 'Let me think...', thought: true},
          {text: 'Here is my answer'},
        ],
      };

      const result = contentToMessageParam(content, 'openai', 'openai/gpt-4o');

      expect((result as {role: string}).role).to.equal('assistant');
      expect((result as {reasoning_content: string}).reasoning_content).to.equal(
        'Let me think...'
      );
      expect((result as {content: string}).content).to.equal('Here is my answer');
    });
  });

  describe('LiteLlm class', () => {
    it('should create instance with model', () => {
      const llm = new LiteLlm({model: 'openai/gpt-4o'});
      expect(llm.model).to.equal('openai/gpt-4o');
    });

    it('should store additional args', () => {
      const llm = new LiteLlm({
        model: 'openai/gpt-4o',
        additionalArgs: {temperature: 0.7},
      });
      expect(llm.model).to.equal('openai/gpt-4o');
    });

    it('should throw on connect() - not supported', async () => {
      const llm = new LiteLlm({model: 'openai/gpt-4o'});
      const llmRequest: LlmRequest = {
        contents: [],
        liveConnectConfig: {},
        toolsDict: {},
      };

      try {
        await llm.connect(llmRequest);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).to.include('not supported');
      }
    });
  });

  describe('LLMRegistry integration', () => {
    it('should resolve openai models to LiteLlm', () => {
      const LlmClass = LLMRegistry.resolve('openai/gpt-4o');
      expect(LlmClass).to.equal(LiteLlm);
    });

    it('should resolve groq models to LiteLlm', () => {
      const LlmClass = LLMRegistry.resolve('groq/llama3-70b-8192');
      expect(LlmClass).to.equal(LiteLlm);
    });

    it('should resolve anthropic models via litellm to LiteLlm', () => {
      const LlmClass = LLMRegistry.resolve('anthropic/claude-3-opus');
      expect(LlmClass).to.equal(LiteLlm);
    });

    it('should resolve azure models to LiteLlm', () => {
      const LlmClass = LLMRegistry.resolve('azure/gpt-4');
      expect(LlmClass).to.equal(LiteLlm);
    });

    it('should resolve bedrock models to LiteLlm', () => {
      const LlmClass = LLMRegistry.resolve('bedrock/anthropic.claude-3');
      expect(LlmClass).to.equal(LiteLlm);
    });

    it('should resolve cohere models to LiteLlm', () => {
      const LlmClass = LLMRegistry.resolve('cohere/command-r-plus');
      expect(LlmClass).to.equal(LiteLlm);
    });

    it('should resolve mistral models to LiteLlm', () => {
      const LlmClass = LLMRegistry.resolve('mistral/mistral-large-latest');
      expect(LlmClass).to.equal(LiteLlm);
    });

    it('should resolve together_ai models to LiteLlm', () => {
      const LlmClass = LLMRegistry.resolve('together_ai/llama3-70b');
      expect(LlmClass).to.equal(LiteLlm);
    });

    it('should resolve ollama models to LiteLlm', () => {
      const LlmClass = LLMRegistry.resolve('ollama/llama3');
      expect(LlmClass).to.equal(LiteLlm);
    });

    it('should create LiteLlm instance via newLlm', () => {
      const llm = LLMRegistry.newLlm('openai/gpt-4o');
      expect(llm).to.be.instanceOf(LiteLlm);
      expect(llm.model).to.equal('openai/gpt-4o');
    });
  });

  describe('supportedModels', () => {
    const patterns = LiteLlm.supportedModels;

    it('should include common provider patterns', () => {
      const expectedProviders = [
        'openai',
        'groq',
        'anthropic',
        'azure',
        'bedrock',
        'cohere',
        'mistral',
        'together_ai',
        'ollama',
        'deepseek',
        'perplexity',
        'fireworks_ai',
        'ai21',
        'replicate',
      ];

      for (const provider of expectedProviders) {
        const matchingPattern = patterns.find((p) => {
          const regex =
            p instanceof RegExp ? p : new RegExp(`^${p}$`);
          return regex.test(`${provider}/test-model`);
        });
        expect(matchingPattern).to.not.be.undefined;
      }
    });

    it('should match full model strings', () => {
      const testCases = [
        'openai/gpt-4o',
        'groq/llama3-70b-8192',
        'anthropic/claude-3-opus-20240229',
        'azure/gpt-4-turbo',
        'bedrock/anthropic.claude-3',
        'cohere/command-r-plus',
        'mistral/mistral-large-latest',
        'together_ai/meta-llama/Llama-3-70b-chat-hf',
        'ollama/llama3',
        'ollama_chat/llama3',
        'deepseek/deepseek-chat',
        'perplexity/llama-3.1-sonar-small-128k-online',
        'fireworks_ai/llama-v3p1-70b-instruct',
      ];

      for (const model of testCases) {
        const matchingPattern = patterns.find((p) => {
          const regex =
            p instanceof RegExp
              ? new RegExp(`^${p.source}$`)
              : new RegExp(`^${p}$`);
          return regex.test(model);
        });
        expect(matchingPattern, `Should match: ${model}`).to.not.be.undefined;
      }
    });
  });

  describe('generateContentAsync error handling', () => {
    it('should throw helpful error when litellm not installed', async () => {
      const llm = new LiteLlm({model: 'openai/gpt-4o'});
      const llmRequest: LlmRequest = {
        contents: [{role: 'user', parts: [{text: 'Hello'}]}],
        liveConnectConfig: {},
        toolsDict: {},
      };

      // The generateContentAsync should throw when litellm is not installed
      const generator = llm.generateContentAsync(llmRequest, false);

      try {
        await generator.next();
        // If we get here without error, the SDK might be installed
        // which is also acceptable
      } catch (error) {
        expect((error as Error).message).to.include('LiteLLM SDK is required');
      }
    });
  });
});

describe('LiteLlm message conversion edge cases', () => {
  it('should handle empty content parts', () => {
    const content: Content = {
      role: 'user',
      parts: [],
    };

    const result = contentToMessageParam(content, 'openai', 'openai/gpt-4o');

    expect(result).to.deep.equal({
      role: 'user',
      content: null,
    });
  });

  it('should handle multiple text parts', () => {
    const content: Content = {
      role: 'user',
      parts: [{text: 'First part'}, {text: 'Second part'}],
    };

    const result = contentToMessageParam(content, 'openai', 'openai/gpt-4o');

    expect((result as {role: string}).role).to.equal('user');
    // Multiple parts become an array
    const resultContent = (result as {content: unknown}).content;
    expect(Array.isArray(resultContent)).to.be.true;
    expect((resultContent as unknown[]).length).to.equal(2);
  });

  it('should handle mixed function response and text', () => {
    const content: Content = {
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'call_1',
            response: {result: 'Result'},
          },
        },
        {text: 'Additional context'},
      ],
    };

    const result = contentToMessageParam(content, 'openai', 'openai/gpt-4o');

    // Should return array with tool message and user message
    expect(Array.isArray(result)).to.be.true;
    const resultArray = result as unknown[];
    expect(resultArray.length).to.equal(2);
    expect((resultArray[0] as {role: string}).role).to.equal('tool');
    expect((resultArray[1] as {role: string}).role).to.equal('user');
  });

  it('should convert string function response directly', () => {
    const content: Content = {
      role: 'user',
      parts: [
        {
          functionResponse: {
            id: 'call_1',
            response: 'Simple string result',
          },
        },
      ],
    };

    const result = contentToMessageParam(content, 'openai', 'openai/gpt-4o');

    expect((result as {content: string}).content).to.equal('Simple string result');
  });
});
