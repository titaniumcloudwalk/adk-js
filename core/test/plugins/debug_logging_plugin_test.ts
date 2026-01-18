/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content} from '@google/genai';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {CallbackContext} from '../../src/agents/callback_context.js';
import {InvocationContext} from '../../src/agents/invocation_context.js';
import {LlmAgent} from '../../src/agents/llm_agent.js';
import {createEvent, Event} from '../../src/events/event.js';
import {LlmRequest} from '../../src/models/llm_request.js';
import {LlmResponse} from '../../src/models/llm_response.js';
import {DebugLoggingPlugin} from '../../src/plugins/debug_logging_plugin.js';
import {createSession} from '../../src/sessions/session.js';
import {BaseTool} from '../../src/tools/base_tool.js';
import {ToolContext} from '../../src/tools/tool_context.js';

// Mock fs module
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    appendFileSync: vi.fn(),
  };
});

describe('DebugLoggingPlugin', () => {
  let plugin: DebugLoggingPlugin;
  let mockInvocationContext: InvocationContext;
  let mockCallbackContext: CallbackContext;
  let mockSession: ReturnType<typeof createSession>;
  let mockAgent: LlmAgent;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock session
    mockSession = createSession({
      id: 'test-session-id',
      appName: 'test-app',
      userId: 'test-user',
    });

    // Create mock agent
    mockAgent = new LlmAgent({
      name: 'test_agent',
      model: 'gemini-2.0-flash',
    });

    // Create mock invocation context
    mockInvocationContext = {
      invocationId: 'test-invocation-id',
      session: mockSession,
      appName: 'test-app',
      userId: 'test-user',
      agent: mockAgent,
      branch: undefined,
    } as InvocationContext;

    // Create mock callback context
    mockCallbackContext = {
      invocationId: 'test-invocation-id',
      invocationContext: mockInvocationContext,
      agentName: 'test_agent',
    } as CallbackContext;

    // Create plugin with default options
    plugin = new DebugLoggingPlugin();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor tests
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('should create plugin with default options', () => {
      const p = new DebugLoggingPlugin();
      expect(p.name).toBe('debug_logging_plugin');
    });

    it('should create plugin with custom name', () => {
      const p = new DebugLoggingPlugin({name: 'custom_debug_plugin'});
      expect(p.name).toBe('custom_debug_plugin');
    });

    it('should accept custom output path', () => {
      const p = new DebugLoggingPlugin({outputPath: './custom/debug.yaml'});
      expect(p.name).toBe('debug_logging_plugin');
    });

    it('should accept custom options', () => {
      const p = new DebugLoggingPlugin({
        name: 'my_debug',
        outputPath: './debug/output.yaml',
        includeSessionState: false,
        includeSystemInstruction: false,
      });
      expect(p.name).toBe('my_debug');
    });
  });

  // -------------------------------------------------------------------------
  // Callback tests
  // -------------------------------------------------------------------------

  describe('beforeRunCallback', () => {
    it('should initialize debug state for invocation', async () => {
      const result = await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined and not modify invocation', async () => {
      const result = await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('onUserMessageCallback', () => {
    it('should log user message content', async () => {
      // First initialize the invocation state
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const userMessage: Content = {
        role: 'user',
        parts: [{text: 'Hello, agent!'}],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: mockInvocationContext,
        userMessage,
      });

      expect(result).toBeUndefined();
    });

    it('should handle empty user message', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const userMessage: Content = {
        role: 'user',
        parts: [],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: mockInvocationContext,
        userMessage,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('onEventCallback', () => {
    it('should log event details', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const event: Event = createEvent({
        id: 'event-1',
        invocationId: 'test-invocation-id',
        author: 'test_agent',
        content: {
          role: 'model',
          parts: [{text: 'Hello, user!'}],
        },
      });

      const result = await plugin.onEventCallback({
        invocationContext: mockInvocationContext,
        event,
      });

      expect(result).toBeUndefined();
    });

    it('should log event with function calls', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const event: Event = createEvent({
        id: 'event-2',
        invocationId: 'test-invocation-id',
        author: 'test_agent',
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'fc-1',
                name: 'test_tool',
                args: {param: 'value'},
              },
            },
          ],
        },
      });

      const result = await plugin.onEventCallback({
        invocationContext: mockInvocationContext,
        event,
      });

      expect(result).toBeUndefined();
    });

    it('should log event with actions', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const event: Event = createEvent({
        id: 'event-3',
        invocationId: 'test-invocation-id',
        author: 'test_agent',
        content: {
          role: 'model',
          parts: [{text: 'Transfer action'}],
        },
      });
      event.actions.stateDelta = {key: 'value'};
      event.actions.transferToAgent = 'other-agent';

      const result = await plugin.onEventCallback({
        invocationContext: mockInvocationContext,
        event,
      });

      expect(result).toBeUndefined();
    });

    it('should log event with usage metadata', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const event: Event = createEvent({
        id: 'event-4',
        invocationId: 'test-invocation-id',
        author: 'test_agent',
        content: {
          role: 'model',
          parts: [{text: 'Response'}],
        },
      });
      event.usageMetadata = {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        totalTokenCount: 150,
      };

      const result = await plugin.onEventCallback({
        invocationContext: mockInvocationContext,
        event,
      });

      expect(result).toBeUndefined();
    });

    it('should log event with long running tool IDs', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const event: Event = createEvent({
        id: 'event-5',
        invocationId: 'test-invocation-id',
        author: 'test_agent',
        content: {
          role: 'model',
          parts: [{text: 'Long running tool'}],
        },
        longRunningToolIds: ['tool-1', 'tool-2'],
      });

      const result = await plugin.onEventCallback({
        invocationContext: mockInvocationContext,
        event,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('beforeAgentCallback', () => {
    it('should log agent start', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const result = await plugin.beforeAgentCallback({
        agent: mockAgent,
        callbackContext: mockCallbackContext,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('afterAgentCallback', () => {
    it('should log agent end', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const result = await plugin.afterAgentCallback({
        agent: mockAgent,
        callbackContext: mockCallbackContext,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('beforeModelCallback', () => {
    it('should log LLM request', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const llmRequest: LlmRequest = {
        model: 'gemini-2.0-flash',
        contents: [{role: 'user', parts: [{text: 'Hello'}]}],
        config: {
          systemInstruction: 'You are a helpful assistant.',
          temperature: 0.7,
        },
        toolsDict: {},
        liveConnectConfig: {},
      };

      const result = await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      expect(result).toBeUndefined();
    });

    it('should handle LLM request with tools', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const mockTool = {
        name: 'test_tool',
      } as BaseTool;

      const llmRequest: LlmRequest = {
        model: 'gemini-2.0-flash',
        contents: [{role: 'user', parts: [{text: 'Hello'}]}],
        toolsDict: {test_tool: mockTool},
        liveConnectConfig: {},
      };

      const result = await plugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      expect(result).toBeUndefined();
    });

    it('should handle system instruction based on setting', async () => {
      // Plugin with includeSystemInstruction = false
      const noSysPlugin = new DebugLoggingPlugin({
        includeSystemInstruction: false,
      });

      await noSysPlugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const llmRequest: LlmRequest = {
        model: 'gemini-2.0-flash',
        contents: [{role: 'user', parts: [{text: 'Hello'}]}],
        config: {
          systemInstruction:
              'You are a helpful assistant with a very long instruction.',
        },
        toolsDict: {},
        liveConnectConfig: {},
      };

      const result = await noSysPlugin.beforeModelCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('afterModelCallback', () => {
    it('should log LLM response', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const llmResponse: LlmResponse = {
        content: {
          role: 'model',
          parts: [{text: 'Hello, user!'}],
        },
        partial: false,
        turnComplete: true,
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const result = await plugin.afterModelCallback({
        callbackContext: mockCallbackContext,
        llmResponse,
      });

      expect(result).toBeUndefined();
    });

    it('should log LLM response with error', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const llmResponse: LlmResponse = {
        content: undefined,
        errorCode: '500',
        errorMessage: 'Internal server error',
      };

      const result = await plugin.afterModelCallback({
        callbackContext: mockCallbackContext,
        llmResponse,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('onModelErrorCallback', () => {
    it('should log LLM error', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const llmRequest: LlmRequest = {
        model: 'gemini-2.0-flash',
        contents: [{role: 'user', parts: [{text: 'Hello'}]}],
        toolsDict: {},
        liveConnectConfig: {},
      };

      const error = new Error('Model error');

      const result = await plugin.onModelErrorCallback({
        callbackContext: mockCallbackContext,
        llmRequest,
        error,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('beforeToolCallback', () => {
    it('should log tool call', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const mockTool = {
        name: 'test_tool',
      } as BaseTool;

      const mockToolContext = {
        invocationContext: mockInvocationContext,
        agentName: 'test_agent',
        functionCallId: 'fc-1',
      } as ToolContext;

      const result = await plugin.beforeToolCallback({
        tool: mockTool,
        toolArgs: {param: 'value'},
        toolContext: mockToolContext,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('afterToolCallback', () => {
    it('should log tool result', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const mockTool = {
        name: 'test_tool',
      } as BaseTool;

      const mockToolContext = {
        invocationContext: mockInvocationContext,
        agentName: 'test_agent',
        functionCallId: 'fc-1',
      } as ToolContext;

      const result = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {param: 'value'},
        toolContext: mockToolContext,
        result: {output: 'success'},
      });

      expect(result).toBeUndefined();
    });
  });

  describe('onToolErrorCallback', () => {
    it('should log tool error', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const mockTool = {
        name: 'test_tool',
      } as BaseTool;

      const mockToolContext = {
        invocationContext: mockInvocationContext,
        agentName: 'test_agent',
        functionCallId: 'fc-1',
      } as ToolContext;

      const error = new Error('Tool execution failed');

      const result = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {param: 'value'},
        toolContext: mockToolContext,
        error,
      });

      expect(result).toBeUndefined();
    });
  });

  describe('afterRunCallback', () => {
    it('should write debug data to YAML file', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      // Add some user message
      await plugin.onUserMessageCallback({
        invocationContext: mockInvocationContext,
        userMessage: {role: 'user', parts: [{text: 'Hello'}]},
      });

      // Complete the run
      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      // Verify fs.appendFileSync was called
      expect(fs.appendFileSync).toHaveBeenCalled();
      const callArgs = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                           .calls[0];
      expect(callArgs[0]).toBe('adk_debug.yaml');
      expect(callArgs[1]).toContain('---\n');
    });

    it('should include session state when enabled', async () => {
      const pluginWithState = new DebugLoggingPlugin({
        includeSessionState: true,
      });

      await pluginWithState.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      await pluginWithState.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const callArgs = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                           .calls[0];
      const yamlContent = callArgs[1] as string;

      // Parse the YAML content (remove the leading ---)
      const parsed = yaml.load(yamlContent.replace('---\n', '')) as Record<
          string, unknown>;

      // Find session_state_snapshot entry
      const entries = parsed['entries'] as Array<Record<string, unknown>>;
      const stateEntry =
          entries.find((e) => e['entryType'] === 'session_state_snapshot');
      expect(stateEntry).toBeDefined();
    });

    it('should not include session state when disabled', async () => {
      const pluginNoState = new DebugLoggingPlugin({
        includeSessionState: false,
      });

      await pluginNoState.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      await pluginNoState.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const callArgs = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                           .calls[0];
      const yamlContent = callArgs[1] as string;

      // Parse the YAML content
      const parsed = yaml.load(yamlContent.replace('---\n', '')) as Record<
          string, unknown>;

      // Should not have session_state_snapshot entry
      const entries = parsed['entries'] as Array<Record<string, unknown>>;
      const stateEntry =
          entries.find((e) => e['entryType'] === 'session_state_snapshot');
      expect(stateEntry).toBeUndefined();
    });

    it('should use custom output path', async () => {
      const customPlugin = new DebugLoggingPlugin({
        outputPath: './custom/debug_output.yaml',
      });

      await customPlugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      await customPlugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const callArgs = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                           .calls[0];
      expect(callArgs[0]).toBe('./custom/debug_output.yaml');
    });

    it('should cleanup invocation state after writing', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      // Calling again should warn about missing state
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      // State was cleaned up, so appendFileSync shouldn't be called again
      expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Serialization tests
  // -------------------------------------------------------------------------

  describe('serialization', () => {
    it('should serialize content with text parts', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const content: Content = {
        role: 'user',
        parts: [{text: 'Hello, world!'}],
      };

      await plugin.onUserMessageCallback({
        invocationContext: mockInvocationContext,
        userMessage: content,
      });

      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const yamlContent = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                              .calls[0][1] as string;
      expect(yamlContent).toContain('Hello, world!');
    });

    it('should serialize content with function calls', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const event: Event = createEvent({
        id: 'event-fc',
        invocationId: 'test-invocation-id',
        author: 'test_agent',
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'fc-123',
                name: 'my_tool',
                args: {key: 'value', nested: {inner: 'data'}},
              },
            },
          ],
        },
      });

      await plugin.onEventCallback({
        invocationContext: mockInvocationContext,
        event,
      });

      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const yamlContent = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                              .calls[0][1] as string;
      expect(yamlContent).toContain('functionCall');
      expect(yamlContent).toContain('my_tool');
    });

    it('should serialize content with function responses', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const event: Event = createEvent({
        id: 'event-fr',
        invocationId: 'test-invocation-id',
        author: 'test_agent',
        content: {
          role: 'function',
          parts: [
            {
              functionResponse: {
                id: 'fr-123',
                name: 'my_tool',
                response: {result: 'success', data: [1, 2, 3]},
              },
            },
          ],
        },
      });

      await plugin.onEventCallback({
        invocationContext: mockInvocationContext,
        event,
      });

      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const yamlContent = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                              .calls[0][1] as string;
      expect(yamlContent).toContain('functionResponse');
    });

    it('should safely serialize binary data', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const event: Event = createEvent({
        id: 'event-bin',
        invocationId: 'test-invocation-id',
        author: 'test_agent',
        content: {
          role: 'model',
          parts: [
            {
              inlineData: {
                mimeType: 'image/png',
                data: 'base64encodeddata',
              },
            },
          ],
        },
      });

      await plugin.onEventCallback({
        invocationContext: mockInvocationContext,
        event,
      });

      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const yamlContent = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                              .calls[0][1] as string;
      expect(yamlContent).toContain('inlineData');
      expect(yamlContent).toContain('image/png');
    });

    it('should serialize code execution results', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const event: Event = createEvent({
        id: 'event-code',
        invocationId: 'test-invocation-id',
        author: 'test_agent',
        content: {
          role: 'model',
          parts: [
            {
              codeExecutionResult: {
                outcome: 'OUTCOME_OK',
                output: 'Hello from code!',
              },
            },
          ],
        },
      });

      await plugin.onEventCallback({
        invocationContext: mockInvocationContext,
        event,
      });

      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const yamlContent = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                              .calls[0][1] as string;
      expect(yamlContent).toContain('codeExecutionResult');
      expect(yamlContent).toContain('OUTCOME_OK');
    });

    it('should serialize executable code', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const event: Event = createEvent({
        id: 'event-exec',
        invocationId: 'test-invocation-id',
        author: 'test_agent',
        content: {
          role: 'model',
          parts: [
            {
              executableCode: {
                language: 'PYTHON',
                code: 'print("Hello")',
              },
            },
          ],
        },
      });

      await plugin.onEventCallback({
        invocationContext: mockInvocationContext,
        event,
      });

      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const yamlContent = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                              .calls[0][1] as string;
      expect(yamlContent).toContain('executableCode');
      expect(yamlContent).toContain('PYTHON');
    });
  });

  // -------------------------------------------------------------------------
  // Edge case tests
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle missing invocation state gracefully', async () => {
      // Don't call beforeRunCallback, so there's no state

      const userMessage: Content = {
        role: 'user',
        parts: [{text: 'Hello'}],
      };

      // Should not throw
      const result = await plugin.onUserMessageCallback({
        invocationContext: mockInvocationContext,
        userMessage,
      });

      expect(result).toBeUndefined();
    });

    it('should handle undefined content gracefully', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const event: Event = createEvent({
        id: 'event-empty',
        invocationId: 'test-invocation-id',
        author: 'test_agent',
        content: undefined,
      });

      const result = await plugin.onEventCallback({
        invocationContext: mockInvocationContext,
        event,
      });

      expect(result).toBeUndefined();
    });

    it('should handle multiple invocations simultaneously', async () => {
      const invocationContext2 = {
        ...mockInvocationContext,
        invocationId: 'test-invocation-id-2',
      } as InvocationContext;

      // Start both invocations
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });
      await plugin.beforeRunCallback({invocationContext: invocationContext2});

      // Add messages to both
      await plugin.onUserMessageCallback({
        invocationContext: mockInvocationContext,
        userMessage: {role: 'user', parts: [{text: 'Message 1'}]},
      });
      await plugin.onUserMessageCallback({
        invocationContext: invocationContext2,
        userMessage: {role: 'user', parts: [{text: 'Message 2'}]},
      });

      // Complete first invocation
      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
      const firstYaml = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                            .calls[0][1] as string;
      expect(firstYaml).toContain('test-invocation-id');

      // Complete second invocation
      await plugin.afterRunCallback({invocationContext: invocationContext2});

      expect(fs.appendFileSync).toHaveBeenCalledTimes(2);
      const secondYaml = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                             .calls[1][1] as string;
      expect(secondYaml).toContain('test-invocation-id-2');
    });

    it('should serialize nested objects and arrays', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const mockTool = {
        name: 'nested_tool',
      } as BaseTool;

      const mockToolContext = {
        invocationContext: mockInvocationContext,
        agentName: 'test_agent',
        functionCallId: 'fc-nested',
      } as ToolContext;

      const nestedArgs = {
        level1: {
          level2: {
            level3: ['a', 'b', 'c'],
            value: 42,
          },
          array: [1, 2, {nested: true}],
        },
        nullValue: null,
        undefinedValue: undefined,
        booleanValue: true,
      };

      await plugin.beforeToolCallback({
        tool: mockTool,
        toolArgs: nestedArgs,
        toolContext: mockToolContext,
      });

      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const yamlContent = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                              .calls[0][1] as string;
      expect(yamlContent).toContain('level1');
      expect(yamlContent).toContain('level2');
      expect(yamlContent).toContain('level3');
    });

    it('should handle Date objects in serialization', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      const mockTool = {
        name: 'date_tool',
      } as BaseTool;

      const mockToolContext = {
        invocationContext: mockInvocationContext,
        agentName: 'test_agent',
        functionCallId: 'fc-date',
      } as ToolContext;

      const argsWithDate = {
        timestamp: new Date('2025-01-18T12:00:00Z'),
      };

      await plugin.beforeToolCallback({
        tool: mockTool,
        toolArgs: argsWithDate,
        toolContext: mockToolContext,
      });

      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const yamlContent = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                              .calls[0][1] as string;
      expect(yamlContent).toContain('2025-01-18');
    });
  });

  // -------------------------------------------------------------------------
  // Output format tests
  // -------------------------------------------------------------------------

  describe('output format', () => {
    it('should produce valid YAML output', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      await plugin.onUserMessageCallback({
        invocationContext: mockInvocationContext,
        userMessage: {role: 'user', parts: [{text: 'Test message'}]},
      });

      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const yamlContent = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                              .calls[0][1] as string;

      // Should start with document separator
      expect(yamlContent.startsWith('---\n')).toBe(true);

      // Should be valid YAML
      const parsed =
          yaml.load(yamlContent.replace('---\n', '')) as Record<string, unknown>;
      expect(parsed).toBeDefined();
      expect(parsed['invocationId']).toBe('test-invocation-id');
      expect(parsed['sessionId']).toBe('test-session-id');
      expect(parsed['appName']).toBe('test-app');
    });

    it('should include all required fields in output', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const yamlContent = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                              .calls[0][1] as string;

      const parsed =
          yaml.load(yamlContent.replace('---\n', '')) as Record<string, unknown>;

      // Check required fields
      expect(parsed).toHaveProperty('invocationId');
      expect(parsed).toHaveProperty('sessionId');
      expect(parsed).toHaveProperty('appName');
      expect(parsed).toHaveProperty('userId');
      expect(parsed).toHaveProperty('startTime');
      expect(parsed).toHaveProperty('entries');
    });

    it('should produce correctly structured entries', async () => {
      await plugin.beforeRunCallback({
        invocationContext: mockInvocationContext,
      });

      await plugin.afterRunCallback({
        invocationContext: mockInvocationContext,
      });

      expect(fs.appendFileSync).toHaveBeenCalled();
      const yamlContent = (fs.appendFileSync as ReturnType<typeof vi.fn>).mock
                              .calls[0][1] as string;

      const parsed =
          yaml.load(yamlContent.replace('---\n', '')) as Record<string, unknown>;
      const entries = parsed['entries'] as Array<Record<string, unknown>>;

      expect(entries.length).toBeGreaterThan(0);

      // Each entry should have required fields
      for (const entry of entries) {
        expect(entry).toHaveProperty('timestamp');
        expect(entry).toHaveProperty('entryType');
        expect(entry).toHaveProperty('invocationId');
      }

      // First entry should be invocation_start
      expect(entries[0]['entryType']).toBe('invocation_start');

      // Last entry should be invocation_end
      expect(entries[entries.length - 1]['entryType']).toBe('invocation_end');
    });
  });
});
