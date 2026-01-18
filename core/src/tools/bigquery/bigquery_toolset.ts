/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ReadonlyContext} from '../../agents/readonly_context.js';
import {BaseTool} from '../base_tool.js';
import {BaseToolset, ToolPredicate} from '../base_toolset.js';

import {BigQueryClient, getBigQueryUserAgent} from './client.js';
import {
  BigQueryToolConfig,
  validateBigQueryToolConfig,
} from './config.js';
import {BigQueryCredentialsConfig} from './credentials.js';
import {createMetadataTools} from './metadata_tools.js';
import {createExecuteSqlTool} from './query_tool.js';

/**
 * Options for creating a BigQueryToolset.
 */
export interface BigQueryToolsetOptions {
  /**
   * Filter to select which tools to expose.
   * Can be a list of tool names or a predicate function.
   */
  toolFilter?: ToolPredicate | string[];

  /**
   * Credentials configuration for BigQuery access.
   */
  credentialsConfig?: BigQueryCredentialsConfig;

  /**
   * Configuration for BigQuery tool behavior.
   */
  toolConfig?: BigQueryToolConfig;

  /**
   * Optional custom BigQuery client factory for testing.
   * If not provided, uses the real BigQuery SDK (lazily loaded).
   */
  clientFactory?: (
    credentialsConfig?: BigQueryCredentialsConfig,
    toolConfig?: BigQueryToolConfig,
  ) => Promise<BigQueryClient>;
}

/**
 * A toolset that provides access to BigQuery for data exploration and querying.
 *
 * The toolset includes tools for:
 * - Listing datasets and tables
 * - Getting dataset and table metadata
 * - Executing SQL queries (with configurable write mode)
 * - Getting job information
 *
 * @example
 * ```typescript
 * import {BigQueryToolset, WriteMode} from '@google/adk';
 *
 * // Create a read-only toolset
 * const toolset = new BigQueryToolset({
 *   toolConfig: {
 *     writeMode: WriteMode.BLOCKED,
 *     maxQueryResultRows: 100,
 *   },
 * });
 *
 * // Use with an agent
 * const agent = new LlmAgent({
 *   name: 'data-analyst',
 *   model: new Gemini({model: 'gemini-2.5-flash'}),
 *   tools: [toolset],
 * });
 * ```
 */
export class BigQueryToolset extends BaseToolset {
  private readonly credentialsConfig?: BigQueryCredentialsConfig;
  private readonly toolConfig: Required<
    Pick<BigQueryToolConfig, 'writeMode' | 'maxQueryResultRows'>
  > &
    BigQueryToolConfig;
  private readonly clientFactory?: (
    credentialsConfig?: BigQueryCredentialsConfig,
    toolConfig?: BigQueryToolConfig,
  ) => Promise<BigQueryClient>;

  private cachedClient?: BigQueryClient;
  private tools?: BaseTool[];

  constructor(options: BigQueryToolsetOptions = {}) {
    super(options.toolFilter ?? []);
    this.credentialsConfig = options.credentialsConfig;
    this.toolConfig = validateBigQueryToolConfig(options.toolConfig);
    this.clientFactory = options.clientFactory;
  }

  /**
   * Gets or creates the BigQuery client.
   */
  private async getClient(): Promise<BigQueryClient> {
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

    // Lazily import the BigQuery SDK client wrapper
    // This allows the SDK to be optionally installed
    const {createBigQueryClient} = await import('./bigquery_client_impl.js');
    this.cachedClient = await createBigQueryClient(
      this.credentialsConfig,
      this.toolConfig,
    );
    return this.cachedClient;
  }

  /**
   * Returns the tools exposed by this toolset.
   */
  override async getTools(context?: ReadonlyContext): Promise<BaseTool[]> {
    if (!this.tools) {
      const getClient = () => this.getClient();

      this.tools = [
        ...createMetadataTools(getClient),
        createExecuteSqlTool(getClient, this.toolConfig),
      ];
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
    // BigQuery client doesn't require explicit cleanup
    this.cachedClient = undefined;
    this.tools = undefined;
  }
}
