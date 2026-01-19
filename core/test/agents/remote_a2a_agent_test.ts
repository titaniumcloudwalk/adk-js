/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {
  RemoteA2aAgent,
  A2ATask,
  A2AMessage,
  A2AClientError,
} from '../../src/a2a/agents/remote_a2a_agent.js';
import type {AgentCard} from '../../src/a2a/utils/agent_card_builder.js';
import type {InvocationContext} from '../../src/agents/invocation_context.js';
import {InMemorySessionService} from '../../src/sessions/in_memory_session_service.js';
import type {Session} from '../../src/sessions/session.js';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('RemoteA2aAgent', () => {
  let mockAgentCard: AgentCard;
  let mockSession: Session;
  let mockCtx: InvocationContext;

  beforeEach(async () => {
    mockFetch.mockReset();

    mockAgentCard = {
      name: 'test_remote_agent',
      description: 'A test remote agent',
      url: 'https://example.com/a2a',
      version: '1.0.0',
    };

    // Create a real session using InMemorySessionService
    const sessionService = new InMemorySessionService();
    mockSession = await sessionService.createSession({
      appName: 'test-app',
      userId: 'test-user',
    });

    mockCtx = {
      invocationId: 'test-inv-123',
      branch: 'main',
      session: mockSession,
      appName: 'test-app',
      userId: 'test-user',
    } as unknown as InvocationContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create agent with AgentCard object', () => {
      const agent = new RemoteA2aAgent({
        name: 'my_remote_agent',
        agentCard: mockAgentCard,
      });

      expect(agent.name).toBe('my_remote_agent');
      expect(agent.agentCard).toEqual(mockAgentCard);
    });

    it('should create agent with URL string', () => {
      const agent = new RemoteA2aAgent({
        name: 'my_remote_agent',
        agentCard: 'https://example.com/agent-card.json',
      });

      expect(agent.name).toBe('my_remote_agent');
      expect(agent.agentCard).toBeUndefined(); // Not resolved yet
    });

    it('should throw if agentCard is null', () => {
      expect(() => {
        new RemoteA2aAgent({
          name: 'test',
          agentCard: null as unknown as AgentCard,
        });
      }).toThrow('agentCard cannot be null or undefined');
    });

    it('should throw if agentCard string is empty', () => {
      expect(() => {
        new RemoteA2aAgent({
          name: 'test',
          agentCard: '   ',
        });
      }).toThrow('agentCard string cannot be empty');
    });
  });

  describe('isRemoteResponse', () => {
    it('should return true for events with response metadata', () => {
      const agent = new RemoteA2aAgent({
        name: 'test_agent',
        agentCard: mockAgentCard,
      });

      // Access private method via prototype
      const isRemoteResponse = (agent as any).isRemoteResponse.bind(agent);

      const event = {
        author: 'test_agent',
        customMetadata: {
          'a2a:response': {some: 'data'},
        },
      };

      expect(isRemoteResponse(event)).toBe(true);
    });

    it('should return false for events without response metadata', () => {
      const agent = new RemoteA2aAgent({
        name: 'test_agent',
        agentCard: mockAgentCard,
      });

      const isRemoteResponse = (agent as any).isRemoteResponse.bind(agent);

      const event = {
        author: 'test_agent',
        customMetadata: {
          'a2a:task_id': '123',
        },
      };

      expect(isRemoteResponse(event)).toBe(false);
    });

    it('should return false for events from different authors', () => {
      const agent = new RemoteA2aAgent({
        name: 'test_agent',
        agentCard: mockAgentCard,
      });

      const isRemoteResponse = (agent as any).isRemoteResponse.bind(agent);

      const event = {
        author: 'other_agent',
        customMetadata: {
          'a2a:response': true,
        },
      };

      expect(isRemoteResponse(event)).toBe(false);
    });

    it('should return false for events without customMetadata', () => {
      const agent = new RemoteA2aAgent({
        name: 'test_agent',
        agentCard: mockAgentCard,
      });

      const isRemoteResponse = (agent as any).isRemoteResponse.bind(agent);

      const event = {
        author: 'test_agent',
      };

      expect(isRemoteResponse(event)).toBe(false);
    });
  });

  describe('handleA2aResponse - thought marking', () => {
    it('should mark all parts as thought for working task state', async () => {
      const agent = new RemoteA2aAgent({
        name: 'test_agent',
        agentCard: mockAgentCard,
      });

      // Create a task response with 'working' state
      const taskResponse: [A2ATask, unknown] = [
        {
          id: 'task-123',
          status: {
            state: 'working',
            message: {
              parts: [
                {kind: 'text', text: 'Processing...'},
                {kind: 'text', text: 'Still working...'},
              ],
              role: 'agent',
            },
          },
        },
        null,
      ];

      // Access private method via prototype
      const handleA2aResponse = (agent as any).handleA2aResponse.bind(agent);
      const event = await handleA2aResponse(taskResponse, mockCtx);

      // Verify all parts are marked as thought
      expect(event).toBeDefined();
      expect(event.content?.parts).toHaveLength(2);
      expect(event.content?.parts[0].thought).toBe(true);
      expect(event.content?.parts[1].thought).toBe(true);
    });

    it('should mark all parts as thought for submitted task state', async () => {
      const agent = new RemoteA2aAgent({
        name: 'test_agent',
        agentCard: mockAgentCard,
      });

      // Create a task response with 'submitted' state
      const taskResponse: [A2ATask, unknown] = [
        {
          id: 'task-456',
          status: {
            state: 'submitted',
            message: {
              parts: [
                {kind: 'text', text: 'Part 1'},
                {kind: 'text', text: 'Part 2'},
                {kind: 'text', text: 'Part 3'},
              ],
              role: 'agent',
            },
          },
        },
        null,
      ];

      const handleA2aResponse = (agent as any).handleA2aResponse.bind(agent);
      const event = await handleA2aResponse(taskResponse, mockCtx);

      // Verify all 3 parts are marked as thought
      expect(event.content?.parts).toHaveLength(3);
      for (const part of event.content?.parts ?? []) {
        expect(part.thought).toBe(true);
      }
    });

    it('should NOT mark parts as thought for completed task state', async () => {
      const agent = new RemoteA2aAgent({
        name: 'test_agent',
        agentCard: mockAgentCard,
      });

      // Create a task response with 'completed' state
      const taskResponse: [A2ATask, unknown] = [
        {
          id: 'task-789',
          status: {
            state: 'completed',
            message: {
              parts: [
                {kind: 'text', text: 'Final result'},
              ],
              role: 'agent',
            },
          },
        },
        null,
      ];

      const handleA2aResponse = (agent as any).handleA2aResponse.bind(agent);
      const event = await handleA2aResponse(taskResponse, mockCtx);

      // Verify parts are NOT marked as thought for completed state
      expect(event.content?.parts).toHaveLength(1);
      expect(event.content?.parts[0].thought).toBeUndefined();
    });

    it('should NOT mark parts as thought for failed task state', async () => {
      const agent = new RemoteA2aAgent({
        name: 'test_agent',
        agentCard: mockAgentCard,
      });

      // Create a task response with 'failed' state
      const taskResponse: [A2ATask, unknown] = [
        {
          id: 'task-error',
          status: {
            state: 'failed',
            message: {
              parts: [{kind: 'text', text: 'Error occurred'}],
              role: 'agent',
            },
          },
        },
        null,
      ];

      const handleA2aResponse = (agent as any).handleA2aResponse.bind(agent);
      const event = await handleA2aResponse(taskResponse, mockCtx);

      // Verify parts are NOT marked as thought for failed state
      expect(event.content?.parts[0].thought).toBeUndefined();
    });

    it('should NOT mark parts as thought for regular message responses', async () => {
      const agent = new RemoteA2aAgent({
        name: 'test_agent',
        agentCard: mockAgentCard,
      });

      // Create a regular message response (not a task)
      const messageResponse: A2AMessage = {
        messageId: 'msg-123',
        parts: [
          {kind: 'text', text: 'Hello!'},
          {kind: 'text', text: 'How are you?'},
        ],
        role: 'agent',
      };

      const handleA2aResponse = (agent as any).handleA2aResponse.bind(agent);
      const event = await handleA2aResponse(messageResponse, mockCtx);

      // Verify parts are NOT marked as thought for regular messages
      expect(event.content?.parts).toHaveLength(2);
      expect(event.content?.parts[0].thought).toBeUndefined();
      expect(event.content?.parts[1].thought).toBeUndefined();
    });

    it('should handle case-insensitive task states', async () => {
      const agent = new RemoteA2aAgent({
        name: 'test_agent',
        agentCard: mockAgentCard,
      });

      // Create task with uppercase 'WORKING' state
      const taskResponse: [A2ATask, unknown] = [
        {
          id: 'task-upper',
          status: {
            state: 'WORKING',
            message: {
              parts: [{kind: 'text', text: 'Processing...'}],
              role: 'agent',
            },
          },
        },
        null,
      ];

      const handleA2aResponse = (agent as any).handleA2aResponse.bind(agent);
      const event = await handleA2aResponse(taskResponse, mockCtx);

      // Should still mark as thought due to case-insensitive comparison
      expect(event.content?.parts[0].thought).toBe(true);
    });
  });

  describe('runAsyncImpl integration', () => {
    it('should set response metadata on yielded events', async () => {
      const agent = new RemoteA2aAgent({
        name: 'test_agent',
        agentCard: mockAgentCard,
      });

      // Mock fetch to return a message response
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            messageId: 'msg-123',
            parts: [{kind: 'text', text: 'Hello'}],
            role: 'agent',
          },
        }),
      });

      // Add an event to session so there's something to send
      mockSession.events.push({
        author: 'user',
        content: {
          role: 'user',
          parts: [{text: 'Hello!'}],
        },
        invocationId: 'inv-1',
      } as any);

      const events: any[] = [];
      for await (const event of agent.runAsync(mockCtx)) {
        events.push(event);
      }

      expect(events.length).toBe(1);
      expect(events[0].customMetadata).toBeDefined();
      expect(events[0].customMetadata['a2a:response']).toBeDefined();
    });
  });
});
