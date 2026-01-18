/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ApigeeLlm,
  apigeeGetModelId,
  apigeeIdentifyApiVersion,
  apigeeIdentifyVertexai,
  apigeeValidateModelString,
  LLMRegistry,
} from '@google/adk';

describe('ApigeeLlm', () => {
  // Store original environment variables
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save original environment variables
    originalEnv['APIGEE_PROXY_URL'] = process.env['APIGEE_PROXY_URL'];
    originalEnv['GOOGLE_GENAI_USE_VERTEXAI'] = process.env['GOOGLE_GENAI_USE_VERTEXAI'];
    originalEnv['GOOGLE_CLOUD_PROJECT'] = process.env['GOOGLE_CLOUD_PROJECT'];
    originalEnv['GOOGLE_CLOUD_LOCATION'] = process.env['GOOGLE_CLOUD_LOCATION'];

    // Clear environment variables for clean tests
    delete process.env['APIGEE_PROXY_URL'];
    delete process.env['GOOGLE_GENAI_USE_VERTEXAI'];
    delete process.env['GOOGLE_CLOUD_PROJECT'];
    delete process.env['GOOGLE_CLOUD_LOCATION'];
  });

  afterEach(() => {
    // Restore original environment variables
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe('validateModelString', () => {
    it('should accept valid model string with just model_id', () => {
      expect(apigeeValidateModelString('apigee/gemini-2.5-flash')).toBe(true);
    });

    it('should accept valid model string with version and model_id', () => {
      expect(apigeeValidateModelString('apigee/v1/gemini-2.5-flash')).toBe(true);
      expect(apigeeValidateModelString('apigee/v1beta/gemini-2.5-flash')).toBe(true);
    });

    it('should accept valid model string with provider and model_id', () => {
      expect(apigeeValidateModelString('apigee/vertex_ai/gemini-2.5-flash')).toBe(true);
      expect(apigeeValidateModelString('apigee/gemini/gemini-2.5-flash')).toBe(true);
    });

    it('should accept valid model string with provider, version, and model_id', () => {
      expect(apigeeValidateModelString('apigee/vertex_ai/v1/gemini-2.5-flash')).toBe(true);
      expect(apigeeValidateModelString('apigee/gemini/v1beta/gemini-2.5-flash')).toBe(true);
    });

    it('should reject model strings not starting with apigee/', () => {
      expect(apigeeValidateModelString('gemini/gemini-2.5-flash')).toBe(false);
      expect(apigeeValidateModelString('vertex_ai/gemini-2.5-flash')).toBe(false);
      expect(apigeeValidateModelString('gemini-2.5-flash')).toBe(false);
    });

    it('should reject empty model_id', () => {
      expect(apigeeValidateModelString('apigee/')).toBe(false);
    });

    it('should reject model strings with more than 3 components', () => {
      expect(apigeeValidateModelString('apigee/vertex_ai/v1/extra/gemini-2.5-flash')).toBe(false);
    });

    it('should reject invalid provider names', () => {
      expect(apigeeValidateModelString('apigee/invalid_provider/v1/gemini-2.5-flash')).toBe(false);
    });

    it('should reject invalid version format (not starting with v)', () => {
      expect(apigeeValidateModelString('apigee/vertex_ai/1/gemini-2.5-flash')).toBe(false);
    });

    it('should reject 2-component format with invalid first component', () => {
      expect(apigeeValidateModelString('apigee/invalid/gemini-2.5-flash')).toBe(false);
    });
  });

  describe('identifyVertexai', () => {
    it('should return true for vertex_ai provider', () => {
      expect(apigeeIdentifyVertexai('apigee/vertex_ai/gemini-2.5-flash')).toBe(true);
      expect(apigeeIdentifyVertexai('apigee/vertex_ai/v1/gemini-2.5-flash')).toBe(true);
    });

    it('should return false for gemini provider', () => {
      expect(apigeeIdentifyVertexai('apigee/gemini/gemini-2.5-flash')).toBe(false);
      expect(apigeeIdentifyVertexai('apigee/gemini/v1/gemini-2.5-flash')).toBe(false);
    });

    it('should return false by default when no provider specified', () => {
      expect(apigeeIdentifyVertexai('apigee/gemini-2.5-flash')).toBe(false);
    });

    it('should respect GOOGLE_GENAI_USE_VERTEXAI env var when no provider specified', () => {
      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';
      expect(apigeeIdentifyVertexai('apigee/gemini-2.5-flash')).toBe(true);

      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = '1';
      expect(apigeeIdentifyVertexai('apigee/gemini-2.5-flash')).toBe(true);

      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'false';
      expect(apigeeIdentifyVertexai('apigee/gemini-2.5-flash')).toBe(false);
    });

    it('should prioritize explicit gemini provider over env var', () => {
      process.env['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';
      expect(apigeeIdentifyVertexai('apigee/gemini/gemini-2.5-flash')).toBe(false);
    });
  });

  describe('identifyApiVersion', () => {
    it('should return empty string for model without version', () => {
      expect(apigeeIdentifyApiVersion('apigee/gemini-2.5-flash')).toBe('');
      expect(apigeeIdentifyApiVersion('apigee/vertex_ai/gemini-2.5-flash')).toBe('');
      expect(apigeeIdentifyApiVersion('apigee/gemini/gemini-2.5-flash')).toBe('');
    });

    it('should extract version from 3-component format', () => {
      expect(apigeeIdentifyApiVersion('apigee/vertex_ai/v1/gemini-2.5-flash')).toBe('v1');
      expect(apigeeIdentifyApiVersion('apigee/gemini/v1beta/gemini-2.5-flash')).toBe('v1beta');
    });

    it('should extract version from 2-component format', () => {
      expect(apigeeIdentifyApiVersion('apigee/v1/gemini-2.5-flash')).toBe('v1');
      expect(apigeeIdentifyApiVersion('apigee/v1beta/gemini-2.5-flash')).toBe('v1beta');
    });
  });

  describe('getModelId', () => {
    it('should extract model_id from simple format', () => {
      expect(apigeeGetModelId('apigee/gemini-2.5-flash')).toBe('gemini-2.5-flash');
    });

    it('should extract model_id from 2-component format', () => {
      expect(apigeeGetModelId('apigee/v1/gemini-2.5-flash')).toBe('gemini-2.5-flash');
      expect(apigeeGetModelId('apigee/vertex_ai/gemini-2.5-flash')).toBe('gemini-2.5-flash');
    });

    it('should extract model_id from 3-component format', () => {
      expect(apigeeGetModelId('apigee/vertex_ai/v1/gemini-2.5-flash')).toBe('gemini-2.5-flash');
      expect(apigeeGetModelId('apigee/gemini/v1beta/gemini-2.5-pro')).toBe('gemini-2.5-pro');
    });
  });

  describe('constructor', () => {
    it('should throw error for invalid model string', () => {
      expect(() => new ApigeeLlm({model: 'invalid-model'})).toThrow(
        'Invalid model string: invalid-model',
      );
      expect(() => new ApigeeLlm({model: 'apigee/'})).toThrow(
        'Invalid model string: apigee/',
      );
    });

    it('should create instance with valid gemini model', () => {
      const llm = new ApigeeLlm({
        model: 'apigee/gemini-2.5-flash',
        proxyUrl: 'https://proxy.example.com',
      });
      expect(llm).toBeInstanceOf(ApigeeLlm);
      expect(llm.model).toBe('gemini-2.5-flash');
    });

    it('should read proxy URL from environment variable', () => {
      process.env['APIGEE_PROXY_URL'] = 'https://env-proxy.example.com';
      const llm = new ApigeeLlm({model: 'apigee/gemini-2.5-flash'});
      expect(llm).toBeInstanceOf(ApigeeLlm);
    });

    it('should prefer constructor proxy URL over environment variable', () => {
      process.env['APIGEE_PROXY_URL'] = 'https://env-proxy.example.com';
      const llm = new ApigeeLlm({
        model: 'apigee/gemini-2.5-flash',
        proxyUrl: 'https://constructor-proxy.example.com',
      });
      expect(llm).toBeInstanceOf(ApigeeLlm);
    });

    it('should throw error for vertex_ai mode without project', () => {
      expect(() => new ApigeeLlm({model: 'apigee/vertex_ai/gemini-2.5-flash'})).toThrow(
        'GOOGLE_CLOUD_PROJECT environment variable must be set',
      );
    });

    it('should throw error for vertex_ai mode without location', () => {
      process.env['GOOGLE_CLOUD_PROJECT'] = 'test-project';
      expect(() => new ApigeeLlm({model: 'apigee/vertex_ai/gemini-2.5-flash'})).toThrow(
        'GOOGLE_CLOUD_LOCATION environment variable must be set',
      );
    });

    it('should create vertex_ai instance with proper environment variables', () => {
      process.env['GOOGLE_CLOUD_PROJECT'] = 'test-project';
      process.env['GOOGLE_CLOUD_LOCATION'] = 'us-central1';
      const llm = new ApigeeLlm({
        model: 'apigee/vertex_ai/gemini-2.5-flash',
        proxyUrl: 'https://proxy.example.com',
      });
      expect(llm).toBeInstanceOf(ApigeeLlm);
      expect(llm.model).toBe('gemini-2.5-flash');
    });

    it('should accept constructor project and location for vertex_ai', () => {
      const llm = new ApigeeLlm({
        model: 'apigee/vertex_ai/gemini-2.5-flash',
        project: 'constructor-project',
        location: 'constructor-location',
        proxyUrl: 'https://proxy.example.com',
      });
      expect(llm).toBeInstanceOf(ApigeeLlm);
    });

    it('should accept custom headers', () => {
      const llm = new ApigeeLlm({
        model: 'apigee/gemini-2.5-flash',
        proxyUrl: 'https://proxy.example.com',
        customHeaders: {'X-Custom-Header': 'custom-value'},
      });
      expect(llm).toBeInstanceOf(ApigeeLlm);
    });

    it('should accept useInteractionsApi option', () => {
      const llm = new ApigeeLlm({
        model: 'apigee/gemini-2.5-flash',
        proxyUrl: 'https://proxy.example.com',
        useInteractionsApi: true,
      });
      expect(llm).toBeInstanceOf(ApigeeLlm);
    });
  });

  describe('LLMRegistry integration', () => {
    it('should resolve apigee/* models to ApigeeLlm', () => {
      const LlmClass = LLMRegistry.resolve('apigee/gemini-2.5-flash');
      expect(LlmClass).toBe(ApigeeLlm);
    });

    it('should resolve apigee/vertex_ai/* models to ApigeeLlm', () => {
      const LlmClass = LLMRegistry.resolve('apigee/vertex_ai/gemini-2.5-flash');
      expect(LlmClass).toBe(ApigeeLlm);
    });

    it('should resolve apigee models with version to ApigeeLlm', () => {
      const LlmClass = LLMRegistry.resolve('apigee/v1/gemini-2.5-flash');
      expect(LlmClass).toBe(ApigeeLlm);
    });

    it('should resolve complex apigee models to ApigeeLlm', () => {
      const LlmClass = LLMRegistry.resolve('apigee/vertex_ai/v1beta/gemini-2.5-pro');
      expect(LlmClass).toBe(ApigeeLlm);
    });
  });

  describe('apiClient', () => {
    it('should create API client with proxy URL', () => {
      const llm = new ApigeeLlm({
        model: 'apigee/gemini-2.5-flash',
        proxyUrl: 'https://proxy.example.com',
      });
      // Access apiClient to trigger client creation
      const client = llm.apiClient;
      expect(client).toBeDefined();
    });

    it('should create API client for vertex_ai mode', () => {
      process.env['GOOGLE_CLOUD_PROJECT'] = 'test-project';
      process.env['GOOGLE_CLOUD_LOCATION'] = 'us-central1';
      const llm = new ApigeeLlm({
        model: 'apigee/vertex_ai/gemini-2.5-flash',
        proxyUrl: 'https://proxy.example.com',
      });
      const client = llm.apiClient;
      expect(client).toBeDefined();
      expect(client.vertexai).toBe(true);
    });

    it('should cache API client on subsequent access', () => {
      const llm = new ApigeeLlm({
        model: 'apigee/gemini-2.5-flash',
        proxyUrl: 'https://proxy.example.com',
      });
      const client1 = llm.apiClient;
      const client2 = llm.apiClient;
      expect(client1).toBe(client2);
    });
  });

  describe('supported models', () => {
    it('should have supportedModels static property', () => {
      expect(ApigeeLlm.supportedModels).toBeDefined();
      expect(Array.isArray(ApigeeLlm.supportedModels)).toBe(true);
      expect(ApigeeLlm.supportedModels.length).toBeGreaterThan(0);
    });

    it('should match apigee pattern', () => {
      const pattern = ApigeeLlm.supportedModels[0];
      expect(pattern).toBeInstanceOf(RegExp);
      expect((pattern as RegExp).test('apigee/gemini-2.5-flash')).toBe(true);
      expect((pattern as RegExp).test('apigee/vertex_ai/v1/gemini-2.5-flash')).toBe(true);
    });

    it('should not match non-apigee models', () => {
      const pattern = ApigeeLlm.supportedModels[0];
      expect((pattern as RegExp).test('gemini-2.5-flash')).toBe(false);
      expect((pattern as RegExp).test('vertex_ai/gemini-2.5-flash')).toBe(false);
    });
  });
});
