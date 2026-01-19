/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {version} from '../../version.js';

/**
 * Pub/Sub client interface - minimal interface for the operations we need.
 * This allows for easy mocking in tests and doesn't require the full Pub/Sub SDK.
 */
export interface PubSubClient {
  projectId: string;

  /**
   * Publish a message to a topic.
   *
   * @param topicName Full topic path (projects/{project}/topics/{topic})
   * @param message Message content (UTF-8 string)
   * @param attributes Optional message attributes
   * @param orderingKey Optional ordering key for message ordering
   * @returns The published message ID
   */
  publishMessage(
    topicName: string,
    message: string,
    attributes?: Record<string, string>,
    orderingKey?: string,
  ): Promise<string>;

  /**
   * Pull messages from a subscription.
   *
   * @param subscriptionName Full subscription path (projects/{project}/subscriptions/{subscription})
   * @param maxMessages Maximum number of messages to pull
   * @param autoAck If true, automatically acknowledge messages
   * @returns Array of pulled messages with ack IDs
   */
  pullMessages(
    subscriptionName: string,
    maxMessages: number,
    autoAck?: boolean,
  ): Promise<PulledMessage[]>;

  /**
   * Acknowledge messages by their ack IDs.
   *
   * @param subscriptionName Full subscription path
   * @param ackIds Array of ack IDs to acknowledge
   */
  acknowledgeMessages(
    subscriptionName: string,
    ackIds: string[],
  ): Promise<void>;
}

/**
 * A message pulled from a subscription.
 */
export interface PulledMessage {
  /**
   * Server-assigned message ID.
   */
  messageId: string;

  /**
   * Message content (decoded as UTF-8 if possible, or base64 if binary).
   */
  data: string;

  /**
   * Message attributes.
   */
  attributes: Record<string, string>;

  /**
   * Ordering key if message ordering is enabled.
   */
  orderingKey?: string;

  /**
   * Time the message was published (RFC3339 format).
   */
  publishTime: string;

  /**
   * Acknowledgment ID for acknowledging this message.
   */
  ackId: string;
}

/**
 * User agent string for Pub/Sub requests.
 */
export function getPubSubUserAgent(applicationName?: string): string {
  const baseAgent = `adk-pubsub-tool google-adk/${version}`;
  if (applicationName) {
    return `${baseAgent} ${applicationName}`;
  }
  return baseAgent;
}
