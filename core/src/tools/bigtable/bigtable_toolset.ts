/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ReadonlyContext} from '../../agents/readonly_context.js';
import {BaseTool} from '../base_tool.js';
import {BaseToolset, ToolPredicate} from '../base_toolset.js';

import {BigtableClient} from './client.js';
import {BigtableCredentialsConfig} from './credentials.js';
import {createMetadataTools} from './metadata_tools.js';
import {createExecuteSqlTool} from './query_tool.js';
import {
  BigtableToolSettings,
  validateBigtableToolSettings,
} from './settings.js';

/**
 * Options for creating a BigtableToolset.
 */
export interface BigtableToolsetOptions {
  /**
   * Filter to select which tools to expose.
   * Can be a list of tool names or a predicate function.
   */
  toolFilter?: ToolPredicate | string[];

  /**
   * Credentials configuration for Bigtable access.
   */
  credentialsConfig?: BigtableCredentialsConfig;

  /**
   * Configuration for Bigtable tool behavior.
   */
  toolSettings?: BigtableToolSettings;

  /**
   * Optional custom Bigtable client factory for testing.
   * If not provided, uses the real Bigtable SDK (lazily loaded).
   */
  clientFactory?: (
    credentialsConfig?: BigtableCredentialsConfig,
    toolSettings?: BigtableToolSettings,
  ) => Promise<BigtableClient>;
}

/**
 * A toolset that provides access to Google Cloud Bigtable for metadata
 * inspection and SQL query execution.
 *
 * The toolset includes tools for:
 * - **Metadata** - Listing instances and tables, getting detailed metadata
 * - **Querying** - Executing GoogleSQL queries against Bigtable tables
 *
 * **Available Tools:**
 * 1. `list_instances` - List all Bigtable instance IDs in a project
 * 2. `get_instance_info` - Get detailed instance metadata
 * 3. `list_tables` - List all table IDs in an instance
 * 4. `get_table_info` - Get detailed table metadata with column families
 * 5. `execute_sql` - Execute GoogleSQL queries against tables
 *
 * @example
 * ```typescript
 * import {BigtableToolset} from '@google/adk';
 *
 * // Create a toolset with default settings
 * const toolset = new BigtableToolset();
 *
 * // Create a toolset with custom settings
 * const toolset = new BigtableToolset({
 *   toolSettings: {
 *     maxQueryResultRows: 100,
 *   },
 * });
 *
 * // Create a toolset with credentials
 * const toolset = new BigtableToolset({
 *   credentialsConfig: {
 *     projectId: 'my-project',
 *   },
 * });
 *
 * // Use with an agent
 * const agent = new LlmAgent({
 *   name: 'bigtable-analyst',
 *   model: new Gemini({model: 'gemini-2.5-flash'}),
 *   tools: [toolset],
 * });
 * ```
 *
 * @experimental This feature is experimental and may change in future versions.
 */
export class BigtableToolset extends BaseToolset {
  private readonly credentialsConfig?: BigtableCredentialsConfig;
  private readonly toolSettings: Required<BigtableToolSettings>;
  private readonly clientFactory?: (
    credentialsConfig?: BigtableCredentialsConfig,
    toolSettings?: BigtableToolSettings,
  ) => Promise<BigtableClient>;

  private cachedClient?: BigtableClient;
  private tools?: BaseTool[];

  constructor(options: BigtableToolsetOptions = {}) {
    super(options.toolFilter ?? []);
    this.credentialsConfig = options.credentialsConfig;
    this.toolSettings = validateBigtableToolSettings(options.toolSettings);
    this.clientFactory = options.clientFactory;
  }

  /**
   * Gets or creates the Bigtable client.
   */
  private async getClient(): Promise<BigtableClient> {
    if (this.cachedClient) {
      return this.cachedClient;
    }

    if (this.clientFactory) {
      this.cachedClient = await this.clientFactory(
        this.credentialsConfig,
        this.toolSettings,
      );
      return this.cachedClient;
    }

    // Lazily import the Bigtable SDK client wrapper
    // This allows the SDK to be optionally installed
    const {createBigtableClient} = await import('./bigtable_client_impl.js');
    this.cachedClient = await createBigtableClient(
      this.credentialsConfig,
      this.toolSettings,
    );
    return this.cachedClient;
  }

  /**
   * Returns the tools exposed by this toolset.
   *
   * Returns up to 5 tools:
   * - 4 metadata tools (list_instances, get_instance_info, list_tables, get_table_info)
   * - 1 query tool (execute_sql)
   */
  override async getTools(context?: ReadonlyContext): Promise<BaseTool[]> {
    if (!this.tools) {
      const getClient = () => this.getClient();

      this.tools = [
        // Metadata tools
        ...createMetadataTools(getClient),
        // Query tool
        createExecuteSqlTool(getClient, this.toolSettings),
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
    // Bigtable client doesn't require explicit cleanup
    this.cachedClient = undefined;
    this.tools = undefined;
  }
}
