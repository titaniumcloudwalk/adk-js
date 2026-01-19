/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, beforeEach, vi} from 'vitest';

import {
  PubSubToolset,
  DEFAULT_PUBSUB_SCOPE,
  getPubSubScopes,
  getPubSubUserAgent,
  validatePubSubToolConfig,
  PubSubClient,
  PubSubToolConfig,
  PubSubCredentialsConfig,
  PulledMessage,
} from '../../../src/tools/pubsub/index.js';
import {version} from '../../../src/version.js';

describe('PubSubToolset', () => {
  /**
   * Create a mock PubSubClient for testing.
   */
  function createMockClient(
    projectId: string = 'test-project',
  ): PubSubClient {
    return {
      projectId,
      publishMessage: vi.fn().mockResolvedValue('message-123'),
      pullMessages: vi.fn().mockResolvedValue([
        {
          messageId: 'msg-1',
          data: 'Hello World',
          attributes: {key: 'value'},
          orderingKey: 'order-1',
          publishTime: '2025-01-01T00:00:00Z',
          ackId: 'ack-1',
        },
      ] as PulledMessage[]),
      acknowledgeMessages: vi.fn().mockResolvedValue(undefined),
    };
  }

  describe('credentials', () => {
    it('should have correct default scope', () => {
      expect(DEFAULT_PUBSUB_SCOPE).toBe(
        'https://www.googleapis.com/auth/pubsub',
      );
    });

    it('should return default scopes when not configured', () => {
      const scopes = getPubSubScopes();
      expect(scopes).toEqual([DEFAULT_PUBSUB_SCOPE]);
    });

    it('should return custom scopes when configured', () => {
      const config: PubSubCredentialsConfig = {
        scopes: ['custom-scope-1', 'custom-scope-2'],
      };
      const scopes = getPubSubScopes(config);
      expect(scopes).toEqual(['custom-scope-1', 'custom-scope-2']);
    });
  });

  describe('config', () => {
    it('should validate empty config', () => {
      const config = validatePubSubToolConfig();
      expect(config).toEqual({projectId: undefined});
    });

    it('should preserve projectId', () => {
      const config = validatePubSubToolConfig({projectId: 'my-project'});
      expect(config.projectId).toBe('my-project');
    });
  });

  describe('user agent', () => {
    it('should return base user agent', () => {
      const userAgent = getPubSubUserAgent();
      expect(userAgent).toBe(`adk-pubsub-tool google-adk/${version}`);
    });

    it('should include application name if provided', () => {
      const userAgent = getPubSubUserAgent('my-app');
      expect(userAgent).toBe(`adk-pubsub-tool google-adk/${version} my-app`);
    });
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const mockClient = createMockClient();
      const toolset = new PubSubToolset({
        clientFactory: async () => mockClient,
      });
      expect(toolset).toBeInstanceOf(PubSubToolset);
    });

    it('should accept credentialsConfig', () => {
      const mockClient = createMockClient();
      const toolset = new PubSubToolset({
        credentialsConfig: {projectId: 'my-project'},
        clientFactory: async () => mockClient,
      });
      expect(toolset).toBeInstanceOf(PubSubToolset);
    });

    it('should accept toolConfig', () => {
      const mockClient = createMockClient();
      const toolset = new PubSubToolset({
        toolConfig: {projectId: 'my-project'},
        clientFactory: async () => mockClient,
      });
      expect(toolset).toBeInstanceOf(PubSubToolset);
    });

    it('should accept toolFilter as string array', () => {
      const mockClient = createMockClient();
      const toolset = new PubSubToolset({
        toolFilter: ['publish_message'],
        clientFactory: async () => mockClient,
      });
      expect(toolset).toBeInstanceOf(PubSubToolset);
    });
  });

  describe('getTools', () => {
    let mockClient: PubSubClient;
    let toolset: PubSubToolset;

    beforeEach(() => {
      mockClient = createMockClient();
      toolset = new PubSubToolset({
        clientFactory: async () => mockClient,
      });
    });

    it('should return 3 tools', async () => {
      const tools = await toolset.getTools();
      expect(tools).toHaveLength(3);
    });

    it('should include publish_message tool', async () => {
      const tools = await toolset.getTools();
      const publishTool = tools.find((t) => t.name === 'publish_message');
      expect(publishTool).toBeDefined();
      expect(publishTool?.description).toContain('Publish a message');
    });

    it('should include pull_messages tool', async () => {
      const tools = await toolset.getTools();
      const pullTool = tools.find((t) => t.name === 'pull_messages');
      expect(pullTool).toBeDefined();
      expect(pullTool?.description).toContain('Pull messages');
    });

    it('should include acknowledge_messages tool', async () => {
      const tools = await toolset.getTools();
      const ackTool = tools.find((t) => t.name === 'acknowledge_messages');
      expect(ackTool).toBeDefined();
      expect(ackTool?.description).toContain('Acknowledge messages');
    });

    it('should filter tools by name', async () => {
      const filteredToolset = new PubSubToolset({
        toolFilter: ['publish_message', 'pull_messages'],
        clientFactory: async () => mockClient,
      });
      const tools = await filteredToolset.getTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual([
        'publish_message',
        'pull_messages',
      ]);
    });

    it('should cache tools', async () => {
      const tools1 = await toolset.getTools();
      const tools2 = await toolset.getTools();
      expect(tools1).toBe(tools2);
    });
  });

  describe('publish_message tool', () => {
    let mockClient: PubSubClient;
    let toolset: PubSubToolset;

    beforeEach(() => {
      mockClient = createMockClient();
      toolset = new PubSubToolset({
        clientFactory: async () => mockClient,
      });
    });

    it('should publish a message', async () => {
      const tools = await toolset.getTools();
      const publishTool = tools.find((t) => t.name === 'publish_message')!;

      const result = await publishTool.runAsync({
        args: {
          topicName: 'projects/test/topics/my-topic',
          message: 'Hello World',
        },
        toolContext: {} as any,
      });

      expect(mockClient.publishMessage).toHaveBeenCalledWith(
        'projects/test/topics/my-topic',
        'Hello World',
        undefined,
        undefined,
      );
      expect(result).toEqual({messageId: 'message-123'});
    });

    it('should publish with attributes and ordering key', async () => {
      const tools = await toolset.getTools();
      const publishTool = tools.find((t) => t.name === 'publish_message')!;

      await publishTool.runAsync({
        args: {
          topicName: 'projects/test/topics/my-topic',
          message: 'Hello',
          attributes: {key: 'value'},
          orderingKey: 'order-1',
        },
        toolContext: {} as any,
      });

      expect(mockClient.publishMessage).toHaveBeenCalledWith(
        'projects/test/topics/my-topic',
        'Hello',
        {key: 'value'},
        'order-1',
      );
    });

    it('should handle errors', async () => {
      (mockClient.publishMessage as any).mockRejectedValue(
        new Error('Topic not found'),
      );

      const tools = await toolset.getTools();
      const publishTool = tools.find((t) => t.name === 'publish_message')!;

      const result = await publishTool.runAsync({
        args: {
          topicName: 'projects/test/topics/my-topic',
          message: 'Hello',
        },
        toolContext: {} as any,
      });

      expect(result).toEqual({
        status: 'ERROR',
        errorDetails: 'Topic not found',
      });
    });
  });

  describe('pull_messages tool', () => {
    let mockClient: PubSubClient;
    let toolset: PubSubToolset;

    beforeEach(() => {
      mockClient = createMockClient();
      toolset = new PubSubToolset({
        clientFactory: async () => mockClient,
      });
    });

    it('should pull messages', async () => {
      const tools = await toolset.getTools();
      const pullTool = tools.find((t) => t.name === 'pull_messages')!;

      const result = await pullTool.runAsync({
        args: {
          subscriptionName: 'projects/test/subscriptions/my-sub',
          maxMessages: 10,
        },
        toolContext: {} as any,
      });

      expect(mockClient.pullMessages).toHaveBeenCalledWith(
        'projects/test/subscriptions/my-sub',
        10,
        false,
      );
      expect(result).toEqual({
        messages: [
          {
            messageId: 'msg-1',
            data: 'Hello World',
            attributes: {key: 'value'},
            orderingKey: 'order-1',
            publishTime: '2025-01-01T00:00:00Z',
            ackId: 'ack-1',
          },
        ],
      });
    });

    it('should support autoAck', async () => {
      const tools = await toolset.getTools();
      const pullTool = tools.find((t) => t.name === 'pull_messages')!;

      await pullTool.runAsync({
        args: {
          subscriptionName: 'projects/test/subscriptions/my-sub',
          maxMessages: 1,
          autoAck: true,
        },
        toolContext: {} as any,
      });

      expect(mockClient.pullMessages).toHaveBeenCalledWith(
        'projects/test/subscriptions/my-sub',
        1,
        true,
      );
    });

    it('should handle errors', async () => {
      (mockClient.pullMessages as any).mockRejectedValue(
        new Error('Subscription not found'),
      );

      const tools = await toolset.getTools();
      const pullTool = tools.find((t) => t.name === 'pull_messages')!;

      const result = await pullTool.runAsync({
        args: {
          subscriptionName: 'projects/test/subscriptions/my-sub',
          maxMessages: 1,
        },
        toolContext: {} as any,
      });

      expect(result).toEqual({
        status: 'ERROR',
        errorDetails: 'Subscription not found',
      });
    });
  });

  describe('acknowledge_messages tool', () => {
    let mockClient: PubSubClient;
    let toolset: PubSubToolset;

    beforeEach(() => {
      mockClient = createMockClient();
      toolset = new PubSubToolset({
        clientFactory: async () => mockClient,
      });
    });

    it('should acknowledge messages', async () => {
      const tools = await toolset.getTools();
      const ackTool = tools.find((t) => t.name === 'acknowledge_messages')!;

      const result = await ackTool.runAsync({
        args: {
          subscriptionName: 'projects/test/subscriptions/my-sub',
          ackIds: ['ack-1', 'ack-2'],
        },
        toolContext: {} as any,
      });

      expect(mockClient.acknowledgeMessages).toHaveBeenCalledWith(
        'projects/test/subscriptions/my-sub',
        ['ack-1', 'ack-2'],
      );
      expect(result).toEqual({status: 'SUCCESS'});
    });

    it('should handle errors', async () => {
      (mockClient.acknowledgeMessages as any).mockRejectedValue(
        new Error('Invalid ack ID'),
      );

      const tools = await toolset.getTools();
      const ackTool = tools.find((t) => t.name === 'acknowledge_messages')!;

      const result = await ackTool.runAsync({
        args: {
          subscriptionName: 'projects/test/subscriptions/my-sub',
          ackIds: ['invalid-ack'],
        },
        toolContext: {} as any,
      });

      expect(result).toEqual({
        status: 'ERROR',
        errorDetails: 'Invalid ack ID',
      });
    });
  });

  describe('close', () => {
    it('should clear cached client and tools', async () => {
      const mockClient = createMockClient();
      const toolset = new PubSubToolset({
        clientFactory: async () => mockClient,
      });

      // Get tools to initialize cache
      await toolset.getTools();

      // Close
      await toolset.close();

      // Tools should be recreated on next call
      const tools = await toolset.getTools();
      expect(tools).toHaveLength(3);
    });
  });

  describe('client caching', () => {
    it('should cache the client', async () => {
      let clientCreations = 0;
      const mockClient = createMockClient();
      const toolset = new PubSubToolset({
        clientFactory: async () => {
          clientCreations++;
          return mockClient;
        },
      });

      // Get tools multiple times
      await toolset.getTools();
      await toolset.getTools();
      await toolset.getTools();

      // Client should only be created once (lazy on first getClient call)
      // Note: getTools doesn't create client until a tool is executed
      // Let's execute a tool to trigger client creation
      const tools = await toolset.getTools();
      await tools[0].runAsync({
        args: {
          topicName: 'projects/test/topics/my-topic',
          message: 'Hello',
        },
        toolContext: {} as any,
      });
      await tools[0].runAsync({
        args: {
          topicName: 'projects/test/topics/my-topic',
          message: 'World',
        },
        toolContext: {} as any,
      });

      expect(clientCreations).toBe(1);
    });
  });
});
