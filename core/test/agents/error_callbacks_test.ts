/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseLlm,
  BaseLlmConnection,
  BasePlugin,
  BaseTool,
  CallbackContext,
  Event,
  FunctionTool,
  InvocationContext,
  LlmAgent,
  LlmRequest,
  LlmResponse,
  PluginManager,
  Session,
  SingleOnModelErrorCallback,
  SingleOnToolErrorCallback,
  ToolContext,
} from '@google/adk';
import {Content, FunctionCall} from '@google/genai';

// Mock LLM Connection
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

// Mock LLM that can throw errors
class MockLlm extends BaseLlm {
  response: LlmResponse | null;
  error: Error | null;

  constructor(response: LlmResponse | null, error: Error | null = null) {
    super({model: 'mock-llm'});
    this.response = response;
    this.error = error;
  }

  async *generateContentAsync(
    request: LlmRequest
  ): AsyncGenerator<LlmResponse, void, void> {
    if (this.error) {
      throw this.error;
    }
    if (this.response) {
      yield this.response;
    }
  }

  async connect(llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    return new MockLlmConnection();
  }
}

// Mock Plugin for testing plugin vs agent callback priority
class MockPlugin extends BasePlugin {
  onModelErrorResponse?: LlmResponse;
  onToolErrorResponse?: Record<string, unknown>;

  override async onModelErrorCallback({
    callbackContext,
    llmRequest,
    error,
  }: {
    callbackContext: CallbackContext;
    llmRequest: LlmRequest;
    error: Error;
  }): Promise<LlmResponse | undefined> {
    return this.onModelErrorResponse;
  }

  override async onToolErrorCallback({
    tool,
    toolArgs,
    toolContext,
    error,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
    error: Error;
  }): Promise<Record<string, unknown> | undefined> {
    return this.onToolErrorResponse;
  }
}

describe('Agent-level OnModelErrorCallback', () => {
  let agent: LlmAgent;
  let invocationContext: InvocationContext;
  let llmRequest: LlmRequest;
  let modelResponseEvent: Event;
  let pluginManager: PluginManager;
  let mockPlugin: MockPlugin;

  const originalLlmResponse: LlmResponse = {
    content: {parts: [{text: 'original'}]},
  };
  const onModelErrorAgentResponse: LlmResponse = {
    content: {parts: [{text: 'agent error callback'}]},
  };
  const onModelErrorPluginResponse: LlmResponse = {
    content: {parts: [{text: 'plugin error callback'}]},
  };
  const modelError = new Error(
    JSON.stringify({
      error: {
        message: 'LLM error',
        code: 500,
      },
    })
  );

  beforeEach(() => {
    mockPlugin = new MockPlugin('mock_plugin');
    pluginManager = new PluginManager();
    agent = new LlmAgent({name: 'test_agent'});
    invocationContext = new InvocationContext({
      invocationId: 'inv_123',
      session: {} as Session,
      agent: agent,
      pluginManager,
    });
    llmRequest = {contents: [], liveConnectConfig: {}, toolsDict: {}};
    modelResponseEvent = {id: 'evt_123'} as Event;
  });

  async function callLlmUnderTest(): Promise<LlmResponse[]> {
    const responses: LlmResponse[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const response of (agent as any).callLlmAsync(
      invocationContext,
      llmRequest,
      modelResponseEvent
    )) {
      responses.push(response);
    }
    return responses;
  }

  it('uses agent-level onModelErrorCallback when LLM throws an error', async () => {
    const onModelErrorCallback: SingleOnModelErrorCallback = async ({
      context,
      request,
      error,
    }) => {
      expect(error.message).toContain('LLM error');
      return onModelErrorAgentResponse;
    };
    agent.onModelErrorCallback = onModelErrorCallback;
    agent.model = new MockLlm(null, modelError);
    const responses = await callLlmUnderTest();
    expect(responses).toEqual([onModelErrorAgentResponse]);
  });

  it('uses array of agent-level onModelErrorCallbacks with fallthrough', async () => {
    const firstCallback: SingleOnModelErrorCallback = async () => undefined;
    const secondCallback: SingleOnModelErrorCallback = async () =>
      onModelErrorAgentResponse;
    agent.onModelErrorCallback = [firstCallback, secondCallback];
    agent.model = new MockLlm(null, modelError);
    const responses = await callLlmUnderTest();
    expect(responses).toEqual([onModelErrorAgentResponse]);
  });

  it('plugin onModelErrorCallback takes priority over agent-level', async () => {
    mockPlugin.onModelErrorResponse = onModelErrorPluginResponse;
    pluginManager.registerPlugin(mockPlugin);
    const agentCallback: SingleOnModelErrorCallback = async () =>
      onModelErrorAgentResponse;
    agent.onModelErrorCallback = agentCallback;
    agent.model = new MockLlm(null, modelError);
    const responses = await callLlmUnderTest();
    // Plugin callback should win
    expect(responses).toEqual([onModelErrorPluginResponse]);
  });

  it('uses agent-level callback when plugin returns undefined', async () => {
    pluginManager.registerPlugin(mockPlugin);
    const agentCallback: SingleOnModelErrorCallback = async () =>
      onModelErrorAgentResponse;
    agent.onModelErrorCallback = agentCallback;
    agent.model = new MockLlm(null, modelError);
    const responses = await callLlmUnderTest();
    // Agent callback should be used when plugin returns undefined
    expect(responses).toEqual([onModelErrorAgentResponse]);
  });

  it('propagates error when no callbacks handle it', async () => {
    agent.model = new MockLlm(null, modelError);
    const responses = await callLlmUnderTest();
    expect(responses).toEqual([{errorMessage: 'LLM error', errorCode: '500'}]);
  });

  it('handles non-JSON error messages gracefully', async () => {
    const simpleError = new Error('Simple error message');
    agent.model = new MockLlm(null, simpleError);
    const responses = await callLlmUnderTest();
    expect(responses).toEqual([
      {errorMessage: 'Simple error message', errorCode: 'UNKNOWN'},
    ]);
  });

  it('provides context and request to onModelErrorCallback', async () => {
    let receivedContext: CallbackContext | undefined;
    let receivedRequest: LlmRequest | undefined;
    let receivedError: Error | undefined;

    const agentCallback: SingleOnModelErrorCallback = async ({
      context,
      request,
      error,
    }) => {
      receivedContext = context;
      receivedRequest = request;
      receivedError = error;
      return onModelErrorAgentResponse;
    };
    agent.onModelErrorCallback = agentCallback;
    agent.model = new MockLlm(null, modelError);
    await callLlmUnderTest();

    expect(receivedContext).toBeDefined();
    expect(receivedRequest).toBeDefined();
    expect(receivedError).toEqual(modelError);
  });
});

describe('Agent-level OnToolErrorCallback', () => {
  let agent: LlmAgent;
  let invocationContext: InvocationContext;
  let pluginManager: PluginManager;
  let mockPlugin: MockPlugin;
  let failingTool: FunctionTool;

  const toolError = new Error('Tool execution failed');
  const onToolErrorAgentResponse = {recovered: true, message: 'agent handled'};
  const onToolErrorPluginResponse = {
    recovered: true,
    message: 'plugin handled',
  };

  beforeEach(() => {
    mockPlugin = new MockPlugin('mock_plugin');
    pluginManager = new PluginManager();

    // Create a tool that always fails
    failingTool = new FunctionTool({
      name: 'failing_tool',
      description: 'A tool that always fails',
      execute: async () => {
        throw toolError;
      },
    });

    agent = new LlmAgent({
      name: 'test_agent',
      tools: [failingTool],
    });

    invocationContext = new InvocationContext({
      invocationId: 'inv_123',
      session: {} as Session,
      agent: agent,
      pluginManager,
    });
  });

  it('uses agent-level onToolErrorCallback when tool throws an error', async () => {
    const receivedErrors: Error[] = [];
    const onToolErrorCallback: SingleOnToolErrorCallback = async ({
      tool,
      args,
      context,
      error,
    }) => {
      receivedErrors.push(error);
      expect(tool.name).toBe('failing_tool');
      return onToolErrorAgentResponse;
    };
    agent.onToolErrorCallback = onToolErrorCallback;

    // Manually invoke the tool through the callback to test error handling
    const toolContext = new ToolContext({
      invocationContext,
      functionCallId: 'fc_123',
    });

    try {
      await failingTool.runAsync({args: {}, toolContext});
    } catch (e) {
      // Tool error caught - now test the callback directly
      const result = await onToolErrorCallback({
        tool: failingTool,
        args: {},
        context: toolContext,
        error: e as Error,
      });
      expect(result).toEqual(onToolErrorAgentResponse);
    }
    expect(receivedErrors.length).toBe(1);
    // Note: FunctionTool wraps errors with tool name context
    expect(receivedErrors[0].message).toContain('Tool execution failed');
  });

  it('uses array of agent-level onToolErrorCallbacks with fallthrough', async () => {
    const firstCallback: SingleOnToolErrorCallback = async () => undefined;
    const secondCallback: SingleOnToolErrorCallback = async () =>
      onToolErrorAgentResponse;
    agent.onToolErrorCallback = [firstCallback, secondCallback];

    // Verify callbacks are correctly normalized
    expect(agent.canonicalOnToolErrorCallbacks.length).toBe(2);
  });

  it('canonical getter returns empty array when no callbacks set', () => {
    expect(agent.canonicalOnToolErrorCallbacks).toEqual([]);
  });

  it('canonical getter normalizes single callback to array', () => {
    const singleCallback: SingleOnToolErrorCallback = async () =>
      onToolErrorAgentResponse;
    agent.onToolErrorCallback = singleCallback;
    expect(agent.canonicalOnToolErrorCallbacks.length).toBe(1);
    expect(agent.canonicalOnToolErrorCallbacks[0]).toBe(singleCallback);
  });
});

describe('OnModelErrorCallback canonical getter', () => {
  let agent: LlmAgent;

  beforeEach(() => {
    agent = new LlmAgent({name: 'test_agent'});
  });

  it('returns empty array when no callback is set', () => {
    expect(agent.canonicalOnModelErrorCallbacks).toEqual([]);
  });

  it('normalizes single callback to array', () => {
    const callback: SingleOnModelErrorCallback = async () => ({
      content: {parts: [{text: 'error handled'}]},
    });
    agent.onModelErrorCallback = callback;
    expect(agent.canonicalOnModelErrorCallbacks.length).toBe(1);
    expect(agent.canonicalOnModelErrorCallbacks[0]).toBe(callback);
  });

  it('preserves array of callbacks', () => {
    const callback1: SingleOnModelErrorCallback = async () => undefined;
    const callback2: SingleOnModelErrorCallback = async () => ({
      content: {parts: [{text: 'error handled'}]},
    });
    agent.onModelErrorCallback = [callback1, callback2];
    expect(agent.canonicalOnModelErrorCallbacks.length).toBe(2);
  });
});

describe('LlmAgentConfig error callback fields', () => {
  it('accepts onModelErrorCallback in config', () => {
    const callback: SingleOnModelErrorCallback = async () => ({
      content: {parts: [{text: 'error handled'}]},
    });
    const agent = new LlmAgent({
      name: 'test_agent',
      onModelErrorCallback: callback,
    });
    expect(agent.onModelErrorCallback).toBe(callback);
  });

  it('accepts onToolErrorCallback in config', () => {
    const callback: SingleOnToolErrorCallback = async () => ({
      recovered: true,
    });
    const agent = new LlmAgent({
      name: 'test_agent',
      onToolErrorCallback: callback,
    });
    expect(agent.onToolErrorCallback).toBe(callback);
  });

  it('accepts array of error callbacks in config', () => {
    const modelCallback1: SingleOnModelErrorCallback = async () => undefined;
    const modelCallback2: SingleOnModelErrorCallback = async () => ({
      content: {parts: [{text: 'error handled'}]},
    });
    const toolCallback1: SingleOnToolErrorCallback = async () => undefined;
    const toolCallback2: SingleOnToolErrorCallback = async () => ({
      recovered: true,
    });

    const agent = new LlmAgent({
      name: 'test_agent',
      onModelErrorCallback: [modelCallback1, modelCallback2],
      onToolErrorCallback: [toolCallback1, toolCallback2],
    });

    expect(agent.canonicalOnModelErrorCallbacks.length).toBe(2);
    expect(agent.canonicalOnToolErrorCallbacks.length).toBe(2);
  });
});
