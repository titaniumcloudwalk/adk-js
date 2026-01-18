/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {BaseLlm, BaseLlmConnection, Event, InMemorySessionService, InvocationContext, LlmAgent, LlmRequest, LlmResponse, PluginManager, Session,} from '@google/adk';
import {Content} from '@google/genai';
import {describe, it, expect, beforeEach} from 'vitest';

class MockLlmConnection implements BaseLlmConnection {
  sendHistory(history: Content[]): Promise<void> {
    return Promise.resolve();
  }
  sendContent(content: Content): Promise<void> {
    return Promise.resolve();
  }
  sendRealtime(blob: {
    data: string,
    mimeType: string,
  }): Promise<void> {
    return Promise.resolve();
  }
  async * receive(): AsyncGenerator<LlmResponse, void, void> {
    // No-op for mock.
  }
  async close(): Promise<void> {
    return Promise.resolve();
  }
}

class MockLlm extends BaseLlm {
  capturedRequest: LlmRequest|null = null;

  constructor() {
    super({model: 'mock-llm'});
  }

  async *
      generateContentAsync(request: LlmRequest):
          AsyncGenerator<LlmResponse, void, void> {
    this.capturedRequest = request;
    yield {content: {parts: [{text: 'Mock response'}]}};
  }

  async connect(llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    return new MockLlmConnection();
  }
}

describe('LlmAgent staticInstruction feature', () => {
  let session: Session;
  let pluginManager: PluginManager;
  let sessionService: InMemorySessionService;

  beforeEach(async () => {
    sessionService = new InMemorySessionService();
    session = await sessionService.createSession({
      appName: 'test-app',
      userId: 'test-user',
    });
    pluginManager = new PluginManager();
  });

  it('should add staticInstruction to systemInstruction and instruction to systemInstruction when staticInstruction is not set', async () => {
    const mockLlm = new MockLlm();
    const agent = new LlmAgent({
      name: 'test_agent',
      model: mockLlm,
      instruction: 'You are a helpful assistant.',
    });

    const invocationContext = new InvocationContext({
      invocationId: 'inv_123',
      session,
      agent,
      pluginManager,
    });

    const llmRequest: LlmRequest = {
      contents: [],
      liveConnectConfig: {},
      toolsDict: {},
    };

    // Run the request processor
    for await (const _ of agent.requestProcessors[2].runAsync(invocationContext, llmRequest)) {
      // Process events
    }

    // Verify instruction went to systemInstruction
    expect(llmRequest.config?.systemInstruction).toContain('You are a helpful assistant.');
    expect(llmRequest.contents.length).toBe(0);
  });

  it('should add staticInstruction to systemInstruction and instruction to contents when staticInstruction is set', async () => {
    const mockLlm = new MockLlm();
    const staticInstruction: Content = {
      role: 'user',
      parts: [{text: 'You are an expert in TypeScript programming.'}],
    };
    const agent = new LlmAgent({
      name: 'test_agent',
      model: mockLlm,
      staticInstruction,
      instruction: 'Help the user with their current question.',
    });

    const invocationContext = new InvocationContext({
      invocationId: 'inv_123',
      session,
      agent,
      pluginManager,
    });

    const llmRequest: LlmRequest = {
      contents: [],
      liveConnectConfig: {},
      toolsDict: {},
    };

    // Run the request processor
    for await (const _ of agent.requestProcessors[2].runAsync(invocationContext, llmRequest)) {
      // Process events
    }

    // Verify static instruction went to systemInstruction
    expect(llmRequest.config?.systemInstruction).toContain('You are an expert in TypeScript programming.');

    // Verify dynamic instruction went to contents
    expect(llmRequest.contents.length).toBe(1);
    expect(llmRequest.contents[0].role).toBe('user');
    expect(llmRequest.contents[0].parts[0]).toEqual({text: 'Help the user with their current question.'});
  });

  it('should handle staticInstruction with multiple parts', async () => {
    const mockLlm = new MockLlm();
    const staticInstruction: Content = {
      role: 'user',
      parts: [
        {text: 'You are an expert in TypeScript programming.'},
        {text: 'You have deep knowledge of Node.js.'},
      ],
    };
    const agent = new LlmAgent({
      name: 'test_agent',
      model: mockLlm,
      staticInstruction,
      instruction: 'Help the user with their current question.',
    });

    const invocationContext = new InvocationContext({
      invocationId: 'inv_123',
      session,
      agent,
      pluginManager,
    });

    const llmRequest: LlmRequest = {
      contents: [],
      liveConnectConfig: {},
      toolsDict: {},
    };

    // Run the request processor
    for await (const _ of agent.requestProcessors[2].runAsync(invocationContext, llmRequest)) {
      // Process events
    }

    // Verify static instruction parts are joined with \n\n
    expect(llmRequest.config?.systemInstruction).toContain('You are an expert in TypeScript programming.');
    expect(llmRequest.config?.systemInstruction).toContain('You have deep knowledge of Node.js.');
  });

  it('should handle staticInstruction without dynamic instruction', async () => {
    const mockLlm = new MockLlm();
    const staticInstruction: Content = {
      role: 'user',
      parts: [{text: 'You are a helpful assistant.'}],
    };
    const agent = new LlmAgent({
      name: 'test_agent',
      model: mockLlm,
      staticInstruction,
      // No instruction field set
    });

    const invocationContext = new InvocationContext({
      invocationId: 'inv_123',
      session,
      agent,
      pluginManager,
    });

    const llmRequest: LlmRequest = {
      contents: [],
      liveConnectConfig: {},
      toolsDict: {},
    };

    // Run the request processor
    for await (const _ of agent.requestProcessors[2].runAsync(invocationContext, llmRequest)) {
      // Process events
    }

    // Verify static instruction went to systemInstruction
    expect(llmRequest.config?.systemInstruction).toContain('You are a helpful assistant.');

    // Verify no user content was added
    expect(llmRequest.contents.length).toBe(0);
  });

  it('should work with globalInstruction and staticInstruction together', async () => {
    const mockLlm = new MockLlm();
    const staticInstruction: Content = {
      role: 'user',
      parts: [{text: 'You are an expert in TypeScript programming.'}],
    };
    const agent = new LlmAgent({
      name: 'test_agent',
      model: mockLlm,
      staticInstruction,
      instruction: 'Help the user with their current question.',
      globalInstruction: 'Always be polite and professional.',
    });

    const invocationContext = new InvocationContext({
      invocationId: 'inv_123',
      session,
      agent,
      pluginManager,
    });

    const llmRequest: LlmRequest = {
      contents: [],
      liveConnectConfig: {},
      toolsDict: {},
    };

    // Run the request processor
    for await (const _ of agent.requestProcessors[2].runAsync(invocationContext, llmRequest)) {
      // Process events
    }

    // Verify both global and static instructions are in systemInstruction
    expect(llmRequest.config?.systemInstruction).toContain('Always be polite and professional.');
    expect(llmRequest.config?.systemInstruction).toContain('You are an expert in TypeScript programming.');

    // Verify dynamic instruction went to contents
    expect(llmRequest.contents.length).toBe(1);
    expect(llmRequest.contents[0].parts[0]).toEqual({text: 'Help the user with their current question.'});
  });
});
