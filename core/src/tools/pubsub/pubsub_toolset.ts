/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ReadonlyContext} from '../../agents/readonly_context.js';
import {BaseTool} from '../base_tool.js';
import {BaseToolset, ToolPredicate} from '../base_toolset.js';

import {PubSubClient} from './client.js';
import {PubSubCredentialsConfig} from './credentials.js';
import {PubSubToolConfig, validatePubSubToolConfig} from './config.js';
import {createMessageTools} from './message_tools.js';

/**
 * Options for creating a PubSubToolset.
 */
export interface PubSubToolsetOptions {
  /**
   * Filter to select which tools to expose.
   * Can be a list of tool names or a predicate function.
   */
  toolFilter?: ToolPredicate | string[];

  /**
   * Credentials configuration for Pub/Sub access.
   */
  credentialsConfig?: PubSubCredentialsConfig;

  /**
   * Configuration for Pub/Sub tool behavior.
   */
  toolConfig?: PubSubToolConfig;

  /**
   * Optional custom Pub/Sub client factory for testing.
   * If not provided, uses the real Pub/Sub SDK (lazily loaded).
   */
  clientFactory?: (
    credentialsConfig?: PubSubCredentialsConfig,
    toolConfig?: PubSubToolConfig,
  ) => Promise<PubSubClient>;
}

/**
 * A toolset that provides access to Google Cloud Pub/Sub for messaging operations.
 *
 * The toolset includes tools for:
 * - **Publishing** - Publishing messages to topics
 * - **Subscribing** - Pulling messages from subscriptions
 * - **Acknowledging** - Acknowledging processed messages
 *
 * **Available Tools:**
 * 1. `publish_message` - Publish a message to a Pub/Sub topic
 * 2. `pull_messages` - Pull messages from a subscription
 * 3. `acknowledge_messages` - Acknowledge messages on a subscription
 *
 * @example
 * ```typescript
 * import {PubSubToolset} from '@google/adk';
 *
 * // Create a toolset with default settings
 * const toolset = new PubSubToolset();
 *
 * // Create a toolset with a specific project
 * const toolset = new PubSubToolset({
 *   toolConfig: {
 *     projectId: 'my-project',
 *   },
 * });
 *
 * // Create a toolset with credentials
 * const toolset = new PubSubToolset({
 *   credentialsConfig: {
 *     projectId: 'my-project',
 *   },
 * });
 *
 * // Use with an agent
 * const agent = new LlmAgent({
 *   name: 'pubsub-agent',
 *   model: new Gemini({model: 'gemini-2.5-flash'}),
 *   tools: [toolset],
 * });
 *
 * // Filter to only expose publish_message
 * const toolset = new PubSubToolset({
 *   toolFilter: ['publish_message'],
 * });
 * ```
 *
 * @experimental This feature is experimental and may change in future versions.
 */
export class PubSubToolset extends BaseToolset {
  private readonly credentialsConfig?: PubSubCredentialsConfig;
  private readonly toolConfig: PubSubToolConfig;
  private readonly clientFactory?: (
    credentialsConfig?: PubSubCredentialsConfig,
    toolConfig?: PubSubToolConfig,
  ) => Promise<PubSubClient>;

  private cachedClient?: PubSubClient;
  private tools?: BaseTool[];

  constructor(options: PubSubToolsetOptions = {}) {
    super(options.toolFilter ?? []);
    this.credentialsConfig = options.credentialsConfig;
    this.toolConfig = validatePubSubToolConfig(options.toolConfig);
    this.clientFactory = options.clientFactory;
  }

  /**
   * Gets or creates the Pub/Sub client.
   */
  private async getClient(): Promise<PubSubClient> {
    if (this.cachedClient) {
      return this.cachedClient;
    }

    if (this.clientFactory) {
      this.cachedClient = await this.clientFactory(
        this.credentialsConfig,
        this.toolConfig,
      );
      return this.cachedClient;
    }

    // Lazily import the Pub/Sub SDK client wrapper
    // This allows the SDK to be optionally installed
    const {createPubSubClient} = await import('./pubsub_client_impl.js');
    this.cachedClient = await createPubSubClient(
      this.credentialsConfig,
      this.toolConfig,
    );
    return this.cachedClient;
  }

  /**
   * Returns the tools exposed by this toolset.
   *
   * Returns up to 3 tools:
   * - publish_message
   * - pull_messages
   * - acknowledge_messages
   */
  override async getTools(context?: ReadonlyContext): Promise<BaseTool[]> {
    if (!this.tools) {
      const getClient = () => this.getClient();

      this.tools = createMessageTools(getClient);
    }

    // Apply filtering if context is provided
    if (context) {
      return this.tools.filter((tool) => this.isToolSelected(tool, context));
    }

    // If no context and toolFilter is a string array, filter by name
    if (Array.isArray(this.toolFilter) && this.toolFilter.length > 0) {
      return this.tools.filter((tool) =>
        (this.toolFilter as string[]).includes(tool.name),
      );
    }

    return this.tools;
  }

  /**
   * Closes the toolset and releases any resources.
   */
  override async close(): Promise<void> {
    // Clean up cached clients
    if (this.cachedClient) {
      try {
        const {cleanupClients} = await import('./pubsub_client_impl.js');
        await cleanupClients();
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.cachedClient = undefined;
    this.tools = undefined;
  }
}
