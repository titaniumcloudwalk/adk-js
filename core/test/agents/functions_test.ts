/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {BasePlugin, BaseTool, Event, functionsExportedForTestingOnly, FunctionTool, InvocationContext, LlmAgent, PluginManager, Session, SingleAfterToolCallback, SingleBeforeToolCallback, ToolContext,} from '@google/adk';
import {FunctionCall} from '@google/genai';
import {z} from 'zod';

// Get the test target function
const {
  handleFunctionCallList,
  generateAuthEvent,
  generateRequestConfirmationEvent
} = functionsExportedForTestingOnly;

// Tool for testing
const testTool = new FunctionTool({
  name: 'testTool',
  description: 'test tool',
  parameters: z.object({}),
  execute: async () => {
    return {result: 'tool executed'};
  },
});

const errorTool = new FunctionTool({
  name: 'errorTool',
  description: 'error tool',
  parameters: z.object({}),
  execute: async () => {
    throw new Error('tool error message content');
  },
});

// Plugin for testing
class TestPlugin extends BasePlugin {
  beforeToolCallbackResponse?: Record<string, unknown>;
  afterToolCallbackResponse?: Record<string, unknown>;
  onToolErrorCallbackResponse?: Record<string, unknown>;

  override async beforeToolCallback(
      ...args: Parameters<BasePlugin['beforeToolCallback']>):
      Promise<Record<string, unknown>|undefined> {
    if (this.beforeToolCallbackResponse) {
      return this.beforeToolCallbackResponse;
    }
    return undefined;
  }

  override async afterToolCallback(
      ...args: Parameters<BasePlugin['afterToolCallback']>):
      Promise<Record<string, unknown>|undefined> {
    if (this.afterToolCallbackResponse) {
      return this.afterToolCallbackResponse;
    }
    return undefined;
  }

  override async onToolErrorCallback(
      ...args: Parameters<BasePlugin['onToolErrorCallback']>):
      Promise<Record<string, unknown>|undefined> {
    if (this.onToolErrorCallbackResponse) {
      return this.onToolErrorCallbackResponse;
    }
    return undefined;
  }
}

function randomIdForTestingOnly(): string {
  return (Math.random() * 100).toString();
}

describe('handleFunctionCallList', () => {
  let invocationContext: InvocationContext;
  let pluginManager: PluginManager;
  let functionCall: FunctionCall;
  let toolsDict: Record<string, BaseTool>;

  beforeEach(() => {
    pluginManager = new PluginManager();
    const agent = new LlmAgent({name: 'test_agent', model: 'test_model'});
    invocationContext = new InvocationContext({
      invocationId: 'inv_123',
      session: {} as Session,
      agent,
      pluginManager,
    });
    functionCall = {
      id: randomIdForTestingOnly(),
      name: 'testTool',
      args: {},
    };
    toolsDict = {'testTool': testTool};
  });

  it('should execute tool with no callbacks or plugins', async () => {
    const event = await handleFunctionCallList({
      invocationContext,
      functionCalls: [functionCall],
      toolsDict,
      beforeToolCallbacks: [],
      afterToolCallbacks: [],
    });
    expect(event).not.toBeNull();
    let definedEvent = event as Event;
    expect((definedEvent.content!.parts![0]).functionResponse!.response)
        .toEqual({
          result: 'tool executed',
        });
  });

  it('should execute beforeToolCallback and return its result', async () => {
    const beforeToolCallback: SingleBeforeToolCallback = async () => {
      return {result: 'beforeToolCallback executed'};
    };
    const event = await handleFunctionCallList({
      invocationContext,
      functionCalls: [functionCall],
      toolsDict,
      beforeToolCallbacks: [beforeToolCallback],
      afterToolCallbacks: [],
    });
    expect(event).not.toBeNull();
    let definedEvent = event as Event;
    expect((definedEvent.content!.parts![0]).functionResponse!.response)
        .toEqual({
          result: 'beforeToolCallback executed',
        });
  });

  it('should execute second beforeToolCallback if first returns undefined',
     async () => {
       const beforeToolCallback1: SingleBeforeToolCallback = async () => {
         return undefined;
       };
       const beforeToolCallback2: SingleBeforeToolCallback = async () => {
         return {result: 'beforeToolCallback2 executed'};
       };
       const event = await handleFunctionCallList({
         invocationContext,
         functionCalls: [functionCall],
         toolsDict,
         beforeToolCallbacks: [beforeToolCallback1, beforeToolCallback2],
         afterToolCallbacks: [],
       });
       expect(event).not.toBeNull();
       let definedEvent = event as Event;
       expect((definedEvent.content!.parts![0]).functionResponse!.response)
           .toEqual({
             result: 'beforeToolCallback2 executed',
           });
     });

  it('should execute afterToolCallback and return its result', async () => {
    const afterToolCallback: SingleAfterToolCallback = async () => {
      return {result: 'afterToolCallback executed'};
    };
    const event = await handleFunctionCallList({
      invocationContext,
      functionCalls: [functionCall],
      toolsDict,
      beforeToolCallbacks: [],
      afterToolCallbacks: [afterToolCallback],
    });
    expect(event).not.toBeNull();
    let definedEvent = event as Event;
    expect((definedEvent.content!.parts![0]).functionResponse!.response)
        .toEqual({
          result: 'afterToolCallback executed',
        });
  });

  it('should execute second afterToolCallback if first returns undefined',
     async () => {
       const afterToolCallback1: SingleAfterToolCallback = async () => {
         return undefined;
       };
       const afterToolCallback2: SingleAfterToolCallback = async () => {
         return {result: 'afterToolCallback2 executed'};
       };
       const event = await handleFunctionCallList({
         invocationContext,
         functionCalls: [functionCall],
         toolsDict,
         beforeToolCallbacks: [],
         afterToolCallbacks: [afterToolCallback1, afterToolCallback2],
       });
       expect(event).not.toBeNull();
       let definedEvent = event as Event;
       expect((definedEvent.content!.parts![0]).functionResponse!.response)
           .toEqual({
             result: 'afterToolCallback2 executed',
           });
     });

  it('should execute plugin beforeToolCallback and return its result',
     async () => {
       const plugin = new TestPlugin('testPlugin');
       plugin.beforeToolCallbackResponse = {
         result: 'plugin beforeToolCallback executed'
       };
       pluginManager.registerPlugin(plugin);
       const event = await handleFunctionCallList({
         invocationContext,
         functionCalls: [functionCall],
         toolsDict,
         beforeToolCallbacks: [],
         afterToolCallbacks: [],
       });
       expect(event).not.toBeNull();
       let definedEvent = event as Event;
       expect((definedEvent.content!.parts![0]).functionResponse!.response)
           .toEqual({
             result: 'plugin beforeToolCallback executed',
           });
     });

  it('should execute plugin afterToolCallback and return its result',
     async () => {
       const plugin = new TestPlugin('testPlugin');
       plugin.afterToolCallbackResponse = {
         result: 'plugin afterToolCallback executed'
       };
       pluginManager.registerPlugin(plugin);
       const event = await handleFunctionCallList({
         invocationContext,
         functionCalls: [functionCall],
         toolsDict,
         beforeToolCallbacks: [],
         afterToolCallbacks: [],
       });
       expect(event).not.toBeNull();
       let definedEvent = event as Event;
       expect((definedEvent.content!.parts![0]).functionResponse!.response)
           .toEqual({
             result: 'plugin afterToolCallback executed',
           });
     });

  it('should call plugin onToolErrorCallback when tool throws', async () => {
    const plugin = new TestPlugin('testPlugin');
    plugin.onToolErrorCallbackResponse = {
      result: 'onToolErrorCallback executed',
    };
    pluginManager.registerPlugin(plugin);
    const errorFunctionCall: FunctionCall = {
      id: randomIdForTestingOnly(),
      name: 'errorTool',
      args: {},
    };
    const event = await handleFunctionCallList({
      invocationContext,
      functionCalls: [errorFunctionCall],
      toolsDict: {'errorTool': errorTool},
      beforeToolCallbacks: [],
      afterToolCallbacks: [],
    });
    expect(event).not.toBeNull();
    const definedEvent = event as Event;
    expect((definedEvent.content!.parts![0]).functionResponse!.response)
        .toEqual({
          result: 'onToolErrorCallback executed',
        });
  });

  it('should return error message when error is thrown during tool execution, when no plugin onToolErrorCallback is provided',
     async () => {
       const errorFunctionCall: FunctionCall = {
         id: randomIdForTestingOnly(),
         name: 'errorTool',
         args: {},
       };

       const event = await handleFunctionCallList({
         invocationContext,
         functionCalls: [errorFunctionCall],
         toolsDict: {'errorTool': errorTool},
         beforeToolCallbacks: [],
         afterToolCallbacks: [],
       });

       expect(event!.content!.parts![0].functionResponse!.response).toEqual({
         error: 'Error in tool \'errorTool\': tool error message content',
       });
     });

  describe('parallel execution', () => {
    it('should execute multiple tools in parallel with improved performance',
       async () => {
         // Create tools with artificial delays to test parallelization
         const delayTool1 = new FunctionTool({
           name: 'delayTool1',
           description: 'tool with 100ms delay',
           parameters: z.object({}),
           execute: async () => {
             await new Promise(resolve => setTimeout(resolve, 100));
             return {result: 'tool1 executed'};
           },
         });

         const delayTool2 = new FunctionTool({
           name: 'delayTool2',
           description: 'tool with 100ms delay',
           parameters: z.object({}),
           execute: async () => {
             await new Promise(resolve => setTimeout(resolve, 100));
             return {result: 'tool2 executed'};
           },
         });

         const delayTool3 = new FunctionTool({
           name: 'delayTool3',
           description: 'tool with 100ms delay',
           parameters: z.object({}),
           execute: async () => {
             await new Promise(resolve => setTimeout(resolve, 100));
             return {result: 'tool3 executed'};
           },
         });

         const functionCalls: FunctionCall[] = [
           {id: randomIdForTestingOnly(), name: 'delayTool1', args: {}},
           {id: randomIdForTestingOnly(), name: 'delayTool2', args: {}},
           {id: randomIdForTestingOnly(), name: 'delayTool3', args: {}},
         ];

         const toolsDict = {
           'delayTool1': delayTool1,
           'delayTool2': delayTool2,
           'delayTool3': delayTool3,
         };

         const startTime = Date.now();
         const event = await handleFunctionCallList({
           invocationContext,
           functionCalls,
           toolsDict,
           beforeToolCallbacks: [],
           afterToolCallbacks: [],
         });
         const duration = Date.now() - startTime;

         // Verify all tools executed
         expect(event).not.toBeNull();
         const parts = event!.content!.parts!;
         expect(parts.length).toBe(3);

         // Verify parallel execution: should take ~100ms (parallel) not ~300ms
         // (sequential) Allow some margin for execution overhead
         expect(duration).toBeLessThan(200);  // Much less than 300ms sequential
         expect(duration).toBeGreaterThanOrEqual(80);  // At least 100ms-ish
       });

    it('should isolate errors - one tool failure does not block other tools',
       async () => {
         const successTool1 = new FunctionTool({
           name: 'successTool1',
           description: 'successful tool',
           parameters: z.object({}),
           execute: async () => {
             await new Promise(resolve => setTimeout(resolve, 50));
             return {result: 'success1'};
           },
         });

         const failureTool = new FunctionTool({
           name: 'failureTool',
           description: 'failing tool',
           parameters: z.object({}),
           execute: async () => {
             await new Promise(resolve => setTimeout(resolve, 50));
             throw new Error('tool failed');
           },
         });

         const successTool2 = new FunctionTool({
           name: 'successTool2',
           description: 'successful tool',
           parameters: z.object({}),
           execute: async () => {
             await new Promise(resolve => setTimeout(resolve, 50));
             return {result: 'success2'};
           },
         });

         const functionCalls: FunctionCall[] = [
           {id: randomIdForTestingOnly(), name: 'successTool1', args: {}},
           {id: randomIdForTestingOnly(), name: 'failureTool', args: {}},
           {id: randomIdForTestingOnly(), name: 'successTool2', args: {}},
         ];

         const toolsDict = {
           'successTool1': successTool1,
           'failureTool': failureTool,
           'successTool2': successTool2,
         };

         const event = await handleFunctionCallList({
           invocationContext,
           functionCalls,
           toolsDict,
           beforeToolCallbacks: [],
           afterToolCallbacks: [],
         });

         expect(event).not.toBeNull();
         const parts = event!.content!.parts!;
         expect(parts.length).toBe(3);

         // Find responses by tool name
         const response1 = parts.find(
             p => p.functionResponse?.name === 'successTool1');
         const response2 = parts.find(
             p => p.functionResponse?.name === 'successTool2');
         const failResponse =
             parts.find(p => p.functionResponse?.name === 'failureTool');

         // Verify successful tools completed
         expect(response1?.functionResponse?.response).toEqual({
           result: 'success1'
         });
         expect(response2?.functionResponse?.response).toEqual({
           result: 'success2'
         });

         // Verify failed tool returned error
         expect(failResponse?.functionResponse?.response).toEqual({
           error: 'Error in tool \'failureTool\': tool failed',
         });
       });

    it('should handle state updates from concurrent tools correctly',
       async () => {
         // Create tools that modify state concurrently
         const stateTool1 = new FunctionTool({
           name: 'stateTool1',
           description: 'modifies state',
           parameters: z.object({}),
           execute: async (_args, context: ToolContext) => {
             await new Promise(resolve => setTimeout(resolve, 50));
             context.invocationContext.session.state.set('tool1', 'executed');
             return {result: 'state1 set'};
           },
         });

         const stateTool2 = new FunctionTool({
           name: 'stateTool2',
           description: 'modifies state',
           parameters: z.object({}),
           execute: async (_args, context: ToolContext) => {
             await new Promise(resolve => setTimeout(resolve, 50));
             context.invocationContext.session.state.set('tool2', 'executed');
             return {result: 'state2 set'};
           },
         });

         const functionCalls: FunctionCall[] = [
           {id: randomIdForTestingOnly(), name: 'stateTool1', args: {}},
           {id: randomIdForTestingOnly(), name: 'stateTool2', args: {}},
         ];

         const toolsDict = {
           'stateTool1': stateTool1,
           'stateTool2': stateTool2,
         };

         // Create a mock session with state
         const session = {
           id: 'test_session',
           state: {
             value: {},
             delta: {},
             set: function(key: string, value: unknown) {
               this.value[key] = value;
               this.delta[key] = value;
             },
             get: function(key: string) {
               return this.value[key];
             },
           },
         } as unknown as Session;

         invocationContext.session = session;

         const event = await handleFunctionCallList({
           invocationContext,
           functionCalls,
           toolsDict,
           beforeToolCallbacks: [],
           afterToolCallbacks: [],
         });

         expect(event).not.toBeNull();

         // Verify both state updates occurred
         expect(session.state.get('tool1')).toBe('executed');
         expect(session.state.get('tool2')).toBe('executed');
       });

    it('should merge multiple function response events correctly', async () => {
      const tool1 = new FunctionTool({
        name: 'tool1',
        description: 'first tool',
        parameters: z.object({}),
        execute: async () => {
          return {result: 'result1'};
        },
      });

      const tool2 = new FunctionTool({
        name: 'tool2',
        description: 'second tool',
        parameters: z.object({}),
        execute: async () => {
          return {result: 'result2'};
        },
      });

      const functionCalls: FunctionCall[] = [
        {id: 'call1', name: 'tool1', args: {}},
        {id: 'call2', name: 'tool2', args: {}},
      ];

      const toolsDict = {
        'tool1': tool1,
        'tool2': tool2,
      };

      const event = await handleFunctionCallList({
        invocationContext,
        functionCalls,
        toolsDict,
        beforeToolCallbacks: [],
        afterToolCallbacks: [],
      });

      expect(event).not.toBeNull();
      const parts = event!.content!.parts!;
      expect(parts.length).toBe(2);

      // Verify both responses are present with correct IDs
      const response1 = parts.find(p => p.functionResponse?.id === 'call1');
      const response2 = parts.find(p => p.functionResponse?.id === 'call2');

      expect(response1).toBeDefined();
      expect(response1?.functionResponse?.response).toEqual({result: 'result1'});

      expect(response2).toBeDefined();
      expect(response2?.functionResponse?.response).toEqual({result: 'result2'});
    });
  });
});

describe('generateAuthEvent', () => {
  let invocationContext: InvocationContext;
  let pluginManager: PluginManager;

  beforeEach(() => {
    pluginManager = new PluginManager();
    const agent = new LlmAgent({name: 'test_agent', model: 'test_model'});
    invocationContext = new InvocationContext({
      invocationId: 'inv_123',
      session: {} as Session,
      agent,
      pluginManager,
    });
  });

  it('should return undefined if no requestedAuthConfigs', () => {
    const functionResponseEvent = {actions: {}, content: {role: 'model'}} as
        unknown as Event;

    const event = generateAuthEvent(invocationContext, functionResponseEvent);
    expect(event).toBeUndefined();
  });

  it('should return undefined if requestedAuthConfigs is empty', () => {
    const functionResponseEvent = {
      actions: {requestedAuthConfigs: {}},
      content: {role: 'model'}
    } as unknown as Event;

    const event = generateAuthEvent(invocationContext, functionResponseEvent);
    expect(event).toBeUndefined();
  });

  it('should return auth event if requestedAuthConfigs is present', () => {
    const functionResponseEvent = {
      actions: {
        requestedAuthConfigs:
            {'call_1': 'auth_config_1', 'call_2': 'auth_config_2'}
      },
      content: {role: 'model'}
    } as unknown as Event;

    const event = generateAuthEvent(invocationContext, functionResponseEvent);
    expect(event).toBeDefined();
    expect(event!.invocationId).toBe('inv_123');
    expect(event!.author).toBe('test_agent');
    expect(event!.content!.parts!.length).toBe(2);

    const parts = event!.content!.parts!;
    const call1 = parts.find(
        p => p.functionCall?.args?.['function_call_id'] === 'call_1');
    expect(call1).toBeDefined();
    expect(call1!.functionCall!.name).toBe('adk_request_credential');
    expect(call1!.functionCall!.args!['auth_config']).toBe('auth_config_1');

    const call2 = parts.find(
        p => p.functionCall?.args?.['function_call_id'] === 'call_2');
    expect(call2).toBeDefined();
    expect(call2!.functionCall!.name).toBe('adk_request_credential');
    expect(call2!.functionCall!.args!['auth_config']).toBe('auth_config_2');
  });
});

describe('generateRequestConfirmationEvent', () => {
  let invocationContext: InvocationContext;
  let pluginManager: PluginManager;

  beforeEach(() => {
    pluginManager = new PluginManager();
    const agent = new LlmAgent({name: 'test_agent', model: 'test_model'});
    invocationContext = new InvocationContext({
      invocationId: 'inv_123',
      session: {} as Session,
      agent,
      pluginManager,
    });
  });

  it('should return undefined if no requestedToolConfirmations', () => {
    const functionCallEvent = {content: {parts: []}} as unknown as Event;
    const functionResponseEvent = {actions: {}, content: {role: 'model'}} as
        unknown as Event;

    const event = generateRequestConfirmationEvent(
        {invocationContext, functionCallEvent, functionResponseEvent});
    expect(event).toBeUndefined();
  });

  it('should return undefined if requestedToolConfirmations is empty', () => {
    const functionCallEvent = {content: {parts: []}} as unknown as Event;
    const functionResponseEvent = {
      actions: {requestedToolConfirmations: {}},
      content: {role: 'model'}
    } as unknown as Event;

    const event = generateRequestConfirmationEvent(
        {invocationContext, functionCallEvent, functionResponseEvent});
    expect(event).toBeUndefined();
  });

  it('should return confirmation event if requestedToolConfirmations is present',
     () => {
       const functionCallEvent = {
         content: {
           parts: [
             {
               functionCall: {
                 name: 'tool_1',
                 args: {arg: 'val1'},
                 id: 'call_1',
               }
             },
             {
               functionCall: {
                 name: 'tool_2',
                 args: {arg: 'val2'},
                 id: 'call_2',
               }
             }
           ]
         }
       } as unknown as Event;

       const functionResponseEvent = {
         actions: {
           requestedToolConfirmations: {
             'call_1': {message: 'confirm tool 1'},
             'call_2': {message: 'confirm tool 2'}
           }
         },
         content: {role: 'model'}
       } as unknown as Event;

       const event = generateRequestConfirmationEvent(
           {invocationContext, functionCallEvent, functionResponseEvent});

       expect(event).toBeDefined();
       expect(event!.invocationId).toBe('inv_123');
       expect(event!.author).toBe('test_agent');
       expect(event!.content!.parts!.length).toBe(2);

       const parts = event!.content!.parts!;
       const call1 = parts.find(
           p => (p.functionCall?.args?.['originalFunctionCall'] as FunctionCall)
                    ?.id === 'call_1');
       expect(call1).toBeDefined();
       expect(call1!.functionCall!.name).toBe('adk_request_confirmation');
       expect(call1!.functionCall!.args!['toolConfirmation']).toEqual({
         message: 'confirm tool 1'
       });

       const call2 = parts.find(
           p => (p.functionCall?.args?.['originalFunctionCall'] as FunctionCall)
                    ?.id === 'call_2');
       expect(call2).toBeDefined();
       expect(call2!.functionCall!.name).toBe('adk_request_confirmation');
       expect(call2!.functionCall!.args!['toolConfirmation']).toEqual({
         message: 'confirm tool 2'
       });
     });

  it('should skip confirmation if original function call is not found', () => {
    const functionCallEvent = {
      content: {
        parts: [{
          functionCall: {
            name: 'tool_1',
            args: {arg: 'val1'},
            id: 'call_1',
          }
        }]
      }
    } as unknown as Event;

    const functionResponseEvent = {
      actions: {
        requestedToolConfirmations: {
          'call_1': {message: 'confirm tool 1'},
          'call_missing': {message: 'confirm tool missing'}
        }
      },
      content: {role: 'model'}
    } as unknown as Event;

    const event = generateRequestConfirmationEvent(
        {invocationContext, functionCallEvent, functionResponseEvent});

    expect(event).toBeDefined();
    expect(event!.content!.parts!.length).toBe(1);
    const parts = event!.content!.parts!;
    const call1 = parts.find(
        p => (p.functionCall?.args?.['originalFunctionCall'] as FunctionCall)
                 ?.id === 'call_1');
    expect(call1).toBeDefined();
  });
});