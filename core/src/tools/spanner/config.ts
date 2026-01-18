/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Capabilities that control what operations are allowed.
 */
export enum Capabilities {
  /**
   * Allow read-only data operations.
   */
  DATA_READ = 'DATA_READ',
}

/**
 * Result formatting mode for query results.
 */
export enum QueryResultMode {
  /**
   * Default mode: returns rows as arrays of values.
   */
  DEFAULT = 'DEFAULT',

  /**
   * Dictionary list mode: returns rows as objects with column names as keys.
   */
  DICT_LIST = 'DICT_LIST',
}

/**
 * Nearest neighbors algorithm for vector search.
 */
export type NearestNeighborsAlgorithm =
  | 'EXACT_NEAREST_NEIGHBORS'
  | 'APPROXIMATE_NEAREST_NEIGHBORS';

/**
 * Distance metric for vector similarity search.
 */
export type DistanceType = 'COSINE' | 'EUCLIDEAN' | 'DOT_PRODUCT';

/**
 * Represents a database column definition.
 */
export interface TableColumn {
  /**
   * Column name.
   */
  name: string;

  /**
   * Column type (GoogleSQL or PostgreSQL type).
   */
  type: string;

  /**
   * Whether the column allows NULL values.
   * @default true
   */
  isNullable?: boolean;
}

/**
 * Configuration for ANN (Approximate Nearest Neighbors) vector search indexes.
 */
export interface VectorSearchIndexSettings {
  /**
   * Name of the vector search index.
   */
  indexName: string;

  /**
   * Additional key columns for filtering before vector search.
   */
  additionalKeyColumns?: string[];

  /**
   * Additional storing columns for early filtering.
   */
  additionalStoringColumns?: string[];

  /**
   * Tree depth for the index structure (2 or 3).
   * @default 2
   */
  treeDepth?: number;

  /**
   * Number of leaf partitions.
   * @default 1000
   */
  numLeaves?: number;

  /**
   * Number of branches (required for 3-level trees).
   */
  numBranches?: number;
}

/**
 * Search options for vector similarity search.
 */
export interface SearchOptions {
  /**
   * Number of results to return.
   * @default 4
   */
  topK?: number;

  /**
   * Distance metric to use.
   * @default 'COSINE'
   */
  distanceType?: DistanceType;

  /**
   * Algorithm to use for nearest neighbors search.
   * @default 'EXACT_NEAREST_NEIGHBORS'
   */
  nearestNeighborsAlgorithm?: NearestNeighborsAlgorithm;

  /**
   * Number of leaves to search (for ANN only).
   */
  numLeavesToSearch?: number;
}

/**
 * Embedding options for vector search.
 * Exactly one of the embedding model options must be specified.
 */
export interface EmbeddingOptions {
  /**
   * Vertex AI public embedding model name.
   * Example: 'text-embedding-005'
   */
  vertexAiEmbeddingModelName?: string;

  /**
   * Spanner registered embedding model name (GoogleSQL ML.PREDICT).
   */
  spannerGooglesqlEmbeddingModelName?: string;

  /**
   * PostgreSQL Vertex AI embedding model endpoint (ML_PREDICT_ROW).
   */
  spannerPostgresqlVertexAiEmbeddingModelEndpoint?: string;

  /**
   * Output dimensionality for embeddings (for dimensionality reduction).
   */
  outputDimensionality?: number;
}

/**
 * Configuration for Spanner vector store.
 */
export interface SpannerVectorStoreSettings {
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
   * Table name for the vector store.
   */
  tableName: string;

  /**
   * Column name for the source text content.
   */
  contentColumn: string;

  /**
   * Column name for storing embeddings.
   */
  embeddingColumn: string;

  /**
   * Dimensionality of the embedding vectors.
   * Must be greater than 0.
   */
  vectorLength: number;

  /**
   * Vertex AI embedding model name.
   */
  vertexAiEmbeddingModelName: string;

  /**
   * Columns to return in search results.
   */
  selectedColumns?: string[];

  /**
   * Algorithm for nearest neighbors search.
   * @default 'EXACT_NEAREST_NEIGHBORS'
   */
  nearestNeighborsAlgorithm?: NearestNeighborsAlgorithm;

  /**
   * Number of results to return.
   * @default 4
   */
  topK?: number;

  /**
   * Distance metric for similarity search.
   * @default 'COSINE'
   */
  distanceType?: DistanceType;

  /**
   * Number of leaves to search (for ANN).
   */
  numLeavesToSearch?: number;

  /**
   * Additional WHERE clause filter for search.
   */
  additionalFilter?: string;

  /**
   * ANN vector search index configuration.
   */
  vectorSearchIndexSettings?: VectorSearchIndexSettings;

  /**
   * Additional columns to create in the table.
   */
  additionalColumnsToSetup?: TableColumn[];

  /**
   * Custom primary key columns. If not specified, 'id' with UUID is used.
   */
  primaryKeyColumns?: string[];
}

/**
 * Configuration for Spanner tools.
 */
export interface SpannerToolSettings {
  /**
   * Capabilities that control what operations are allowed.
   * @default [Capabilities.DATA_READ]
   */
  capabilities?: Capabilities[];

  /**
   * Maximum number of rows to return from executed queries.
   * @default 50
   */
  maxExecutedQueryResultRows?: number;

  /**
   * Result formatting mode for queries.
   * @default QueryResultMode.DEFAULT
   */
  queryResultMode?: QueryResultMode;

  /**
   * Vector store configuration (enables vector_store_similarity_search tool).
   */
  vectorStoreSettings?: SpannerVectorStoreSettings;
}

/**
 * Validates SpannerToolSettings and returns a normalized config with defaults.
 *
 * @param settings The settings to validate
 * @returns Validated and normalized settings
 * @throws Error if settings are invalid
 */
export function validateSpannerToolSettings(
  settings?: SpannerToolSettings,
): Required<Pick<SpannerToolSettings, 'capabilities' | 'maxExecutedQueryResultRows' | 'queryResultMode'>> &
  SpannerToolSettings {
  const normalized = {
    capabilities: settings?.capabilities ?? [Capabilities.DATA_READ],
    maxExecutedQueryResultRows: settings?.maxExecutedQueryResultRows ?? 50,
    queryResultMode: settings?.queryResultMode ?? QueryResultMode.DEFAULT,
    vectorStoreSettings: settings?.vectorStoreSettings,
  };

  // Validate vector store settings if provided
  if (normalized.vectorStoreSettings) {
    if (normalized.vectorStoreSettings.vectorLength <= 0) {
      throw new Error(
        `vectorLength must be greater than 0, got ${normalized.vectorStoreSettings.vectorLength}`,
      );
    }
  }

  return normalized;
}
