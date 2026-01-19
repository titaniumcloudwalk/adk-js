/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {getPubSubScopes, PubSubCredentialsConfig} from './credentials.js';
import {PubSubToolConfig} from './config.js';
import {PubSubClient, PulledMessage, getPubSubUserAgent} from './client.js';

/**
 * Cache TTL in milliseconds (30 minutes).
 */
const CACHE_TTL = 30 * 60 * 1000;

/**
 * Cached client entry with timestamp.
 */
interface CachedClient<T> {
  client: T;
  createdAt: number;
}

/**
 * Client caches with TTL.
 */
let publisherCache: CachedClient<PublisherClient> | undefined;
let subscriberCache: CachedClient<SubscriberClient> | undefined;

/**
 * Internal interface for the @google-cloud/pubsub PublisherClient.
 */
interface PublisherClient {
  publish(request: {
    topic: string;
    messages: Array<{
      data: Buffer;
      attributes?: Record<string, string>;
      orderingKey?: string;
    }>;
  }): Promise<[{messageIds: string[]}]>;
  close(): Promise<void>;
}

/**
 * Internal interface for the @google-cloud/pubsub SubscriberClient.
 */
interface SubscriberClient {
  pull(request: {
    subscription: string;
    maxMessages: number;
  }): Promise<
    [
      {
        receivedMessages: Array<{
          ackId: string;
          message: {
            messageId: string;
            data: Buffer;
            attributes: Record<string, string>;
            orderingKey?: string;
            publishTime: {seconds: string; nanos: number};
          };
        }>;
      },
    ]
  >;
  acknowledge(request: {
    subscription: string;
    ackIds: string[];
  }): Promise<void>;
  close(): Promise<void>;
}

/**
 * Checks if a cached client is still valid.
 */
function isCacheValid<T>(cache: CachedClient<T> | undefined): boolean {
  if (!cache) return false;
  return Date.now() - cache.createdAt < CACHE_TTL;
}

/**
 * Creates or retrieves a cached publisher client.
 */
async function getPublisherClient(
  credentialsConfig?: PubSubCredentialsConfig,
): Promise<PublisherClient> {
  if (isCacheValid(publisherCache)) {
    return publisherCache!.client;
  }

  // Lazily import the Pub/Sub SDK
  // @ts-ignore - optional peer dependency
  const {PublisherClient} = await import('@google-cloud/pubsub');

  const scopes = getPubSubScopes(credentialsConfig);
  const userAgent = getPubSubUserAgent();

  const client = new PublisherClient({
    projectId: credentialsConfig?.projectId,
    scopes,
    'grpc.primary_user_agent': userAgent,
    // Disable batching for synchronous publishing
    batching: {
      maxMessages: 1,
    },
  });

  publisherCache = {client, createdAt: Date.now()};
  return client;
}

/**
 * Creates or retrieves a cached subscriber client.
 */
async function getSubscriberClient(
  credentialsConfig?: PubSubCredentialsConfig,
): Promise<SubscriberClient> {
  if (isCacheValid(subscriberCache)) {
    return subscriberCache!.client;
  }

  // Lazily import the Pub/Sub SDK
  // @ts-ignore - optional peer dependency
  const {SubscriberClient} = await import('@google-cloud/pubsub');

  const scopes = getPubSubScopes(credentialsConfig);
  const userAgent = getPubSubUserAgent();

  const client = new SubscriberClient({
    projectId: credentialsConfig?.projectId,
    scopes,
    'grpc.primary_user_agent': userAgent,
  });

  subscriberCache = {client, createdAt: Date.now()};
  return client;
}

/**
 * Cleans up all cached clients.
 */
export async function cleanupClients(): Promise<void> {
  if (publisherCache) {
    await publisherCache.client.close();
    publisherCache = undefined;
  }
  if (subscriberCache) {
    await subscriberCache.client.close();
    subscriberCache = undefined;
  }
}

/**
 * Implementation of PubSubClient using the @google-cloud/pubsub SDK.
 */
class PubSubClientImpl implements PubSubClient {
  readonly projectId: string;
  private readonly credentialsConfig?: PubSubCredentialsConfig;

  constructor(
    projectId: string,
    credentialsConfig?: PubSubCredentialsConfig,
  ) {
    this.projectId = projectId;
    this.credentialsConfig = credentialsConfig;
  }

  async publishMessage(
    topicName: string,
    message: string,
    attributes?: Record<string, string>,
    orderingKey?: string,
  ): Promise<string> {
    const client = await getPublisherClient(this.credentialsConfig);

    const request: {
      topic: string;
      messages: Array<{
        data: Buffer;
        attributes?: Record<string, string>;
        orderingKey?: string;
      }>;
    } = {
      topic: topicName,
      messages: [
        {
          data: Buffer.from(message, 'utf-8'),
          attributes,
          orderingKey,
        },
      ],
    };

    const [response] = await client.publish(request);
    return response.messageIds[0];
  }

  async pullMessages(
    subscriptionName: string,
    maxMessages: number,
    autoAck?: boolean,
  ): Promise<PulledMessage[]> {
    const client = await getSubscriberClient(this.credentialsConfig);

    const [response] = await client.pull({
      subscription: subscriptionName,
      maxMessages,
    });

    const messages: PulledMessage[] = response.receivedMessages.map((msg) => {
      // Try to decode as UTF-8, fall back to base64 for binary data
      let data: string;
      try {
        data = msg.message.data.toString('utf-8');
        // Verify it's valid UTF-8 by checking for replacement character
        if (data.includes('\uFFFD')) {
          throw new Error('Invalid UTF-8');
        }
      } catch {
        data = msg.message.data.toString('base64');
      }

      // Convert publish time to RFC3339 format
      const publishTime = new Date(
        parseInt(msg.message.publishTime.seconds) * 1000 +
          msg.message.publishTime.nanos / 1000000,
      ).toISOString();

      return {
        messageId: msg.message.messageId,
        data,
        attributes: msg.message.attributes || {},
        orderingKey: msg.message.orderingKey,
        publishTime,
        ackId: msg.ackId,
      };
    });

    // Auto-acknowledge if requested
    if (autoAck && messages.length > 0) {
      const ackIds = messages.map((m) => m.ackId);
      await this.acknowledgeMessages(subscriptionName, ackIds);
    }

    return messages;
  }

  async acknowledgeMessages(
    subscriptionName: string,
    ackIds: string[],
  ): Promise<void> {
    const client = await getSubscriberClient(this.credentialsConfig);

    await client.acknowledge({
      subscription: subscriptionName,
      ackIds,
    });
  }
}

/**
 * Creates a PubSubClient instance using the @google-cloud/pubsub SDK.
 *
 * @param credentialsConfig Credentials configuration
 * @param toolConfig Tool configuration
 * @returns A PubSubClient instance
 */
export async function createPubSubClient(
  credentialsConfig?: PubSubCredentialsConfig,
  toolConfig?: PubSubToolConfig,
): Promise<PubSubClient> {
  // Determine project ID from config or environment
  let projectId = toolConfig?.projectId || credentialsConfig?.projectId;

  if (!projectId) {
    // Try to get from environment
    projectId =
      process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  }

  if (!projectId) {
    // Try to get from the SDK's default project detection
    try {
      const {GoogleAuth} = await import('google-auth-library');
      const auth = new GoogleAuth({
        scopes: getPubSubScopes(credentialsConfig),
      });
      projectId = await auth.getProjectId();
    } catch {
      // google-auth-library not available
    }
  }

  if (!projectId) {
    throw new Error(
      'Unable to determine project ID. Please set projectId in toolConfig, ' +
        'credentialsConfig, or set the GOOGLE_CLOUD_PROJECT environment variable.',
    );
  }

  return new PubSubClientImpl(projectId, credentialsConfig);
}
