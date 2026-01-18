/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {version} from '../../version.js';

import {SpannerCredentialsConfig} from './credentials.js';
import {QueryResultMode, SpannerToolSettings} from './config.js';

/**
 * Spanner client interface - minimal interface for the operations we need.
 * This allows for easy mocking in tests and doesn't require the full Spanner SDK.
 */
export interface SpannerClient {
  projectId: string;
  instanceId: string;
  databaseId: string;

  /**
   * Execute a read-only SQL query and return results.
   */
  executeQuery(options: QueryOptions): Promise<QueryResult>;

  /**
   * Close the client and release resources.
   */
  close(): Promise<void>;
}

/**
 * Options for executing a query.
 */
export interface QueryOptions {
  /**
   * The SQL query to execute.
   */
  query: string;

  /**
   * Query parameters for parameterized queries.
   */
  params?: Record<string, unknown>;

  /**
   * Parameter types for the query parameters.
   */
  types?: Record<string, string>;

  /**
   * Maximum number of rows to return.
   */
  maxResults?: number;

  /**
   * Result formatting mode.
   */
  resultMode?: QueryResultMode;
}

/**
 * Result of a query execution.
 */
export interface QueryResult {
  /**
   * Query results as rows.
   * Format depends on resultMode:
   * - DEFAULT: Array of arrays [[val1, val2], ...]
   * - DICT_LIST: Array of objects [{col1: val1, col2: val2}, ...]
   */
  rows: unknown[];

  /**
   * Column metadata from the result.
   */
  metadata?: ColumnMetadata[];

  /**
   * Whether the result was truncated due to maxResults.
   */
  resultIsLikelyTruncated?: boolean;
}

/**
 * Column metadata from a query result.
 */
export interface ColumnMetadata {
  /**
   * Column name.
   */
  name: string;

  /**
   * Column type.
   */
  type: string;
}

/**
 * Table schema information.
 */
export interface TableSchemaInfo {
  /**
   * Column definitions.
   */
  columns: ColumnSchemaInfo[];

  /**
   * Key column information.
   */
  keyColumns?: KeyColumnInfo[];

  /**
   * Table metadata.
   */
  tableMetadata?: TableMetadataInfo;
}

/**
 * Column schema information.
 */
export interface ColumnSchemaInfo {
  /**
   * Column name.
   */
  name: string;

  /**
   * Column type.
   */
  type: string;

  /**
   * Ordinal position (1-indexed).
   */
  ordinalPosition: number;

  /**
   * Whether the column allows NULL values.
   */
  isNullable: boolean;

  /**
   * Default value expression.
   */
  columnDefault?: string;

  /**
   * Generation expression for computed columns.
   */
  generationExpression?: string;
}

/**
 * Key column information.
 */
export interface KeyColumnInfo {
  /**
   * Column name.
   */
  columnName: string;

  /**
   * Constraint name.
   */
  constraintName: string;

  /**
   * Position in the key.
   */
  ordinalPosition: number;
}

/**
 * Table metadata information.
 */
export interface TableMetadataInfo {
  /**
   * Table type (e.g., 'BASE TABLE', 'VIEW').
   */
  tableType?: string;

  /**
   * Parent table name for interleaved tables.
   */
  parentTableName?: string;

  /**
   * On delete action for interleaved tables.
   */
  onDeleteAction?: string;

  /**
   * Interleave type.
   */
  interleaveType?: string;
}

/**
 * Index information.
 */
export interface IndexInfo {
  /**
   * Index name.
   */
  indexName: string;

  /**
   * Index type.
   */
  indexType: string;

  /**
   * Parent table name.
   */
  parentTableName?: string;

  /**
   * Whether the index is unique.
   */
  isUnique: boolean;

  /**
   * Whether NULLs are filtered.
   */
  isNullFiltered: boolean;

  /**
   * Index state.
   */
  indexState: string;
}

/**
 * Index column information.
 */
export interface IndexColumnInfo {
  /**
   * Index name.
   */
  indexName: string;

  /**
   * Column name.
   */
  columnName: string;

  /**
   * Column ordering (ASC or DESC).
   */
  columnOrdering?: string;

  /**
   * Whether the column is nullable.
   */
  isNullable: boolean;

  /**
   * Spanner type.
   */
  spannerType: string;

  /**
   * Ordinal position.
   */
  ordinalPosition: number;
}

/**
 * Named schema information.
 */
export interface NamedSchemaInfo {
  /**
   * Schema name.
   */
  schemaName: string;
}

/**
 * User agent string for Spanner requests.
 */
export function getSpannerUserAgent(applicationName?: string): string {
  const baseAgent = `adk-spanner-tool google-adk/${version}`;
  if (applicationName) {
    return `${baseAgent} ${applicationName}`;
  }
  return baseAgent;
}

/**
 * Factory function type for creating Spanner clients.
 */
export type SpannerClientFactory = (
  projectId: string,
  instanceId: string,
  databaseId: string,
  credentialsConfig?: SpannerCredentialsConfig,
  toolSettings?: SpannerToolSettings,
) => Promise<SpannerClient>;
