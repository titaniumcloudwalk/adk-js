/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, expect, it} from 'vitest';

import {InvocationContext} from '../../src/agents/invocation_context.js';
import {LlmRequest} from '../../src/models/llm_request.js';
import {Session} from '../../src/sessions/session.js';
import {
  GOOGLE_MAPS_GROUNDING,
  GoogleMapsGroundingTool,
} from '../../src/tools/google_maps_grounding_tool.js';
import {ToolContext} from '../../src/tools/tool_context.js';

/**
 * Creates a mock ToolContext for testing.
 */
function createMockToolContext(): ToolContext {
  const session = {
    id: 'test-session',
    appName: 'test-app',
    userId: 'test-user',
    events: [],
    state: {},
    createdAt: new Date(),
    lastUpdateTime: new Date(),
  } as Session;

  const invocationContext = {
    session,
    sessionService: undefined,
    artifactService: undefined,
    memoryService: undefined,
    invocationId: 'test-invocation',
    endInvocation: false,
  } as unknown as InvocationContext;

  return new ToolContext({
    invocationContext,
    eventActions: {
      stateDelta: {},
    },
    functionCallId: 'test-function-call',
  });
}

describe('GoogleMapsGroundingTool', () => {
  describe('constructor', () => {
    it('should set correct name', () => {
      const tool = new GoogleMapsGroundingTool();
      expect(tool.name).toBe('google_maps');
    });

    it('should set correct description', () => {
      const tool = new GoogleMapsGroundingTool();
      expect(tool.description).toBe('Google Maps Grounding Tool');
    });
  });

  describe('runAsync', () => {
    it('should resolve without doing anything (built-in tool)', async () => {
      const tool = new GoogleMapsGroundingTool();
      const result = await tool.runAsync({
        args: {},
        toolContext: createMockToolContext(),
      });
      expect(result).toBeUndefined();
    });
  });

  describe('processLlmRequest', () => {
    it('should add googleMaps tool to config for Gemini 2.x models', async () => {
      const tool = new GoogleMapsGroundingTool();
      const toolContext = createMockToolContext();
      const llmRequest: LlmRequest = {
        model: 'gemini-2.0-flash',
        contents: [],
      };

      await tool.processLlmRequest({toolContext, llmRequest});

      expect(llmRequest.config).toBeDefined();
      expect(llmRequest.config!.tools).toBeDefined();
      expect(llmRequest.config!.tools).toHaveLength(1);
      expect(llmRequest.config!.tools![0]).toEqual({googleMaps: {}});
    });

    it('should add googleMaps tool to config for Gemini 2.5 models', async () => {
      const tool = new GoogleMapsGroundingTool();
      const toolContext = createMockToolContext();
      const llmRequest: LlmRequest = {
        model: 'gemini-2.5-pro',
        contents: [],
      };

      await tool.processLlmRequest({toolContext, llmRequest});

      expect(llmRequest.config!.tools).toHaveLength(1);
      expect(llmRequest.config!.tools![0]).toEqual({googleMaps: {}});
    });

    it('should throw error for Gemini 1.x models', async () => {
      const tool = new GoogleMapsGroundingTool();
      const toolContext = createMockToolContext();
      const llmRequest: LlmRequest = {
        model: 'gemini-1.5-pro',
        contents: [],
      };

      await expect(
        tool.processLlmRequest({toolContext, llmRequest}),
      ).rejects.toThrow(
        'Google Maps grounding tool cannot be used with Gemini 1.x models.',
      );
    });

    it('should throw error for Gemini 1.0 models', async () => {
      const tool = new GoogleMapsGroundingTool();
      const toolContext = createMockToolContext();
      const llmRequest: LlmRequest = {
        model: 'gemini-1.0-pro',
        contents: [],
      };

      await expect(
        tool.processLlmRequest({toolContext, llmRequest}),
      ).rejects.toThrow(
        'Google Maps grounding tool cannot be used with Gemini 1.x models.',
      );
    });

    it('should throw error for non-Gemini models', async () => {
      const tool = new GoogleMapsGroundingTool();
      const toolContext = createMockToolContext();
      const llmRequest: LlmRequest = {
        model: 'claude-3-opus',
        contents: [],
      };

      await expect(
        tool.processLlmRequest({toolContext, llmRequest}),
      ).rejects.toThrow(
        'Google Maps grounding tool is not supported for model claude-3-opus',
      );
    });

    it('should do nothing if model is not set', async () => {
      const tool = new GoogleMapsGroundingTool();
      const toolContext = createMockToolContext();
      const llmRequest: LlmRequest = {
        contents: [],
      };

      await tool.processLlmRequest({toolContext, llmRequest});

      expect(llmRequest.config).toBeUndefined();
    });

    it('should append to existing tools array', async () => {
      const tool = new GoogleMapsGroundingTool();
      const toolContext = createMockToolContext();
      const llmRequest: LlmRequest = {
        model: 'gemini-2.0-flash',
        contents: [],
        config: {
          tools: [{functionDeclarations: [{name: 'existing_tool'}]}],
        },
      };

      await tool.processLlmRequest({toolContext, llmRequest});

      expect(llmRequest.config!.tools).toHaveLength(2);
      expect(llmRequest.config!.tools![0]).toEqual({
        functionDeclarations: [{name: 'existing_tool'}],
      });
      expect(llmRequest.config!.tools![1]).toEqual({googleMaps: {}});
    });

    it('should create config if not present', async () => {
      const tool = new GoogleMapsGroundingTool();
      const toolContext = createMockToolContext();
      const llmRequest: LlmRequest = {
        model: 'gemini-2.0-flash',
        contents: [],
      };

      expect(llmRequest.config).toBeUndefined();

      await tool.processLlmRequest({toolContext, llmRequest});

      expect(llmRequest.config).toBeDefined();
      expect(llmRequest.config!.tools).toHaveLength(1);
    });
  });
});

describe('GOOGLE_MAPS_GROUNDING singleton', () => {
  it('should be an instance of GoogleMapsGroundingTool', () => {
    expect(GOOGLE_MAPS_GROUNDING).toBeInstanceOf(GoogleMapsGroundingTool);
  });

  it('should have correct name', () => {
    expect(GOOGLE_MAPS_GROUNDING.name).toBe('google_maps');
  });

  it('should have correct description', () => {
    expect(GOOGLE_MAPS_GROUNDING.description).toBe('Google Maps Grounding Tool');
  });
});
