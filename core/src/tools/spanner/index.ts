/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Spanner Toolset for ADK.
 *
 * Provides tools for interacting with Google Cloud Spanner, including:
 * - Table and schema metadata exploration
 * - Read-only SQL query execution
 * - Vector similarity search with multiple embedding model options
 *
 * @example
 * ```typescript
 * import {SpannerToolset, Capabilities} from '@google/adk';
 *
 * // Create a toolset for metadata and queries
 * const toolset = new SpannerToolset({
 *   projectId: 'my-project',
 *   instanceId: 'my-instance',
 *   databaseId: 'my-database',
 *   toolSettings: {
 *     capabilities: [Capabilities.DATA_READ],
 *     maxExecutedQueryResultRows: 100,
 *   },
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
 *       tableName: 'embeddings',
 *       contentColumn: 'content',
 *       embeddingColumn: 'embedding',
 *       vectorLength: 768,
 *       vertexAiEmbeddingModelName: 'text-embedding-005',
 *     },
 *   },
 * });
 *
 * // Use specific tools only
 * const limitedToolset = new SpannerToolset({
 *   projectId: 'my-project',
 *   instanceId: 'my-instance',
 *   databaseId: 'my-database',
 *   toolFilter: ['spanner_list_table_names', 'spanner_execute_sql'],
 * });
 * ```
 *
 * @packageDocumentation
 */

export {SpannerToolset} from './spanner_toolset.js';
export type {SpannerToolsetOptions} from './spanner_toolset.js';

export {
  Capabilities,
  DistanceType,
  NearestNeighborsAlgorithm,
  QueryResultMode,
  SpannerToolSettings,
  SpannerVectorStoreSettings,
  TableColumn,
  VectorSearchIndexSettings,
  SearchOptions,
  EmbeddingOptions,
  validateSpannerToolSettings,
} from './config.js';

export {
  DEFAULT_SPANNER_ADMIN_SCOPE,
  DEFAULT_SPANNER_DATA_SCOPE,
  DEFAULT_SPANNER_SCOPES,
  getSpannerScopes,
  SPANNER_TOKEN_CACHE_KEY,
  SpannerCredentialsConfig,
} from './credentials.js';

export {getSpannerUserAgent} from './client.js';
export type {
  ColumnMetadata,
  ColumnSchemaInfo,
  IndexColumnInfo,
  IndexInfo,
  KeyColumnInfo,
  NamedSchemaInfo,
  QueryOptions,
  QueryResult,
  SpannerClient,
  SpannerClientFactory,
  TableMetadataInfo,
  TableSchemaInfo,
} from './client.js';

export type {SpannerToolResult} from './metadata_tools.js';
export type {QueryExecutionResult} from './query_tool.js';
export type {SimilaritySearchResult} from './search_tool.js';
