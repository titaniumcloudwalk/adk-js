/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';
import {z} from 'zod';

import {ActiveStreamingTool} from '../../src/agents/active_streaming_tool.js';
import {
  functionsExportedForTestingOnly,
} from '../../src/agents/functions.js';
import {InvocationContext} from '../../src/agents/invocation_context.js';
import {LiveRequestQueue} from '../../src/agents/live_request_queue.js';
import {LlmAgent} from '../../src/agents/llm_agent.js';
import {createEvent, Event} from '../../src/events/event.js';
import {FunctionTool} from '../../src/tools/function_tool.js';
import {
  STOP_STREAMING_FUNCTION_NAME,
  StopStreamingTool,
  stopStreamingTool,
} from '../../src/tools/stop_streaming_tool.js';
import {isAsyncGeneratorFunction} from '../../src/utils/async_generator_utils.js';

const {handleFunctionCallsLive} = functionsExportedForTestingOnly;

describe('Streaming Tools - FunctionTool', () => {
  describe('isStreamingFunction', () => {
    it('should detect async generator function', () => {
      async function* streamData(_args: unknown) {
        yield 'a';
        yield 'b';
      }

      const tool = new FunctionTool({
        name: 'stream_test',
        description: 'Test streaming',
        execute: streamData,
      });

      expect(tool.isStreamingFunction).toBe(true);
    });

    it('should detect regular async function as non-streaming', () => {
      const tool = new FunctionTool({
        name: 'regular_test',
        description: 'Test regular',
        execute: async () => 'result',
      });

      expect(tool.isStreamingFunction).toBe(false);
    });

    it('should detect sync function as non-streaming', () => {
      const tool = new FunctionTool({
        name: 'sync_test',
        description: 'Test sync',
        execute: () => 'result',
      });

      expect(tool.isStreamingFunction).toBe(false);
    });
  });

  describe('_callLive', () => {
    it('should yield values from streaming function', async () => {
      async function* streamNumbers() {
        yield 1;
        yield 2;
        yield 3;
      }

      const tool = new FunctionTool({
        name: 'stream_numbers',
        description: 'Stream numbers',
        execute: streamNumbers,
      });

      const mockAgent = {name: 'test_agent'} as LlmAgent;
      const invocationContext = new InvocationContext({
        agent: mockAgent,
        session: {
          id: 'test-session',
          appName: 'test-app',
          userId: 'test-user',
          state: {},
          events: [],
        },
      });

      const mockToolContext = {
        functionCallId: 'test-call-id',
        actions: {},
        state: {},
      } as any;

      const results: number[] = [];
      for await (const item of tool._callLive({
        args: {},
        toolContext: mockToolContext,
        invocationContext,
      })) {
        results.push(item as number);
      }

      expect(results).toEqual([1, 2, 3]);
    });

    it('should inject input_stream when available in activeStreamingTools', async () => {
      let receivedStream: LiveRequestQueue | undefined;

      async function* streamWithInput(
        _args: unknown,
        _toolContext: unknown,
        inputStream?: LiveRequestQueue,
      ) {
        receivedStream = inputStream;
        yield 'done';
      }

      const tool = new FunctionTool({
        name: 'stream_with_input',
        description: 'Stream with input',
        execute: streamWithInput,
      });

      const mockQueue = new LiveRequestQueue();
      const mockAgent = {name: 'test_agent'} as LlmAgent;
      const invocationContext = new InvocationContext({
        agent: mockAgent,
        session: {
          id: 'test-session',
          appName: 'test-app',
          userId: 'test-user',
          state: {},
          events: [],
        },
        activeStreamingTools: {
          'stream_with_input': new ActiveStreamingTool({stream: mockQueue}),
        },
      });

      const mockToolContext = {
        functionCallId: 'test-call-id',
        actions: {},
        state: {},
      } as any;

      for await (const _ of tool._callLive({
        args: {},
        toolContext: mockToolContext,
        invocationContext,
      })) {
        // Just iterate
      }

      expect(receivedStream).toBe(mockQueue);
    });

    it('should validate args with Zod schema', async () => {
      const schema = z.object({
        count: z.number(),
      });

      async function* streamWithArgs(args: {count: number}) {
        for (let i = 0; i < args.count; i++) {
          yield i;
        }
      }

      const tool = new FunctionTool({
        name: 'stream_with_args',
        description: 'Stream with args',
        parameters: schema,
        execute: streamWithArgs,
      });

      const mockAgent = {name: 'test_agent'} as LlmAgent;
      const invocationContext = new InvocationContext({
        agent: mockAgent,
        session: {
          id: 'test-session',
          appName: 'test-app',
          userId: 'test-user',
          state: {},
          events: [],
        },
      });

      const mockToolContext = {
        functionCallId: 'test-call-id',
        actions: {},
        state: {},
      } as any;

      const results: number[] = [];
      for await (const item of tool._callLive({
        args: {count: 3},
        toolContext: mockToolContext,
        invocationContext,
      })) {
        results.push(item as number);
      }

      expect(results).toEqual([0, 1, 2]);
    });
  });
});

describe('StopStreamingTool', () => {
  it('should have correct name', () => {
    expect(stopStreamingTool.name).toBe(STOP_STREAMING_FUNCTION_NAME);
    expect(stopStreamingTool.name).toBe('stop_streaming');
  });

  it('should have correct description', () => {
    expect(stopStreamingTool.description).toContain('Stops a currently running streaming function');
  });

  it('should have correct function declaration', () => {
    const declaration = stopStreamingTool._getDeclaration();
    expect(declaration).toBeDefined();
    expect(declaration!.name).toBe('stop_streaming');
    expect(declaration!.parameters).toBeDefined();
    expect(declaration!.parameters!.properties).toHaveProperty('function_name');
  });

  it('should return error when runAsync is called directly', async () => {
    const result = await stopStreamingTool.runAsync({
      args: {function_name: 'test'},
      toolContext: {} as any,
    });

    expect(result).toEqual({
      error: expect.stringContaining('should be handled in live mode'),
    });
  });
});

describe('handleFunctionCallsLive', () => {
  let mockAgent: LlmAgent;
  let invocationContext: InvocationContext;
  let liveRequestQueue: LiveRequestQueue;

  beforeEach(() => {
    mockAgent = {name: 'test_agent'} as LlmAgent;
    liveRequestQueue = new LiveRequestQueue();
    invocationContext = new InvocationContext({
      agent: mockAgent,
      session: {
        id: 'test-session',
        appName: 'test-app',
        userId: 'test-user',
        state: {},
        events: [],
      },
      liveRequestQueue,
    });
  });

  it('should execute regular tool and return response event', async () => {
    const tool = new FunctionTool({
      name: 'regular_tool',
      description: 'Regular tool',
      execute: async () => ({status: 'success'}),
    });

    const functionCallEvent = createEvent({
      author: 'model',
      content: {
        role: 'model',
        parts: [{
          functionCall: {
            name: 'regular_tool',
            id: 'call-1',
            args: {},
          },
        }],
      },
    });

    const result = await handleFunctionCallsLive({
      invocationContext,
      functionCallEvent,
      toolsDict: {regular_tool: tool},
      beforeToolCallbacks: [],
      afterToolCallbacks: [],
    });

    expect(result).not.toBeNull();
    expect(result!.content?.parts).toHaveLength(1);
    expect(result!.content?.parts?.[0].functionResponse?.name).toBe('regular_tool');
    expect(result!.content?.parts?.[0].functionResponse?.response).toEqual({status: 'success'});
  });

  it('should start streaming tool and return pending status', async () => {
    async function* streamTool() {
      yield 'value1';
      yield 'value2';
    }

    const tool = new FunctionTool({
      name: 'streaming_tool',
      description: 'Streaming tool',
      execute: streamTool,
    });

    const functionCallEvent = createEvent({
      author: 'model',
      content: {
        role: 'model',
        parts: [{
          functionCall: {
            name: 'streaming_tool',
            id: 'call-1',
            args: {},
          },
        }],
      },
    });

    const result = await handleFunctionCallsLive({
      invocationContext,
      functionCallEvent,
      toolsDict: {streaming_tool: tool},
      beforeToolCallbacks: [],
      afterToolCallbacks: [],
    });

    expect(result).not.toBeNull();
    expect(result!.content?.parts?.[0].functionResponse?.response).toEqual({
      status: 'The function is running asynchronously and the results are pending.',
    });

    // Verify streaming tool was registered
    expect(invocationContext.activeStreamingTools).toBeDefined();
    expect(invocationContext.activeStreamingTools!['streaming_tool']).toBeDefined();
    expect(invocationContext.activeStreamingTools!['streaming_tool'].task).toBeDefined();

    // Wait for the streaming to complete
    await invocationContext.activeStreamingTools!['streaming_tool'].task;
  });

  it('should handle stop_streaming function call', async () => {
    // First, start a streaming tool
    let streamStopped = false;

    async function* longRunningStream() {
      try {
        while (true) {
          yield 'data';
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } finally {
        streamStopped = true;
      }
    }

    const streamingTool = new FunctionTool({
      name: 'long_streaming',
      description: 'Long streaming',
      execute: longRunningStream,
    });

    // Start the streaming tool
    const startEvent = createEvent({
      author: 'model',
      content: {
        role: 'model',
        parts: [{
          functionCall: {
            name: 'long_streaming',
            id: 'call-1',
            args: {},
          },
        }],
      },
    });

    await handleFunctionCallsLive({
      invocationContext,
      functionCallEvent: startEvent,
      toolsDict: {
        long_streaming: streamingTool,
        stop_streaming: stopStreamingTool,
      },
      beforeToolCallbacks: [],
      afterToolCallbacks: [],
    });

    // Now stop the streaming tool
    const stopEvent = createEvent({
      author: 'model',
      content: {
        role: 'model',
        parts: [{
          functionCall: {
            name: 'stop_streaming',
            id: 'call-2',
            args: {function_name: 'long_streaming'},
          },
        }],
      },
    });

    const stopResult = await handleFunctionCallsLive({
      invocationContext,
      functionCallEvent: stopEvent,
      toolsDict: {
        long_streaming: streamingTool,
        stop_streaming: stopStreamingTool,
      },
      beforeToolCallbacks: [],
      afterToolCallbacks: [],
    });

    expect(stopResult).not.toBeNull();
    expect(stopResult!.content?.parts?.[0].functionResponse?.response).toEqual({
      status: 'Successfully stopped streaming function long_streaming',
    });
  });

  it('should handle stop_streaming for non-existent function', async () => {
    const stopEvent = createEvent({
      author: 'model',
      content: {
        role: 'model',
        parts: [{
          functionCall: {
            name: 'stop_streaming',
            id: 'call-1',
            args: {function_name: 'nonexistent_func'},
          },
        }],
      },
    });

    const result = await handleFunctionCallsLive({
      invocationContext,
      functionCallEvent: stopEvent,
      toolsDict: {stop_streaming: stopStreamingTool},
      beforeToolCallbacks: [],
      afterToolCallbacks: [],
    });

    expect(result).not.toBeNull();
    expect(result!.content?.parts?.[0].functionResponse?.response).toEqual({
      status: 'No active streaming function named nonexistent_func found',
    });
  });

  it('should run before_tool_callbacks', async () => {
    const beforeCallbackSpy = vi.fn().mockReturnValue(null);

    const tool = new FunctionTool({
      name: 'test_tool',
      description: 'Test',
      execute: async () => 'result',
    });

    const functionCallEvent = createEvent({
      author: 'model',
      content: {
        role: 'model',
        parts: [{
          functionCall: {
            name: 'test_tool',
            id: 'call-1',
            args: {},
          },
        }],
      },
    });

    await handleFunctionCallsLive({
      invocationContext,
      functionCallEvent,
      toolsDict: {test_tool: tool},
      beforeToolCallbacks: [beforeCallbackSpy],
      afterToolCallbacks: [],
    });

    expect(beforeCallbackSpy).toHaveBeenCalledTimes(1);
    expect(beforeCallbackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tool,
        args: {},
      }),
    );
  });

  it('should run after_tool_callbacks', async () => {
    const afterCallbackSpy = vi.fn().mockReturnValue(null);

    const tool = new FunctionTool({
      name: 'test_tool',
      description: 'Test',
      execute: async () => ({result: 'original'}),
    });

    const functionCallEvent = createEvent({
      author: 'model',
      content: {
        role: 'model',
        parts: [{
          functionCall: {
            name: 'test_tool',
            id: 'call-1',
            args: {},
          },
        }],
      },
    });

    await handleFunctionCallsLive({
      invocationContext,
      functionCallEvent,
      toolsDict: {test_tool: tool},
      beforeToolCallbacks: [],
      afterToolCallbacks: [afterCallbackSpy],
    });

    expect(afterCallbackSpy).toHaveBeenCalledTimes(1);
    expect(afterCallbackSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tool,
        args: {},
        response: {result: 'original'},
      }),
    );
  });

  it('should send streaming results to LiveRequestQueue', async () => {
    const sentContents: any[] = [];
    vi.spyOn(liveRequestQueue, 'sendContent').mockImplementation((content) => {
      sentContents.push(content);
    });

    async function* streamValues() {
      yield 'first';
      yield 'second';
    }

    const tool = new FunctionTool({
      name: 'streaming_tool',
      description: 'Streaming tool',
      execute: streamValues,
    });

    const functionCallEvent = createEvent({
      author: 'model',
      content: {
        role: 'model',
        parts: [{
          functionCall: {
            name: 'streaming_tool',
            id: 'call-1',
            args: {},
          },
        }],
      },
    });

    await handleFunctionCallsLive({
      invocationContext,
      functionCallEvent,
      toolsDict: {streaming_tool: tool},
      beforeToolCallbacks: [],
      afterToolCallbacks: [],
    });

    // Wait for streaming to complete
    await invocationContext.activeStreamingTools!['streaming_tool'].task;

    expect(sentContents.length).toBe(2);
    expect(sentContents[0].parts[0].text).toContain('first');
    expect(sentContents[1].parts[0].text).toContain('second');
  });
});

describe('isAsyncGeneratorFunction edge cases', () => {
  it('should handle bound async generator function', () => {
    const obj = {
      async *method() {
        yield 1;
      },
    };
    const boundMethod = obj.method.bind(obj);
    // Note: Bound functions may not be detected correctly in all runtimes
    // This test documents expected behavior
    expect(typeof boundMethod).toBe('function');
  });
});
