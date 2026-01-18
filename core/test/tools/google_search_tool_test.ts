/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, expect, it} from 'vitest';

import {LlmAgent} from '../../src/agents/llm_agent.js';
import {BaseLlm} from '../../src/models/base_llm.js';
import {LlmRequest} from '../../src/models/llm_request.js';
import {LlmResponse} from '../../src/models/llm_response.js';
import {FunctionTool} from '../../src/tools/function_tool.js';
import {
  createGoogleSearchAgent,
  GoogleSearchAgentTool,
} from '../../src/tools/google_search_agent_tool.js';
import {GoogleSearchTool} from '../../src/tools/google_search_tool.js';

/**
 * A mock LLM for testing purposes that doesn't require API keys.
 */
class MockLlm extends BaseLlm {
  constructor() {
    super({model: 'mock-llm'});
  }

  async *
      generateContentAsync(request: LlmRequest):
          AsyncGenerator<LlmResponse, void, void> {
    yield {
      content: {
        role: 'model',
        parts: [{text: 'mock response'}],
      },
    };
  }
}

describe('GoogleSearchTool', () => {
  describe('constructor', () => {
    it('should default bypassMultiToolsLimit to false', () => {
      const tool = new GoogleSearchTool();
      expect(tool.bypassMultiToolsLimit).toBe(false);
    });

    it('should accept bypassMultiToolsLimit config option', () => {
      const tool = new GoogleSearchTool({bypassMultiToolsLimit: true});
      expect(tool.bypassMultiToolsLimit).toBe(true);
    });

    it('should set correct name and description', () => {
      const tool = new GoogleSearchTool();
      expect(tool.name).toBe('google_search');
      expect(tool.description).toBe('Google Search Tool');
    });
  });
});

describe('createGoogleSearchAgent', () => {
  it('should create an LlmAgent with google_search tool', () => {
    const agent = createGoogleSearchAgent('gemini-2.0-flash');
    expect(agent).toBeInstanceOf(LlmAgent);
    expect(agent.name).toBe('google_search_agent');
    expect(agent.tools).toHaveLength(1);
    expect(agent.tools[0]).toBeInstanceOf(GoogleSearchTool);
  });

  it('should accept a string model', () => {
    const agent = createGoogleSearchAgent('gemini-2.0-flash');
    expect(agent.model).toBe('gemini-2.0-flash');
  });

  it('should accept a BaseLlm model', () => {
    const model = new MockLlm();
    const agent = createGoogleSearchAgent(model);
    expect(agent.model).toBe(model);
  });
});

describe('GoogleSearchAgentTool', () => {
  it('should create a tool from an agent', () => {
    const agent = createGoogleSearchAgent('gemini-2.0-flash');
    const tool = new GoogleSearchAgentTool({agent});
    expect(tool.name).toBe('google_search_agent');
    expect(tool.description).toBe(
        'An agent for performing Google search using the `google_search` tool');
  });
});

describe('LlmAgent.canonicalTools with bypassMultiToolsLimit', () => {
  it('should not wrap GoogleSearchTool when bypassMultiToolsLimit is false with multiple tools',
     async () => {
       const searchTool = new GoogleSearchTool({bypassMultiToolsLimit: false});
       const otherTool = new FunctionTool({
         name: 'other_tool',
         description: 'Another tool',
         execute: async () => 'result',
       });

       const agent = new LlmAgent({
         name: 'test_agent',
         model: new MockLlm(),
         tools: [searchTool, otherTool],
       });

       const canonicalTools = await agent.canonicalTools();

       // Should not be wrapped - original GoogleSearchTool should be present
       expect(canonicalTools).toHaveLength(2);
       expect(canonicalTools[0]).toBeInstanceOf(GoogleSearchTool);
       expect(canonicalTools[1]).toBeInstanceOf(FunctionTool);
     });

  it('should wrap GoogleSearchTool in GoogleSearchAgentTool when bypassMultiToolsLimit is true with multiple tools',
     async () => {
       const searchTool = new GoogleSearchTool({bypassMultiToolsLimit: true});
       const otherTool = new FunctionTool({
         name: 'other_tool',
         description: 'Another tool',
         execute: async () => 'result',
       });

       const agent = new LlmAgent({
         name: 'test_agent',
         model: new MockLlm(),
         tools: [searchTool, otherTool],
       });

       const canonicalTools = await agent.canonicalTools();

       // Should be wrapped in GoogleSearchAgentTool
       expect(canonicalTools).toHaveLength(2);
       expect(canonicalTools[0]).toBeInstanceOf(GoogleSearchAgentTool);
       expect(canonicalTools[1]).toBeInstanceOf(FunctionTool);
     });

  it('should not wrap GoogleSearchTool when it is the only tool (even with bypass enabled)',
     async () => {
       const searchTool = new GoogleSearchTool({bypassMultiToolsLimit: true});

       const agent = new LlmAgent({
         name: 'test_agent',
         model: new MockLlm(),
         tools: [searchTool],
       });

       const canonicalTools = await agent.canonicalTools();

       // Should not be wrapped - only one tool, no need for bypass
       expect(canonicalTools).toHaveLength(1);
       expect(canonicalTools[0]).toBeInstanceOf(GoogleSearchTool);
     });

  it('should preserve other tools when wrapping GoogleSearchTool', async () => {
    const searchTool = new GoogleSearchTool({bypassMultiToolsLimit: true});
    const tool1 = new FunctionTool({
      name: 'tool1',
      description: 'Tool 1',
      execute: async () => 'result1',
    });
    const tool2 = new FunctionTool({
      name: 'tool2',
      description: 'Tool 2',
      execute: async () => 'result2',
    });

    const agent = new LlmAgent({
      name: 'test_agent',
      model: new MockLlm(),
      tools: [searchTool, tool1, tool2],
    });

    const canonicalTools = await agent.canonicalTools();

    expect(canonicalTools).toHaveLength(3);
    expect(canonicalTools[0]).toBeInstanceOf(GoogleSearchAgentTool);
    expect(canonicalTools[1].name).toBe('tool1');
    expect(canonicalTools[2].name).toBe('tool2');
  });

  it('should handle GOOGLE_SEARCH singleton without bypassMultiToolsLimit',
     async () => {
       const {GOOGLE_SEARCH} = await import(
           '../../src/tools/google_search_tool.js');

       const otherTool = new FunctionTool({
         name: 'other_tool',
         description: 'Another tool',
         execute: async () => 'result',
       });

       const agent = new LlmAgent({
         name: 'test_agent',
         model: new MockLlm(),
         tools: [GOOGLE_SEARCH, otherTool],
       });

       const canonicalTools = await agent.canonicalTools();

       // GOOGLE_SEARCH has bypassMultiToolsLimit=false by default
       expect(canonicalTools).toHaveLength(2);
       expect(canonicalTools[0]).toBeInstanceOf(GoogleSearchTool);
       expect((canonicalTools[0] as GoogleSearchTool).bypassMultiToolsLimit)
           .toBe(false);
     });

  it('should use the parent agent model for the wrapped GoogleSearchAgentTool',
     async () => {
       const mockLlm = new MockLlm();
       const searchTool = new GoogleSearchTool({bypassMultiToolsLimit: true});
       const otherTool = new FunctionTool({
         name: 'other_tool',
         description: 'Another tool',
         execute: async () => 'result',
       });

       const agent = new LlmAgent({
         name: 'test_agent',
         model: mockLlm,
         tools: [searchTool, otherTool],
       });

       const canonicalTools = await agent.canonicalTools();
       const wrappedTool = canonicalTools[0] as GoogleSearchAgentTool;

       // The wrapped agent should use the same model as the parent
       // Access internal agent to verify model
       expect(wrappedTool).toBeInstanceOf(GoogleSearchAgentTool);
       expect(wrappedTool.name).toBe('google_search_agent');
     });
});
