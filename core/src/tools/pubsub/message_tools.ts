/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {z} from 'zod';

import {BaseTool} from '../base_tool.js';
import {FunctionTool} from '../function_tool.js';

import {PubSubClient, PulledMessage} from './client.js';

/**
 * Response from publish_message tool.
 */
export interface PublishMessageResponse {
  messageId?: string;
  status?: 'ERROR';
  errorDetails?: string;
}

/**
 * Response from pull_messages tool.
 */
export interface PullMessagesResponse {
  messages?: Array<{
    messageId: string;
    data: string;
    attributes: Record<string, string>;
    orderingKey?: string;
    publishTime: string;
    ackId: string;
  }>;
  status?: 'ERROR';
  errorDetails?: string;
}

/**
 * Response from acknowledge_messages tool.
 */
export interface AcknowledgeMessagesResponse {
  status: 'SUCCESS' | 'ERROR';
  errorDetails?: string;
}

/**
 * Creates the publish_message tool.
 */
export function createPublishMessageTool(
  getClient: () => Promise<PubSubClient>,
): BaseTool {
  const schema = z.object({
    topicName: z.string().describe(
      'Full topic path (e.g., projects/my-project/topics/my-topic)',
    ),
    message: z.string().describe('Message content to publish'),
    attributes: z
      .record(z.string())
      .optional()
      .describe('Optional message attributes'),
    orderingKey: z
      .string()
      .optional()
      .describe('Optional ordering key for message ordering'),
  });

  return new FunctionTool({
    name: 'publish_message',
    description: 'Publish a message to a Google Cloud Pub/Sub topic.',
    parameters: schema,
    execute: async (
      args: z.infer<typeof schema>,
    ): Promise<PublishMessageResponse> => {
      try {
        const client = await getClient();
        const messageId = await client.publishMessage(
          args.topicName,
          args.message,
          args.attributes,
          args.orderingKey,
        );
        return {messageId};
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          status: 'ERROR',
          errorDetails: errorMessage,
        };
      }
    },
  });
}

/**
 * Creates the pull_messages tool.
 */
export function createPullMessagesTool(
  getClient: () => Promise<PubSubClient>,
): BaseTool {
  const schema = z.object({
    subscriptionName: z.string().describe(
      'Full subscription path (e.g., projects/my-project/subscriptions/my-sub)',
    ),
    maxMessages: z
      .number()
      .int()
      .positive()
      .default(1)
      .describe('Maximum number of messages to pull (default: 1)'),
    autoAck: z
      .boolean()
      .default(false)
      .describe(
        'If true, automatically acknowledge messages after pulling (default: false)',
      ),
  });

  return new FunctionTool({
    name: 'pull_messages',
    description:
      'Pull messages from a Google Cloud Pub/Sub subscription. ' +
      'Returns messages with ack_id for manual acknowledgment unless auto_ack is true.',
    parameters: schema,
    execute: async (
      args: z.infer<typeof schema>,
    ): Promise<PullMessagesResponse> => {
      try {
        const client = await getClient();
        const messages = await client.pullMessages(
          args.subscriptionName,
          args.maxMessages,
          args.autoAck,
        );

        return {
          messages: messages.map((msg: PulledMessage) => ({
            messageId: msg.messageId,
            data: msg.data,
            attributes: msg.attributes,
            orderingKey: msg.orderingKey,
            publishTime: msg.publishTime,
            ackId: msg.ackId,
          })),
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          status: 'ERROR',
          errorDetails: errorMessage,
        };
      }
    },
  });
}

/**
 * Creates the acknowledge_messages tool.
 */
export function createAcknowledgeMessagesTool(
  getClient: () => Promise<PubSubClient>,
): BaseTool {
  const schema = z.object({
    subscriptionName: z.string().describe(
      'Full subscription path (e.g., projects/my-project/subscriptions/my-sub)',
    ),
    ackIds: z
      .array(z.string())
      .min(1)
      .describe('List of acknowledgment IDs from pull_messages response'),
  });

  return new FunctionTool({
    name: 'acknowledge_messages',
    description:
      'Acknowledge messages on a Google Cloud Pub/Sub subscription. ' +
      'Use the ack_id values from pull_messages response.',
    parameters: schema,
    execute: async (
      args: z.infer<typeof schema>,
    ): Promise<AcknowledgeMessagesResponse> => {
      try {
        const client = await getClient();
        await client.acknowledgeMessages(args.subscriptionName, args.ackIds);
        return {status: 'SUCCESS'};
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          status: 'ERROR',
          errorDetails: errorMessage,
        };
      }
    },
  });
}

/**
 * Creates all message tools.
 *
 * @param getClient Function to get the PubSubClient
 * @returns Array of message tools
 */
export function createMessageTools(
  getClient: () => Promise<PubSubClient>,
): BaseTool[] {
  return [
    createPublishMessageTool(getClient),
    createPullMessagesTool(getClient),
    createAcknowledgeMessagesTool(getClient),
  ];
}
