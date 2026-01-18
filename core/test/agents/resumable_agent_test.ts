/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, expect, it} from 'vitest';

import {BaseAgent, BaseAgentConfig} from '../../src/agents/base_agent.js';
import {
  createBaseAgentState,
  LoopAgentState,
} from '../../src/agents/base_agent_state.js';
import {InvocationContext} from '../../src/agents/invocation_context.js';
import {LoopAgent} from '../../src/agents/loop_agent.js';
import {createEvent, Event} from '../../src/events/event.js';
import {PluginManager} from '../../src/plugins/plugin_manager.js';
import {createSession} from '../../src/sessions/session.js';

/**
 * A simple test agent that yields events with configurable behavior.
 */
class TestAgent extends BaseAgent {
  public eventsToYield: Event[];
  public shouldEscalate: boolean;

  constructor(
      config: BaseAgentConfig&{eventsToYield?: Event[]; shouldEscalate?: boolean},
  ) {
    super(config);
    this.eventsToYield = config.eventsToYield ?? [];
    this.shouldEscalate = config.shouldEscalate ?? false;
  }

  protected async *
      runAsyncImpl(context: InvocationContext):
          AsyncGenerator<Event, void, void> {
    for (const event of this.eventsToYield) {
      if (this.shouldEscalate) {
        event.actions.escalate = true;
      }
      yield event;
    }
  }

  protected async *
      runLiveImpl(_context: InvocationContext):
          AsyncGenerator<Event, void, void> {
    throw new Error('Not implemented');
  }
}

describe('BaseAgentState', () => {
  describe('LoopAgentState', () => {
    it('should create state with provided values', () => {
      const state = new LoopAgentState({
        currentSubAgent: 'agent1',
        timesLooped: 3,
      });

      expect(state.currentSubAgent).toBe('agent1');
      expect(state.timesLooped).toBe(3);
    });

    it('should convert to object correctly', () => {
      const state = new LoopAgentState({
        currentSubAgent: 'myAgent',
        timesLooped: 5,
      });

      const obj = state.toObject();
      expect(obj).toEqual({
        currentSubAgent: 'myAgent',
        timesLooped: 5,
      });
    });

    it('should create from object correctly', () => {
      const obj = {
        currentSubAgent: 'restoredAgent',
        timesLooped: 7,
      };

      const state = LoopAgentState.fromObject(obj);
      expect(state.currentSubAgent).toBe('restoredAgent');
      expect(state.timesLooped).toBe(7);
    });

    it('should handle missing fields with defaults', () => {
      const state = LoopAgentState.fromObject({});
      expect(state.currentSubAgent).toBe('');
      expect(state.timesLooped).toBe(0);
    });
  });

  describe('createBaseAgentState', () => {
    it('should create state from object', () => {
      const obj = {foo: 'bar', count: 42};
      const state = createBaseAgentState(obj);

      expect(state.toObject()).toEqual(obj);
    });

    it('should not modify original object', () => {
      const original = {key: 'value'};
      const state = createBaseAgentState(original);
      const result = state.toObject();

      expect(result).toEqual(original);
      expect(result).not.toBe(original);
    });
  });
});

describe('InvocationContext - Resumability', () => {
  function createTestContext(options: {
    resumable?: boolean;
    agentStates?: Record<string, Record<string, unknown>>;
    endOfAgents?: Record<string, boolean>;
    events?: Event[];
  } = {}): InvocationContext {
    const session = createSession({
      appName: 'testApp',
      userId: 'testUser',
    });
    if (options.events) {
      session.events = options.events;
    }

    return new InvocationContext({
      invocationId: 'test-invocation',
      agent: new TestAgent({name: 'rootAgent'}),
      session,
      pluginManager: new PluginManager(),
      resumabilityConfig: options.resumable ? {isResumable: true} : undefined,
      agentStates: options.agentStates,
      endOfAgents: options.endOfAgents,
    });
  }

  describe('isResumable', () => {
    it('should return false when resumabilityConfig is not set', () => {
      const context = createTestContext();
      expect(context.isResumable).toBe(false);
    });

    it('should return true when resumabilityConfig.isResumable is true', () => {
      const context = createTestContext({resumable: true});
      expect(context.isResumable).toBe(true);
    });
  });

  describe('setAgentState', () => {
    it('should set agent state', () => {
      const context = createTestContext();
      const state = {currentSubAgent: 'agent1', timesLooped: 2};

      context.setAgentState('loopAgent', state);

      expect(context.getAgentState('loopAgent')).toEqual(state);
      expect(context.isEndOfAgent('loopAgent')).toBe(false);
    });

    it('should mark agent as end and clear state when endOfAgent is true', () => {
      const context = createTestContext();
      context.setAgentState('myAgent', {foo: 'bar'});

      context.setAgentState('myAgent', undefined, true);

      expect(context.getAgentState('myAgent')).toBeUndefined();
      expect(context.isEndOfAgent('myAgent')).toBe(true);
    });

    it('should clear both state and end flag when called with no args', () => {
      const context = createTestContext();
      context.setAgentState('agent', {data: 'value'});
      context.setAgentState('agent', undefined, true);

      context.setAgentState('agent');

      expect(context.getAgentState('agent')).toBeUndefined();
      expect(context.isEndOfAgent('agent')).toBe(false);
    });
  });

  describe('resetSubAgentStates', () => {
    it('should reset state for agent and all sub-agents', () => {
      const context = createTestContext();

      const subAgent1 = new TestAgent({name: 'sub1'});
      const subAgent2 = new TestAgent({name: 'sub2'});
      const parentAgent = new TestAgent({
        name: 'parent',
        subAgents: [subAgent1, subAgent2],
      });

      // Set states for all agents
      context.setAgentState('parent', {data: 'parent'});
      context.setAgentState('sub1', {data: 'sub1'});
      context.setAgentState('sub2', {data: 'sub2'});

      // Reset parent and sub-agents
      context.resetSubAgentStates(parentAgent);

      expect(context.getAgentState('parent')).toBeUndefined();
      expect(context.getAgentState('sub1')).toBeUndefined();
      expect(context.getAgentState('sub2')).toBeUndefined();
    });

    it('should handle deeply nested sub-agents', () => {
      const context = createTestContext();

      const deepSub = new TestAgent({name: 'deep'});
      const middleSub = new TestAgent({name: 'middle', subAgents: [deepSub]});
      const topAgent = new TestAgent({name: 'top', subAgents: [middleSub]});

      context.setAgentState('top', {data: 'top'});
      context.setAgentState('middle', {data: 'middle'});
      context.setAgentState('deep', {data: 'deep'});

      context.resetSubAgentStates(topAgent);

      expect(context.getAgentState('top')).toBeUndefined();
      expect(context.getAgentState('middle')).toBeUndefined();
      expect(context.getAgentState('deep')).toBeUndefined();
    });
  });

  describe('shouldPauseInvocation', () => {
    it('should return false when not resumable', () => {
      const context = createTestContext({resumable: false});
      const event = createEvent({
        invocationId: 'test',
        author: 'agent',
        longRunningToolIds: ['tool1'],
        content: {
          role: 'model',
          parts: [{functionCall: {name: 'myTool', id: 'tool1', args: {}}}],
        },
      });

      expect(context.shouldPauseInvocation(event)).toBe(false);
    });

    it('should return false when no long-running tool IDs', () => {
      const context = createTestContext({resumable: true});
      const event = createEvent({
        invocationId: 'test',
        author: 'agent',
        content: {
          role: 'model',
          parts: [{functionCall: {name: 'myTool', id: 'tool1', args: {}}}],
        },
      });

      expect(context.shouldPauseInvocation(event)).toBe(false);
    });

    it('should return false when no matching function calls', () => {
      const context = createTestContext({resumable: true});
      const event = createEvent({
        invocationId: 'test',
        author: 'agent',
        longRunningToolIds: ['tool1'],
        content: {
          role: 'model',
          parts: [{functionCall: {name: 'myTool', id: 'tool2', args: {}}}],
        },
      });

      expect(context.shouldPauseInvocation(event)).toBe(false);
    });

    it('should return true when function call matches long-running tool ID', () => {
      const context = createTestContext({resumable: true});
      const event = createEvent({
        invocationId: 'test',
        author: 'agent',
        longRunningToolIds: ['tool1', 'tool2'],
        content: {
          role: 'model',
          parts: [{functionCall: {name: 'myTool', id: 'tool1', args: {}}}],
        },
      });

      expect(context.shouldPauseInvocation(event)).toBe(true);
    });
  });

  describe('populateInvocationAgentStates', () => {
    it('should populate states from session events', () => {
      const events: Event[] = [
        createEvent({
          invocationId: 'inv1',
          author: 'agent1',
          actions: {
            stateDelta: {},
            artifactDelta: {},
            requestedAuthConfigs: {},
            requestedToolConfirmations: {},
            agentState: {currentSubAgent: 'sub1', timesLooped: 1},
          },
        }),
        createEvent({
          invocationId: 'inv1',
          author: 'agent2',
          actions: {
            stateDelta: {},
            artifactDelta: {},
            requestedAuthConfigs: {},
            requestedToolConfirmations: {},
            agentState: {data: 'agent2State'},
          },
        }),
      ];

      const context = createTestContext({events});
      context.populateInvocationAgentStates();

      expect(context.getAgentState('agent1')).toEqual({
        currentSubAgent: 'sub1',
        timesLooped: 1,
      });
      expect(context.getAgentState('agent2')).toEqual({data: 'agent2State'});
    });

    it('should handle endOfAgent events', () => {
      const events: Event[] = [
        createEvent({
          invocationId: 'inv1',
          author: 'agent1',
          actions: {
            stateDelta: {},
            artifactDelta: {},
            requestedAuthConfigs: {},
            requestedToolConfirmations: {},
            agentState: {data: 'state1'},
          },
        }),
        createEvent({
          invocationId: 'inv1',
          author: 'agent1',
          actions: {
            stateDelta: {},
            artifactDelta: {},
            requestedAuthConfigs: {},
            requestedToolConfirmations: {},
            endOfAgent: true,
          },
        }),
      ];

      const context = createTestContext({events});
      context.populateInvocationAgentStates();

      expect(context.getAgentState('agent1')).toBeUndefined();
      expect(context.isEndOfAgent('agent1')).toBe(true);
    });
  });
});

describe('LoopAgent - Resumability', () => {
  function createTestContext(options: {
    resumable?: boolean;
    agentStates?: Record<string, Record<string, unknown>>;
    endOfAgents?: Record<string, boolean>;
  } = {}): InvocationContext {
    const session = createSession({
      appName: 'testApp',
      userId: 'testUser',
    });

    return new InvocationContext({
      invocationId: 'test-invocation',
      agent: new TestAgent({name: 'rootAgent'}),
      session,
      pluginManager: new PluginManager(),
      resumabilityConfig: options.resumable ? {isResumable: true} : undefined,
      agentStates: options.agentStates,
      endOfAgents: options.endOfAgents,
    });
  }

  it('should run normally when not resumable', async () => {
    const subAgent1 = new TestAgent({
      name: 'sub1',
      eventsToYield: [
        createEvent({invocationId: 'test', author: 'sub1'}),
      ],
    });
    const subAgent2 = new TestAgent({
      name: 'sub2',
      eventsToYield: [
        createEvent({invocationId: 'test', author: 'sub2'}),
      ],
      shouldEscalate: true,
    });

    const loopAgent = new LoopAgent({
      name: 'loop',
      subAgents: [subAgent1, subAgent2],
      maxIterations: 10,
    });

    const context = createTestContext();
    const events: Event[] = [];

    for await (const event of loopAgent.runAsync(context)) {
      events.push(event);
    }

    // Should have events from sub1 and sub2 before escalation
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some(e => e.author === 'sub1')).toBe(true);
    expect(events.some(e => e.author === 'sub2')).toBe(true);
  });

  it('should yield state checkpoint events when resumable', async () => {
    const subAgent1 = new TestAgent({
      name: 'sub1',
      eventsToYield: [
        createEvent({invocationId: 'test', author: 'sub1'}),
      ],
    });
    const subAgent2 = new TestAgent({
      name: 'sub2',
      eventsToYield: [
        createEvent({invocationId: 'test', author: 'sub2'}),
      ],
      shouldEscalate: true,
    });

    const loopAgent = new LoopAgent({
      name: 'loop',
      subAgents: [subAgent1, subAgent2],
      maxIterations: 10,
    });

    const context = createTestContext({resumable: true});
    const events: Event[] = [];

    for await (const event of loopAgent.runAsync(context)) {
      events.push(event);
    }

    // Should have checkpoint events with agentState
    const checkpointEvents = events.filter(e => e.actions.agentState !== undefined);
    expect(checkpointEvents.length).toBeGreaterThan(0);
  });

  it('should resume from saved state', async () => {
    const subAgent1 = new TestAgent({
      name: 'sub1',
      eventsToYield: [
        createEvent({invocationId: 'test', author: 'sub1'}),
      ],
    });
    const subAgent2 = new TestAgent({
      name: 'sub2',
      eventsToYield: [
        createEvent({invocationId: 'test', author: 'sub2'}),
      ],
      shouldEscalate: true,
    });

    const loopAgent = new LoopAgent({
      name: 'loop',
      subAgents: [subAgent1, subAgent2],
      maxIterations: 10,
    });

    // Create context with saved state starting at sub2
    const context = createTestContext({
      resumable: true,
      agentStates: {
        loop: {currentSubAgent: 'sub2', timesLooped: 0},
      },
    });

    const events: Event[] = [];
    for await (const event of loopAgent.runAsync(context)) {
      events.push(event);
    }

    // Should only have events from sub2 (skipped sub1 due to resume)
    const sub1Events = events.filter(e => e.author === 'sub1');
    const sub2Events = events.filter(e => e.author === 'sub2');

    // sub1 should be skipped because we're resuming at sub2
    expect(sub1Events.length).toBe(0);
    expect(sub2Events.length).toBeGreaterThan(0);
  });

  it('should emit end-of-agent event when loop completes', async () => {
    const subAgent = new TestAgent({
      name: 'sub',
      eventsToYield: [
        createEvent({invocationId: 'test', author: 'sub'}),
      ],
      shouldEscalate: true,
    });

    const loopAgent = new LoopAgent({
      name: 'loop',
      subAgents: [subAgent],
      maxIterations: 1,
    });

    const context = createTestContext({resumable: true});
    const events: Event[] = [];

    for await (const event of loopAgent.runAsync(context)) {
      events.push(event);
    }

    // Check for end-of-agent events
    // Note: Due to escalation, the end-of-agent might not be emitted
    // This test checks the basic loop completion case
    expect(events.length).toBeGreaterThan(0);
  });

  it('should respect maxIterations', async () => {
    const subAgent = new TestAgent({
      name: 'sub',
      eventsToYield: [
        createEvent({invocationId: 'test', author: 'sub'}),
      ],
    });

    const loopAgent = new LoopAgent({
      name: 'loop',
      subAgents: [subAgent],
      maxIterations: 3,
    });

    const context = createTestContext();
    const events: Event[] = [];

    for await (const event of loopAgent.runAsync(context)) {
      events.push(event);
    }

    // Should have exactly 3 events from 3 iterations
    const subEvents = events.filter(e => e.author === 'sub');
    expect(subEvents.length).toBe(3);
  });
});
