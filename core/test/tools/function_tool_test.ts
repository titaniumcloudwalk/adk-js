/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FunctionTool, ToolContext, ToolConfirmation, createEventActions } from '@google/adk'
import { Type } from '@google/genai'
import { z } from 'zod'

describe('FunctionTool', () => {
  let emptyContext: ToolContext;
  beforeEach(() => {
    emptyContext = {} as ToolContext;
  });

  it('computes the correct declaration', async () => {
    const addTool = new FunctionTool({
      name: 'add',
      description: 'Adds two numbers.',
      parameters: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: async ({a, b}) => {
        return a + b;
      },
    });

    const declaration = addTool._getDeclaration();
    expect(declaration.name).toEqual('add');
    expect(declaration.description).toEqual('Adds two numbers.');
    expect(declaration.parameters).toEqual({
      type: Type.OBJECT,
      properties: {
        a: {type: Type.NUMBER},
        b: {type: Type.NUMBER},
      },
      required: ['a', 'b'],
    });
  });

  it('works with named functions', async () => {
    async function add({a, b}: {a: number, b: number}) {
      return a + b;
    }

    const addTool = new FunctionTool({
      description: 'Adds two numbers.',
      parameters: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: add,
    });

    const result =
        await addTool.runAsync({args: {a: 1, b: 2}, toolContext: emptyContext});
    expect(result).toEqual(3);
  });

  it('works with lambda functions', async () => {
    const addTool = new FunctionTool({
      name: 'add',
      description: 'Adds two numbers.',
      parameters: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: async ({a, b}) => {
        return a + b;
      },
    });
    const result =
        await addTool.runAsync({args: {a: 1, b: 2}, toolContext: emptyContext});
    expect(result).toEqual(3);
  });

  it('works with a static method from a class', async () => {
    class Calculator {
      static add({a, b}: {a: number, b: number}) {
        return a + b;
      }
    }

    const addTool = new FunctionTool({
      name: 'add',
      description: 'Adds two numbers.',
      parameters: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: Calculator.add,
    });

    const result =
        await addTool.runAsync({args: {a: 1, b: 2}, toolContext: emptyContext});
    expect(result).toEqual(3);
  });

  it('works with an stateful instance method from an object', async () => {
    class Counter {
      count = 0;
      incrementBy({a}: {a: number}) {
        this.count += a;
        return this.count;
      }
    }

    const counter = new Counter();
    const addTool = new FunctionTool({
      name: 'incrementBy',
      description: 'Increments a counter by the given number.',
      parameters: z.object({a: z.number()}),
      execute: counter.incrementBy.bind(counter),
    });

    const result =
        await addTool.runAsync({args: {a: 1}, toolContext: emptyContext});
    expect(result).toEqual(1);
    expect(counter.count).toEqual(1);

    const result2 =
        await addTool.runAsync({args: {a: 2}, toolContext: emptyContext});
    expect(result2).toEqual(3);
    expect(counter.count).toEqual(3);
  });

  it('works with default values', async () => {
    const addTool = new FunctionTool({
      name: 'add',
      description: 'Adds two numbers.',
      parameters: z.object({
        a: z.number(),
        b: z.number().default(2),
      }),
      execute: async ({a, b}) => {
        return a + b;
      },
    });
    const result =
        await addTool.runAsync({args: {a: 1}, toolContext: emptyContext});
    expect(result).toEqual(3);
  });

  it('works with optional values', async () => {
    const addTool = new FunctionTool({
      name: 'add',
      description: 'Adds two numbers.',
      parameters: z.object({
        a: z.number(),
        b: z.number().optional(),
      }),
      execute: async ({a, b}) => {
        return b ? a + b : a;
      },
    });
    const result =
        await addTool.runAsync({args: {a: 1}, toolContext: emptyContext});
    expect(result).toEqual(1);

    const result2 =
        await addTool.runAsync({args: {a: 1, b: 2}, toolContext: emptyContext});
    expect(result2).toEqual(3);
  });

  it('works with array values', async () => {
    const concatStringTool = new FunctionTool({
      name: 'concat_string',
      description: 'Concatenates an array of strings.',
      parameters: z.object({
        strings: z.array(z.string()),
      }),
      execute: async ({strings}) => {
        return strings.join(',');
      },
    });
    const result = await concatStringTool.runAsync(
        {args: {strings: ['a', 'b', 'c']}, toolContext: emptyContext});
    expect(result).toEqual('a,b,c');
  });

  it('infers types from zod schema without explicit annotations', async () => {
    const addTool = new FunctionTool({
      name: 'add',
      description: 'Adds two numbers.',
      parameters: z.object({
        a: z.number(),
        b: z.number(),
      }),
      execute: async ({a, b}) => {
        return a + b;
      },
    });

    const result = await addTool.runAsync({
      args: {a: 1, b: 2},
      toolContext: emptyContext,
    });
    expect(result).toEqual(3);
  });

  it('wraps errors from execute function', async () => {
    const tool = new FunctionTool({
      name: 'errorTool',
      description: 'Throws an error.',
      parameters: z.object({}),
      execute: async () => {
        throw new Error('Test error');
      },
    });
    try {
      await tool.runAsync({
        args: {},
        toolContext: emptyContext,
      });
    } catch (e) {
      expect((e as Error).message).toContain(
        "Error in tool 'errorTool': Test error",
      );
    }
  });

  describe('requireConfirmation', () => {
    function createMockInvocationContext() {
      return {
        session: {
          state: {},
        },
      } as any;
    }

    it('requests confirmation when requireConfirmation is true', async () => {
      const mockInvocationContext = createMockInvocationContext();
      const eventActions = createEventActions();
      const toolContext = new ToolContext({
        invocationContext: mockInvocationContext,
        eventActions,
        functionCallId: 'test-call-id',
      });

      const transferMoneyTool = new FunctionTool({
        name: 'transfer_money',
        description: 'Transfer money between accounts',
        parameters: z.object({
          amount: z.number(),
          to: z.string(),
        }),
        execute: async ({amount, to}) => {
          return `Transferred ${amount} to ${to}`;
        },
        requireConfirmation: true,
      });

      const result = await transferMoneyTool.runAsync({
        args: {amount: 100, to: 'Alice'},
        toolContext,
      });

      // Should return error requesting confirmation
      expect(result).toHaveProperty('error');
      expect((result as any).error).toContain('requires confirmation');

      // Should set skipSummarization to true
      expect(eventActions.skipSummarization).toBe(true);

      // Should have requested confirmation
      expect(eventActions.requestedToolConfirmations['test-call-id']).toBeDefined();
      expect(eventActions.requestedToolConfirmations['test-call-id'].confirmed).toBe(false);
    });

    it('executes tool when confirmation is approved', async () => {
      const mockInvocationContext = createMockInvocationContext();
      const eventActions = createEventActions();
      const toolContext = new ToolContext({
        invocationContext: mockInvocationContext,
        eventActions,
        functionCallId: 'test-call-id',
        toolConfirmation: new ToolConfirmation({
          hint: 'Approve transfer',
          confirmed: true,
        }),
      });

      const transferMoneyTool = new FunctionTool({
        name: 'transfer_money',
        description: 'Transfer money between accounts',
        parameters: z.object({
          amount: z.number(),
          to: z.string(),
        }),
        execute: async ({amount, to}) => {
          return `Transferred ${amount} to ${to}`;
        },
        requireConfirmation: true,
      });

      const result = await transferMoneyTool.runAsync({
        args: {amount: 100, to: 'Alice'},
        toolContext,
      });

      // Should execute successfully
      expect(result).toBe('Transferred 100 to Alice');
    });

    it('rejects tool execution when confirmation is denied', async () => {
      const mockInvocationContext = createMockInvocationContext();
      const eventActions = createEventActions();
      const toolContext = new ToolContext({
        invocationContext: mockInvocationContext,
        eventActions,
        functionCallId: 'test-call-id',
        toolConfirmation: new ToolConfirmation({
          hint: 'Approve transfer',
          confirmed: false,
        }),
      });

      const transferMoneyTool = new FunctionTool({
        name: 'transfer_money',
        description: 'Transfer money between accounts',
        parameters: z.object({
          amount: z.number(),
          to: z.string(),
        }),
        execute: async ({amount, to}) => {
          return `Transferred ${amount} to ${to}`;
        },
        requireConfirmation: true,
      });

      const result = await transferMoneyTool.runAsync({
        args: {amount: 100, to: 'Alice'},
        toolContext,
      });

      // Should return rejection error
      expect(result).toHaveProperty('error');
      expect((result as any).error).toBe('This tool call is rejected.');
    });

    it('works with callable requireConfirmation predicate', async () => {
      const mockInvocationContext = createMockInvocationContext();
      const eventActions = createEventActions();
      const toolContext = new ToolContext({
        invocationContext: mockInvocationContext,
        eventActions,
        functionCallId: 'test-call-id',
      });

      const transferMoneyTool = new FunctionTool({
        name: 'transfer_money',
        description: 'Transfer money between accounts',
        parameters: z.object({
          amount: z.number(),
          to: z.string(),
        }),
        execute: async ({amount, to}) => {
          return `Transferred ${amount} to ${to}`;
        },
        // Only require confirmation for amounts over 1000
        requireConfirmation: (args) => args.amount > 1000,
      });

      // Small amount - should not require confirmation
      const result1 = await transferMoneyTool.runAsync({
        args: {amount: 500, to: 'Alice'},
        toolContext,
      });
      expect(result1).toBe('Transferred 500 to Alice');

      // Reset context for next call
      const eventActions2 = createEventActions();
      const toolContext2 = new ToolContext({
        invocationContext: createMockInvocationContext(),
        eventActions: eventActions2,
        functionCallId: 'test-call-id-2',
      });

      // Large amount - should require confirmation
      const result2 = await transferMoneyTool.runAsync({
        args: {amount: 2000, to: 'Bob'},
        toolContext: toolContext2,
      });
      expect(result2).toHaveProperty('error');
      expect((result2 as any).error).toContain('requires confirmation');
    });

    it('works with async requireConfirmation predicate', async () => {
      const mockInvocationContext = createMockInvocationContext();
      const eventActions = createEventActions();
      const toolContext = new ToolContext({
        invocationContext: mockInvocationContext,
        eventActions,
        functionCallId: 'test-call-id',
      });

      const transferMoneyTool = new FunctionTool({
        name: 'transfer_money',
        description: 'Transfer money between accounts',
        parameters: z.object({
          amount: z.number(),
          to: z.string(),
        }),
        execute: async ({amount, to}) => {
          return `Transferred ${amount} to ${to}`;
        },
        // Async predicate that checks amount threshold
        requireConfirmation: async (args) => {
          await new Promise(resolve => setTimeout(resolve, 10)); // Simulate async operation
          return args.amount > 1000;
        },
      });

      // Large amount - should require confirmation
      const result = await transferMoneyTool.runAsync({
        args: {amount: 2000, to: 'Bob'},
        toolContext,
      });
      expect(result).toHaveProperty('error');
      expect((result as any).error).toContain('requires confirmation');
    });

    it('does not require confirmation when requireConfirmation is false or undefined', async () => {
      const mockInvocationContext = createMockInvocationContext();
      const eventActions = createEventActions();
      const toolContext = new ToolContext({
        invocationContext: mockInvocationContext,
        eventActions,
        functionCallId: 'test-call-id',
      });

      const transferMoneyTool = new FunctionTool({
        name: 'transfer_money',
        description: 'Transfer money between accounts',
        parameters: z.object({
          amount: z.number(),
          to: z.string(),
        }),
        execute: async ({amount, to}) => {
          return `Transferred ${amount} to ${to}`;
        },
        requireConfirmation: false,
      });

      const result = await transferMoneyTool.runAsync({
        args: {amount: 100, to: 'Alice'},
        toolContext,
      });

      // Should execute without confirmation
      expect(result).toBe('Transferred 100 to Alice');
    });

    it('callable predicate has access to toolContext', async () => {
      const mockInvocationContext = {
        session: {id: 'session-123'},
      } as any;
      const eventActions = createEventActions();
      const toolContext = new ToolContext({
        invocationContext: mockInvocationContext,
        eventActions,
        functionCallId: 'test-call-id',
      });

      let contextWasAvailable = false;

      const transferMoneyTool = new FunctionTool({
        name: 'transfer_money',
        description: 'Transfer money between accounts',
        parameters: z.object({
          amount: z.number(),
          to: z.string(),
        }),
        execute: async ({amount, to}) => {
          return `Transferred ${amount} to ${to}`;
        },
        requireConfirmation: (args, ctx) => {
          // Verify toolContext is available
          contextWasAvailable = ctx !== undefined && ctx.invocationContext !== undefined;
          return false;
        },
      });

      await transferMoneyTool.runAsync({
        args: {amount: 100, to: 'Alice'},
        toolContext,
      });

      expect(contextWasAvailable).toBe(true);
    });
  });
});
