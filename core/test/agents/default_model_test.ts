/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {BaseLlm, BaseLlmConnection, DEFAULT_MODEL, LlmAgent, LlmRequest, LlmResponse, LLMRegistry, LoopAgent} from '@google/adk';
import {Content} from '@google/genai';

class MockLlmConnection implements BaseLlmConnection {
  sendHistory(history: Content[]): Promise<void> {
    return Promise.resolve();
  }
  sendContent(content: Content): Promise<void> {
    return Promise.resolve();
  }
  sendRealtime(blob: {data: string; mimeType: string}): Promise<void> {
    return Promise.resolve();
  }
  async *receive(): AsyncGenerator<LlmResponse, void, void> {
    // No-op for mock.
  }
  async close(): Promise<void> {
    return Promise.resolve();
  }
}

class MockLlm extends BaseLlm {
  constructor(model: string = 'mock-llm') {
    super({model});
  }

  async *generateContentAsync(
    request: LlmRequest
  ): AsyncGenerator<LlmResponse, void, void> {
    yield {content: {parts: [{text: 'response'}]}};
  }

  async connect(llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    return new MockLlmConnection();
  }
}

describe('LlmAgent default model', () => {
  beforeEach(() => {
    // Reset to default model before each test
    LlmAgent.resetDefaultModel();
  });

  afterEach(() => {
    // Clean up after each test
    LlmAgent.resetDefaultModel();
  });

  describe('DEFAULT_MODEL constant', () => {
    it('should be gemini-2.5-flash', () => {
      expect(DEFAULT_MODEL).toBe('gemini-2.5-flash');
    });
  });

  describe('LlmAgent.setDefaultModel', () => {
    it('should set default model with string', () => {
      LlmAgent.setDefaultModel('gemini-2.5-pro');
      expect(LlmAgent.getDefaultModel()).toBe('gemini-2.5-pro');
    });

    it('should set default model with BaseLlm instance', () => {
      const mockLlm = new MockLlm('custom-model');
      LlmAgent.setDefaultModel(mockLlm);
      expect(LlmAgent.getDefaultModel()).toBe(mockLlm);
    });
  });

  describe('LlmAgent.getDefaultModel', () => {
    it('should return built-in default initially', () => {
      expect(LlmAgent.getDefaultModel()).toBe(DEFAULT_MODEL);
    });
  });

  describe('LlmAgent.resetDefaultModel', () => {
    it('should reset to built-in default', () => {
      LlmAgent.setDefaultModel('custom-model');
      LlmAgent.resetDefaultModel();
      expect(LlmAgent.getDefaultModel()).toBe(DEFAULT_MODEL);
    });
  });

  describe('canonicalModel', () => {
    it('should use explicitly set model on agent', () => {
      const mockLlm = new MockLlm('explicit-model');
      const agent = new LlmAgent({
        name: 'test_agent',
        instruction: 'Test instruction',
        model: mockLlm,
      });

      expect(agent.canonicalModel).toBe(mockLlm);
    });

    it('should use model string on agent', () => {
      // Store the raw model string directly on the agent
      const agent = new LlmAgent({
        name: 'test_agent',
        instruction: 'Test instruction',
        model: 'custom-model-string',
      });

      // Access the model property directly (before canonicalModel resolution)
      expect(agent.model).toBe('custom-model-string');
    });

    it('should inherit model from ancestor LlmAgent', () => {
      const mockLlm = new MockLlm('parent-model');
      const parentAgent = new LlmAgent({
        name: 'parent_agent',
        instruction: 'Parent instruction',
        model: mockLlm,
      });

      const childAgent = new LlmAgent({
        name: 'child_agent',
        instruction: 'Child instruction',
        // No model specified
      });

      // Set up parent-child relationship
      (parentAgent as any).subAgents = [childAgent];
      (childAgent as any).parentAgent = parentAgent;

      expect(childAgent.canonicalModel).toBe(mockLlm);
    });

    it('should fall back to default model when no model specified and no ancestor', () => {
      // Set a mock as the default to avoid API key requirement
      const mockDefaultLlm = new MockLlm(DEFAULT_MODEL);
      LlmAgent.setDefaultModel(mockDefaultLlm);

      const agent = new LlmAgent({
        name: 'test_agent',
        instruction: 'Test instruction',
        // No model specified
      });

      // Should use the default model
      const model = agent.canonicalModel;
      expect(model).toBe(mockDefaultLlm);
      expect(model.model).toBe(DEFAULT_MODEL);
    });

    it('should use custom default model set via setDefaultModel (string)', () => {
      // Set a mock with the custom model name
      const mockCustomLlm = new MockLlm('gemini-2.5-pro');
      LlmAgent.setDefaultModel(mockCustomLlm);

      const agent = new LlmAgent({
        name: 'test_agent',
        instruction: 'Test instruction',
        // No model specified
      });

      const model = agent.canonicalModel;
      expect(model).toBe(mockCustomLlm);
      expect(model.model).toBe('gemini-2.5-pro');
    });

    it('should use BaseLlm default model set via setDefaultModel', () => {
      const mockLlm = new MockLlm('mock-default-model');
      LlmAgent.setDefaultModel(mockLlm);

      const agent = new LlmAgent({
        name: 'test_agent',
        instruction: 'Test instruction',
        // No model specified
      });

      expect(agent.canonicalModel).toBe(mockLlm);
    });

    it('should fall back to default when ancestor has no model', () => {
      // Set a mock as the default to avoid API key requirement
      const mockDefaultLlm = new MockLlm(DEFAULT_MODEL);
      LlmAgent.setDefaultModel(mockDefaultLlm);

      // Create a non-LlmAgent parent (LoopAgent) with a nested agent that has its own model
      const nestedMockLlm = new MockLlm('nested_model');
      const loopAgent = new LoopAgent({
        name: 'loop_agent',
        agent: new LlmAgent({
          name: 'nested_agent',
          instruction: 'Nested instruction',
          model: nestedMockLlm,
        }),
        maxIterations: 1,
      });

      const childAgent = new LlmAgent({
        name: 'child_agent',
        instruction: 'Child instruction',
        // No model specified
      });

      // Set up parent-child relationship with non-LlmAgent parent
      (loopAgent as any).subAgents = [childAgent];
      (childAgent as any).parentAgent = loopAgent;

      // Should fall back to default since LoopAgent doesn't have a model
      const model = childAgent.canonicalModel;
      expect(model).toBe(mockDefaultLlm);
      expect(model.model).toBe(DEFAULT_MODEL);
    });

    it('should inherit through multiple levels of LlmAgent ancestry', () => {
      const mockLlm = new MockLlm('root-model');
      const rootAgent = new LlmAgent({
        name: 'root_agent',
        instruction: 'Root instruction',
        model: mockLlm,
      });

      const middleAgent = new LlmAgent({
        name: 'middle_agent',
        instruction: 'Middle instruction',
        // No model
      });

      const leafAgent = new LlmAgent({
        name: 'leaf_agent',
        instruction: 'Leaf instruction',
        // No model
      });

      // Set up ancestry: root -> middle -> leaf
      (rootAgent as any).subAgents = [middleAgent];
      (middleAgent as any).parentAgent = rootAgent;
      (middleAgent as any).subAgents = [leafAgent];
      (leafAgent as any).parentAgent = middleAgent;

      // Leaf should inherit from root through middle
      expect(leafAgent.canonicalModel).toBe(mockLlm);
    });
  });
});
