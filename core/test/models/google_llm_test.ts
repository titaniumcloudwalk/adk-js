/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Gemini, GeminiParams, HttpRetryOptions} from '@google/adk';

import {version} from '../../src/version.js';

class TestGemini extends Gemini {
  constructor(params: GeminiParams) {
    super(params);
  }
  getTrackingHeaders(): Record<string, string> {
    return this.trackingHeaders;
  }
  getRetryOptions(): HttpRetryOptions | undefined {
    return this.retryOptions;
  }
}

describe('GoogleLlm', () => {
  it('should set tracking headers correctly when GOOGLE_CLOUD_AGENT_ENGINE_ID is not set',
     () => {
       const llm = new TestGemini({apiKey: 'test-key'});
       const headers = llm.getTrackingHeaders();
       const expectedValue =
           `google-adk/${version} gl-typescript/${process.version}`;
       expect(headers['x-goog-api-client']).toEqual(expectedValue);
       expect(headers['user-agent']).toEqual(expectedValue);
     });

  it('should set tracking headers correctly when GOOGLE_CLOUD_AGENT_ENGINE_ID is set',
     () => {
       process.env['GOOGLE_CLOUD_AGENT_ENGINE_ID'] = 'test-engine';
       const llm = new TestGemini({apiKey: 'test-key'});
       const headers = llm.getTrackingHeaders();
       const expectedValue = `google-adk/${
           version}+remote_reasoning_engine gl-typescript/${process.version}`;
       expect(headers['x-goog-api-client']).toEqual(expectedValue);
       expect(headers['user-agent']).toEqual(expectedValue);
     });

  describe('Retry Options', () => {
    it('should accept retryOptions parameter', () => {
      const retryOptions: HttpRetryOptions = {
        initialDelay: 1000,
        attempts: 3,
        maxDelay: 10000,
        backoffMultiplier: 2,
      };
      const llm = new TestGemini({apiKey: 'test-key', retryOptions});
      expect(llm.getRetryOptions()).toEqual(retryOptions);
    });

    it('should have undefined retryOptions when not provided', () => {
      const llm = new TestGemini({apiKey: 'test-key'});
      expect(llm.getRetryOptions()).toBeUndefined();
    });

    it('should accept partial retryOptions with only initialDelay', () => {
      const retryOptions: HttpRetryOptions = {
        initialDelay: 500,
      };
      const llm = new TestGemini({apiKey: 'test-key', retryOptions});
      expect(llm.getRetryOptions()).toEqual(retryOptions);
      expect(llm.getRetryOptions()?.initialDelay).toBe(500);
      expect(llm.getRetryOptions()?.attempts).toBeUndefined();
    });

    it('should accept partial retryOptions with only attempts', () => {
      const retryOptions: HttpRetryOptions = {
        attempts: 5,
      };
      const llm = new TestGemini({apiKey: 'test-key', retryOptions});
      expect(llm.getRetryOptions()).toEqual(retryOptions);
      expect(llm.getRetryOptions()?.attempts).toBe(5);
    });

    it('should accept retryOptions with all fields', () => {
      const retryOptions: HttpRetryOptions = {
        initialDelay: 1000,
        attempts: 3,
        maxDelay: 60000,
        backoffMultiplier: 1.5,
      };
      const llm = new TestGemini({apiKey: 'test-key', retryOptions});
      expect(llm.getRetryOptions()).toEqual({
        initialDelay: 1000,
        attempts: 3,
        maxDelay: 60000,
        backoffMultiplier: 1.5,
      });
    });
  });
});
