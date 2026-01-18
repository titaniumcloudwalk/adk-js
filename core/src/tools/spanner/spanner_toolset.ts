/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ReadonlyContext} from '../../agents/readonly_context.js';
import {BaseTool} from '../base_tool.js';
import {BaseToolset, ToolPredicate} from '../base_toolset.js';

import {SpannerClient} from './client.js';
import {
  Capabilities,
  SpannerToolSettings,
  validateSpannerToolSettings,
} from './config.js';
import {SpannerCredentialsConfig} from './credentials.js';
import {createMetadataTools} from './metadata_tools.js';
import {createExecuteSqlTool} from './query_tool.js';
import {
  createSimilaritySearchTool,
  createVectorStoreSimilaritySearchTool,
} from './search_tool.js';

/**
 * Options for creating a SpannerToolset.
 */
export interface SpannerToolsetOptions {
  /**
   * Google Cloud project ID.
   */
  projectId: string;

  /**
   * Spanner instance ID.
   */
  instanceId: string;

  /**
   * Spanner database ID.
   */
  databaseId: string;

  /**
   * Filter to select which tools to expose.
   * Can be a list of tool names or a predicate function.
   */
  toolFilter?: ToolPredicate | string[];

  /**
   * Credentials configuration for Spanner access.
   */
  credentialsConfig?: SpannerCredentialsConfig;

  /**
   * Configuration for Spanner tool behavior.
   */
  toolSettings?: SpannerToolSettings;

  /**
   * Optional custom Spanner client factory for testing.
   * If not provided, uses the real Spanner SDK (lazily loaded).
   */
  clientFactory?: (
    projectId: string,
    instanceId: string,
    databaseId: string,
    credentialsConfig?: SpannerCredentialsConfig,
    toolSettings?: SpannerToolSettings,
  ) => Promise<SpannerClient>;
}

/**
 * A toolset that provides access to Google Cloud Spanner for data exploration,
 * querying, and vector similarity search.
 *
 * The toolset includes tools for:
 * - **Metadata** - Listing tables, schemas, indexes, and getting detailed table schema
 * - **Querying** - Executing read-only SQL queries
 * - **Vector Search** - Similarity search using vector embeddings
 *
 * **Available Tools:**
 * 1. `spanner_list_table_names` - List all tables in the database
 * 2. `spanner_get_table_schema` - Get detailed schema for a table
 * 3. `spanner_list_table_indexes` - List indexes for a table
 * 4. `spanner_list_table_index_columns` - List columns in table indexes
 * 5. `spanner_list_named_schemas` - List named schemas in the database
 * 6. `spanner_execute_sql` - Execute read-only SQL queries (requires DATA_READ capability)
 * 7. `spanner_similarity_search` - Vector similarity search (requires DATA_READ capability)
 * 8. `spanner_vector_store_similarity_search` - Pre-configured vector search (requires DATA_READ and vector store settings)
 *
 * @example
 * ```typescript
 * import {SpannerToolset} from '@google/adk';
 *
 * // Create a basic toolset for metadata and queries
 * const toolset = new SpannerToolset({
 *   projectId: 'my-project',
 *   instanceId: 'my-instance',
 *   databaseId: 'my-database',
 * });
 *
 * // Create a toolset with vector search capabilities
 * const vectorToolset = new SpannerToolset({
 *   projectId: 'my-project',
 *   instanceId: 'my-instance',
 *   databaseId: 'my-database',
 *   toolSettings: {
 *     vectorStoreSettings: {
 *       projectId: 'my-project',
 *       instanceId: 'my-instance',
 *       databaseId: 'my-database',
 *       tableName: 'my_vectors',
 *       contentColumn: 'content',
 *       embeddingColumn: 'embedding',
 *       vectorLength: 768,
 *       vertexAiEmbeddingModelName: 'text-embedding-005',
 *     },
 *   },
 * });
 *
 * // Use specific tools
 * const limitedToolset = new SpannerToolset({
 *   projectId: 'my-project',
 *   instanceId: 'my-instance',
 *   databaseId: 'my-database',
 *   toolFilter: ['spanner_list_table_names', 'spanner_execute_sql'],
 * });
 * ```
 */
export class SpannerToolset extends BaseToolset {
  private readonly projectId: string;
  private readonly instanceId: string;
  private readonly databaseId: string;
  private readonly credentialsConfig?: SpannerCredentialsConfig;
  private readonly toolSettings: Required<
    Pick<SpannerToolSettings, 'capabilities' | 'maxExecutedQueryResultRows' | 'queryResultMode'>
  > &
    SpannerToolSettings;
  private readonly clientFactory?: (
    projectId: string,
    instanceId: string,
    databaseId: string,
    credentialsConfig?: SpannerCredentialsConfig,
    toolSettings?: SpannerToolSettings,
  ) => Promise<SpannerClient>;

  private cachedClient?: SpannerClient;
  private tools?: BaseTool[];

  constructor(options: SpannerToolsetOptions) {
    super(options.toolFilter ?? []);
    this.projectId = options.projectId;
    this.instanceId = options.instanceId;
    this.databaseId = options.databaseId;
    this.credentialsConfig = options.credentialsConfig;
    this.toolSettings = validateSpannerToolSettings(options.toolSettings);
    this.clientFactory = options.clientFactory;
  }

  /**
   * Gets or creates the Spanner client.
   */
  private async getClient(): Promise<SpannerClient> {
    if (this.cachedClient) {
      return this.cachedClient;
    }

    if (this.clientFactory) {
      this.cachedClient = await this.clientFactory(
        this.projectId,
        this.instanceId,
        this.databaseId,
        this.credentialsConfig,
        this.toolSettings,
      );
      return this.cachedClient;
    }

    // Lazily import the Spanner SDK client wrapper
    // This allows the SDK to be optionally installed
    const {createSpannerClient} = await import('./spanner_client_impl.js');
    this.cachedClient = await createSpannerClient(
      this.projectId,
      this.instanceId,
      this.databaseId,
      this.credentialsConfig,
      this.toolSettings,
    );
    return this.cachedClient;
  }

  /**
   * Checks if a specific capability is enabled.
   */
  private hasCapability(capability: Capabilities): boolean {
    return this.toolSettings.capabilities.includes(capability);
  }

  /**
   * Returns the tools exposed by this toolset.
   *
   * Returns up to 8 tools depending on capabilities and settings:
   * - 5 metadata tools (always available)
   * - 1 query tool (requires DATA_READ capability)
   * - 1 similarity search tool (requires DATA_READ capability)
   * - 1 vector store similarity search tool (requires DATA_READ and vector store settings)
   */
  override async getTools(context?: ReadonlyContext): Promise<BaseTool[]> {
    if (!this.tools) {
      const getClient = () => this.getClient();

      const tools: BaseTool[] = [
        // Metadata tools (always available)
        ...createMetadataTools(getClient),
      ];

      // Query and search tools (require DATA_READ capability)
      if (this.hasCapability(Capabilities.DATA_READ)) {
        // Execute SQL tool
        tools.push(createExecuteSqlTool(getClient, this.toolSettings));

        // Similarity search tool
        tools.push(createSimilaritySearchTool(getClient));

        // Vector store similarity search tool (if settings provided)
        if (this.toolSettings.vectorStoreSettings) {
          tools.push(
            createVectorStoreSimilaritySearchTool(
              getClient,
              this.toolSettings.vectorStoreSettings,
            ),
          );
        }
      }

      this.tools = tools;
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
    if (this.cachedClient) {
      await this.cachedClient.close();
    }
    this.cachedClient = undefined;
    this.tools = undefined;
  }
}
