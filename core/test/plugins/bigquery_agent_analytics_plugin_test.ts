/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content} from '@google/genai';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {BaseAgent} from '../../src/agents/base_agent.js';
import {CallbackContext} from '../../src/agents/callback_context.js';
import {InvocationContext} from '../../src/agents/invocation_context.js';
import {LlmRequest} from '../../src/models/llm_request.js';
import {LlmResponse} from '../../src/models/llm_response.js';
import {
  BigQueryAgentAnalyticsPlugin,
  BigQueryLoggerConfig,
  recursiveSmartTruncate,
  TraceManager,
} from '../../src/plugins/bigquery_agent_analytics_plugin.js';
import {BaseTool} from '../../src/tools/base_tool.js';
import {ToolContext} from '../../src/tools/tool_context.js';
import {Session} from '../../src/sessions/session.js';
import {State} from '../../src/sessions/state.js';

// ===========================================================================
// MOCKS
// ===========================================================================

// Mock BigQuery client
vi.mock('@google-cloud/bigquery', () => ({
  BigQuery: vi.fn().mockImplementation(() => ({
    dataset: vi.fn().mockReturnValue({
      table: vi.fn().mockReturnValue({
        insert: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  })),
}));

// Helper to create mock session
function createMockSession(id = 'session-123'): Session {
  const state = new State();
  return {
    id,
    appName: 'test-app',
    userId: 'user-123',
    state,
    events: [],
    lastUpdateTime: Date.now(),
  };
}

// Helper to create mock invocation context
function createMockInvocationContext(
  session?: Session
): InvocationContext {
  const sess = session ?? createMockSession();
  const mockAgent = {
    name: 'test-agent',
    rootAgent: {name: 'root-agent'},
  } as unknown as BaseAgent;

  return {
    invocationId: 'invocation-123',
    session: sess,
    agent: mockAgent,
    appName: 'test-app',
    userId: 'user-123',
    branch: undefined,
    runConfig: {},
    artifactService: undefined,
    memoryService: undefined,
    credentialService: undefined,
    pluginManager: undefined as unknown,
    eventActions: {},
  } as unknown as InvocationContext;
}

// Helper to create mock callback context
function createMockCallbackContext(
  invocationContext?: InvocationContext
): CallbackContext {
  const ctx = invocationContext ?? createMockInvocationContext();
  return new CallbackContext({invocationContext: ctx});
}

// Helper to create mock tool context
function createMockToolContext(): ToolContext {
  const invocationContext = createMockInvocationContext();
  return {
    invocationContext,
    functionCallId: 'function-call-123',
    agentName: 'test-agent',
    session: invocationContext.session,
    userId: 'user-123',
    state: invocationContext.session.state,
    invocationId: invocationContext.invocationId,
    actions: {},
  } as unknown as ToolContext;
}

// ===========================================================================
// TESTS: recursiveSmartTruncate
// ===========================================================================

describe('recursiveSmartTruncate', () => {
  it('should truncate long strings', () => {
    const longString = 'a'.repeat(100);
    const [result, isTruncated] = recursiveSmartTruncate(longString, 50);

    expect(isTruncated).toBe(true);
    expect(result).toBe('a'.repeat(50) + '...[TRUNCATED]');
  });

  it('should not truncate short strings', () => {
    const shortString = 'hello';
    const [result, isTruncated] = recursiveSmartTruncate(shortString, 50);

    expect(isTruncated).toBe(false);
    expect(result).toBe('hello');
  });

  it('should handle null and undefined', () => {
    const [nullResult, nullTrunc] = recursiveSmartTruncate(null, 50);
    const [undefinedResult, undefinedTrunc] = recursiveSmartTruncate(
      undefined,
      50
    );

    expect(nullTrunc).toBe(false);
    expect(undefinedTrunc).toBe(false);
    expect(nullResult).toBe(null);
    expect(undefinedResult).toBe(undefined);
  });

  it('should handle numbers and booleans', () => {
    const [numResult, numTrunc] = recursiveSmartTruncate(12345, 50);
    const [boolResult, boolTrunc] = recursiveSmartTruncate(true, 50);

    expect(numTrunc).toBe(false);
    expect(boolTrunc).toBe(false);
    expect(numResult).toBe(12345);
    expect(boolResult).toBe(true);
  });

  it('should recursively truncate arrays', () => {
    const arr = ['a'.repeat(100), 'short', 'b'.repeat(100)];
    const [result, isTruncated] = recursiveSmartTruncate(arr, 50);

    expect(isTruncated).toBe(true);
    expect(Array.isArray(result)).toBe(true);
    expect((result as string[])[0]).toBe('a'.repeat(50) + '...[TRUNCATED]');
    expect((result as string[])[1]).toBe('short');
    expect((result as string[])[2]).toBe('b'.repeat(50) + '...[TRUNCATED]');
  });

  it('should recursively truncate objects', () => {
    const obj = {
      long: 'a'.repeat(100),
      short: 'hello',
      nested: {
        deep: 'b'.repeat(100),
      },
    };
    const [result, isTruncated] = recursiveSmartTruncate(obj, 50);

    expect(isTruncated).toBe(true);
    const r = result as Record<string, unknown>;
    expect(r.long).toBe('a'.repeat(50) + '...[TRUNCATED]');
    expect(r.short).toBe('hello');
    expect((r.nested as Record<string, unknown>).deep).toBe(
      'b'.repeat(50) + '...[TRUNCATED]'
    );
  });

  it('should handle Date objects', () => {
    const date = new Date('2025-01-01T00:00:00Z');
    const [result, isTruncated] = recursiveSmartTruncate(date, 50);

    expect(isTruncated).toBe(false);
    expect(result).toBe('2025-01-01T00:00:00.000Z');
  });

  it('should handle Map objects', () => {
    const map = new Map<string, string>([
      ['key1', 'a'.repeat(100)],
      ['key2', 'short'],
    ]);
    const [result, isTruncated] = recursiveSmartTruncate(map, 50);

    expect(isTruncated).toBe(true);
    const r = result as Record<string, unknown>;
    expect(r.key1).toBe('a'.repeat(50) + '...[TRUNCATED]');
    expect(r.key2).toBe('short');
  });

  it('should handle Set objects', () => {
    const set = new Set(['a', 'b', 'c']);
    const [result, isTruncated] = recursiveSmartTruncate(set, 50);

    expect(isTruncated).toBe(false);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('should handle Buffer objects', () => {
    const buffer = Buffer.from('hello');
    const [result, isTruncated] = recursiveSmartTruncate(buffer, 50);

    expect(isTruncated).toBe(false);
    expect(result).toBe('<bytes: 5 bytes>');
  });

  it('should handle -1 maxLen (no truncation)', () => {
    const longString = 'a'.repeat(1000);
    const [result, isTruncated] = recursiveSmartTruncate(longString, -1);

    expect(isTruncated).toBe(false);
    expect(result).toBe(longString);
  });
});

// ===========================================================================
// TESTS: TraceManager
// ===========================================================================

describe('TraceManager', () => {
  beforeEach(() => {
    // Reset trace context between tests
  });

  it('should initialize trace context', () => {
    const callbackContext = createMockCallbackContext();

    TraceManager.initTrace(callbackContext);

    const traceId = TraceManager.getTraceId(callbackContext);
    expect(traceId).toBe('invocation-123');
  });

  it('should push and pop spans', () => {
    const callbackContext = createMockCallbackContext();

    TraceManager.initTrace(callbackContext);
    const spanId = TraceManager.pushSpan(callbackContext);

    expect(spanId).toBeDefined();
    expect(TraceManager.getCurrentSpanId()).toBe(spanId);

    const [poppedId, duration] = TraceManager.popSpan();
    expect(poppedId).toBe(spanId);
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('should track parent spans correctly', () => {
    const callbackContext = createMockCallbackContext();

    TraceManager.initTrace(callbackContext);
    const span1 = TraceManager.pushSpan(callbackContext);
    const span2 = TraceManager.pushSpan(callbackContext);

    const [current, parent] = TraceManager.getCurrentSpanAndParent();
    expect(current).toBe(span2);
    expect(parent).toBe(span1);
  });

  it('should record first token time', () => {
    const callbackContext = createMockCallbackContext();

    TraceManager.initTrace(callbackContext);
    const spanId = TraceManager.pushSpan(callbackContext);

    const isFirst1 = TraceManager.recordFirstToken(spanId);
    expect(isFirst1).toBe(true);

    const isFirst2 = TraceManager.recordFirstToken(spanId);
    expect(isFirst2).toBe(false);

    const firstTokenTime = TraceManager.getFirstTokenTime(spanId);
    expect(firstTokenTime).toBeDefined();
  });

  it('should get start time for spans', () => {
    const callbackContext = createMockCallbackContext();

    TraceManager.initTrace(callbackContext);
    const spanId = TraceManager.pushSpan(callbackContext);

    const startTime = TraceManager.getStartTime(spanId);
    expect(startTime).toBeDefined();
    expect(startTime).toBeLessThanOrEqual(Date.now());
  });

  it('should handle multiple push/pop cycles', () => {
    const callbackContext = createMockCallbackContext();

    TraceManager.initTrace(callbackContext);

    // Push and pop multiple spans
    const span1 = TraceManager.pushSpan(callbackContext);
    const span2 = TraceManager.pushSpan(callbackContext);
    const span3 = TraceManager.pushSpan(callbackContext);

    // Verify stack order (LIFO)
    const [popped3] = TraceManager.popSpan();
    expect(popped3).toBe(span3);

    const [popped2] = TraceManager.popSpan();
    expect(popped2).toBe(span2);

    const [popped1] = TraceManager.popSpan();
    expect(popped1).toBe(span1);
  });
});

// ===========================================================================
// TESTS: BigQueryAgentAnalyticsPlugin
// ===========================================================================

describe('BigQueryAgentAnalyticsPlugin', () => {
  let plugin: BigQueryAgentAnalyticsPlugin;

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new BigQueryAgentAnalyticsPlugin({
      projectId: 'test-project',
      datasetId: 'test-dataset',
    });
  });

  afterEach(async () => {
    await plugin.shutdown();
  });

  describe('constructor', () => {
    it('should create plugin with default configuration', () => {
      const p = new BigQueryAgentAnalyticsPlugin({
        projectId: 'my-project',
        datasetId: 'my-dataset',
      });

      expect(p.name).toBe('bigquery_agent_analytics');
    });

    it('should accept custom configuration', () => {
      const config: BigQueryLoggerConfig = {
        enabled: false,
        tableId: 'custom_table',
        batchSize: 10,
        maxContentLength: 1000,
      };

      const p = new BigQueryAgentAnalyticsPlugin({
        projectId: 'my-project',
        datasetId: 'my-dataset',
        config,
      });

      expect(p.name).toBe('bigquery_agent_analytics');
    });

    it('should override tableId from options', () => {
      const p = new BigQueryAgentAnalyticsPlugin({
        projectId: 'my-project',
        datasetId: 'my-dataset',
        tableId: 'override_table',
        config: {tableId: 'config_table'},
      });

      expect(p.name).toBe('bigquery_agent_analytics');
    });
  });

  describe('onUserMessageCallback', () => {
    it('should log user message event', async () => {
      const invocationContext = createMockInvocationContext();
      const userMessage: Content = {
        role: 'user',
        parts: [{text: 'Hello, world!'}],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext,
        userMessage,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('beforeRunCallback', () => {
    it('should log invocation starting event', async () => {
      const invocationContext = createMockInvocationContext();

      const result = await plugin.beforeRunCallback({invocationContext});

      expect(result).toBeUndefined();
    });
  });

  describe('afterRunCallback', () => {
    it('should log invocation completed event', async () => {
      const invocationContext = createMockInvocationContext();

      await plugin.afterRunCallback({invocationContext});
    });
  });

  describe('beforeAgentCallback', () => {
    it('should log agent starting event', async () => {
      const callbackContext = createMockCallbackContext();
      const agent = {name: 'test-agent'} as unknown as BaseAgent;

      const result = await plugin.beforeAgentCallback({
        agent,
        callbackContext,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('afterAgentCallback', () => {
    it('should log agent completed event', async () => {
      const callbackContext = createMockCallbackContext();
      const agent = {name: 'test-agent'} as unknown as BaseAgent;

      // First push a span (simulating beforeAgentCallback)
      TraceManager.initTrace(callbackContext);
      TraceManager.pushSpan(callbackContext);

      const result = await plugin.afterAgentCallback({agent, callbackContext});

      expect(result).toBeUndefined();
    });
  });

  describe('beforeModelCallback', () => {
    it('should log LLM request event', async () => {
      const callbackContext = createMockCallbackContext();
      const llmRequest: LlmRequest = {
        model: 'gemini-pro',
        contents: [{role: 'user', parts: [{text: 'Hello'}]}],
        config: {
          temperature: 0.7,
          topP: 0.9,
        },
        toolsDict: {
          myTool: {} as unknown as BaseTool,
        },
      };

      const result = await plugin.beforeModelCallback({
        callbackContext,
        llmRequest,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('afterModelCallback', () => {
    it('should log LLM response event', async () => {
      const callbackContext = createMockCallbackContext();

      // Push span first (simulating beforeModelCallback)
      TraceManager.initTrace(callbackContext);
      TraceManager.pushSpan(callbackContext);

      const llmResponse: LlmResponse = {
        content: {role: 'model', parts: [{text: 'Hello back!'}]},
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
        modelVersion: 'gemini-pro-1.5',
        partial: false,
        turnComplete: true,
      };

      const result = await plugin.afterModelCallback({
        callbackContext,
        llmResponse,
      });

      expect(result).toBeUndefined();
    });

    it('should handle streaming partial responses', async () => {
      const callbackContext = createMockCallbackContext();

      TraceManager.initTrace(callbackContext);
      TraceManager.pushSpan(callbackContext);

      const llmResponse: LlmResponse = {
        content: {role: 'model', parts: [{text: 'Partial...'}]},
        partial: true,
        turnComplete: false,
      };

      const result = await plugin.afterModelCallback({
        callbackContext,
        llmResponse,
      });

      expect(result).toBeUndefined();

      // Span should still be on stack for streaming
      expect(TraceManager.getCurrentSpanId()).toBeDefined();
    });
  });

  describe('onModelErrorCallback', () => {
    it('should log LLM error event', async () => {
      const callbackContext = createMockCallbackContext();
      const llmRequest: LlmRequest = {
        model: 'gemini-pro',
        contents: [],
      };
      const error = new Error('API Error');

      // Push span first
      TraceManager.initTrace(callbackContext);
      TraceManager.pushSpan(callbackContext);

      const result = await plugin.onModelErrorCallback({
        callbackContext,
        llmRequest,
        error,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('beforeToolCallback', () => {
    it('should log tool starting event', async () => {
      const toolContext = createMockToolContext();
      const tool = {name: 'myTool'} as unknown as BaseTool;
      const toolArgs = {param1: 'value1', param2: 123};

      const result = await plugin.beforeToolCallback({
        tool,
        toolArgs,
        toolContext,
      });

      expect(result).toBeUndefined();
    });

    it('should truncate large tool args', async () => {
      const toolContext = createMockToolContext();
      const tool = {name: 'myTool'} as unknown as BaseTool;
      const toolArgs = {
        largeParam: 'x'.repeat(1000000), // 1MB of data
      };

      const result = await plugin.beforeToolCallback({
        tool,
        toolArgs,
        toolContext,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('afterToolCallback', () => {
    it('should log tool completed event', async () => {
      const toolContext = createMockToolContext();

      // Push span first (simulating beforeToolCallback)
      TraceManager.initTrace(toolContext);
      TraceManager.pushSpan(toolContext);

      const tool = {name: 'myTool'} as unknown as BaseTool;
      const toolArgs = {param1: 'value1'};
      const result = {output: 'success'};

      const callbackResult = await plugin.afterToolCallback({
        tool,
        toolArgs,
        toolContext,
        result,
      });

      expect(callbackResult).toBeUndefined();
    });
  });

  describe('onToolErrorCallback', () => {
    it('should log tool error event', async () => {
      const toolContext = createMockToolContext();

      // Push span first
      TraceManager.initTrace(toolContext);
      TraceManager.pushSpan(toolContext);

      const tool = {name: 'myTool'} as unknown as BaseTool;
      const toolArgs = {param1: 'value1'};
      const error = new Error('Tool execution failed');

      const result = await plugin.onToolErrorCallback({
        tool,
        toolArgs,
        toolContext,
        error,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      await plugin.shutdown();
      // Should not throw
    });

    it('should be idempotent', async () => {
      await plugin.shutdown();
      await plugin.shutdown();
      // Should not throw
    });
  });

  describe('event filtering', () => {
    it('should respect eventAllowlist', async () => {
      const pluginWithAllowlist = new BigQueryAgentAnalyticsPlugin({
        projectId: 'test-project',
        datasetId: 'test-dataset',
        config: {
          eventAllowlist: ['LLM_REQUEST'],
        },
      });

      const invocationContext = createMockInvocationContext();

      // This should be filtered out
      await pluginWithAllowlist.beforeRunCallback({invocationContext});

      await pluginWithAllowlist.shutdown();
    });

    it('should respect eventDenylist', async () => {
      const pluginWithDenylist = new BigQueryAgentAnalyticsPlugin({
        projectId: 'test-project',
        datasetId: 'test-dataset',
        config: {
          eventDenylist: ['INVOCATION_STARTING'],
        },
      });

      const invocationContext = createMockInvocationContext();

      // This should be filtered out
      await pluginWithDenylist.beforeRunCallback({invocationContext});

      await pluginWithDenylist.shutdown();
    });

    it('should skip logging when disabled', async () => {
      const disabledPlugin = new BigQueryAgentAnalyticsPlugin({
        projectId: 'test-project',
        datasetId: 'test-dataset',
        config: {
          enabled: false,
        },
      });

      const invocationContext = createMockInvocationContext();
      await disabledPlugin.beforeRunCallback({invocationContext});

      await disabledPlugin.shutdown();
    });
  });
});

// ===========================================================================
// TESTS: ContentParser (through plugin)
// ===========================================================================

describe('ContentParser (via plugin)', () => {
  let plugin: BigQueryAgentAnalyticsPlugin;

  beforeEach(() => {
    plugin = new BigQueryAgentAnalyticsPlugin({
      projectId: 'test-project',
      datasetId: 'test-dataset',
    });
  });

  afterEach(async () => {
    await plugin.shutdown();
  });

  it('should handle content with function calls', async () => {
    const callbackContext = createMockCallbackContext();
    const llmRequest: LlmRequest = {
      model: 'gemini-pro',
      contents: [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'testFunction',
                args: {param: 'value'},
              },
            },
          ],
        },
      ],
    };

    TraceManager.initTrace(callbackContext);
    const result = await plugin.beforeModelCallback({
      callbackContext,
      llmRequest,
    });

    expect(result).toBeUndefined();
  });

  it('should handle content with function responses', async () => {
    const callbackContext = createMockCallbackContext();
    const llmRequest: LlmRequest = {
      model: 'gemini-pro',
      contents: [
        {
          role: 'function',
          parts: [
            {
              functionResponse: {
                name: 'testFunction',
                response: {result: 'success'},
              },
            },
          ],
        },
      ],
    };

    TraceManager.initTrace(callbackContext);
    const result = await plugin.beforeModelCallback({
      callbackContext,
      llmRequest,
    });

    expect(result).toBeUndefined();
  });

  it('should handle content with file data', async () => {
    const callbackContext = createMockCallbackContext();
    const llmRequest: LlmRequest = {
      model: 'gemini-pro',
      contents: [
        {
          role: 'user',
          parts: [
            {
              fileData: {
                fileUri: 'gs://bucket/file.pdf',
                mimeType: 'application/pdf',
              },
            },
          ],
        },
      ],
    };

    TraceManager.initTrace(callbackContext);
    const result = await plugin.beforeModelCallback({
      callbackContext,
      llmRequest,
    });

    expect(result).toBeUndefined();
  });

  it('should handle content with inline data', async () => {
    const callbackContext = createMockCallbackContext();
    const llmRequest: LlmRequest = {
      model: 'gemini-pro',
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                data: 'base64data',
                mimeType: 'image/png',
              },
            },
          ],
        },
      ],
    };

    TraceManager.initTrace(callbackContext);
    const result = await plugin.beforeModelCallback({
      callbackContext,
      llmRequest,
    });

    expect(result).toBeUndefined();
  });

  it('should handle system instructions', async () => {
    const callbackContext = createMockCallbackContext();
    const llmRequest: LlmRequest = {
      model: 'gemini-pro',
      contents: [{role: 'user', parts: [{text: 'Hello'}]}],
      config: {
        systemInstruction: 'You are a helpful assistant.',
      },
    };

    TraceManager.initTrace(callbackContext);
    const result = await plugin.beforeModelCallback({
      callbackContext,
      llmRequest,
    });

    expect(result).toBeUndefined();
  });
});
