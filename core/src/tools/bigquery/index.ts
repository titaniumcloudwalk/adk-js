/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BigQuery Toolset for ADK.
 *
 * Provides tools for interacting with Google BigQuery, including:
 * - Dataset and table metadata exploration
 * - SQL query execution with configurable write modes
 * - Job status monitoring
 *
 * @example
 * ```typescript
 * import {BigQueryToolset, WriteMode} from '@google/adk';
 *
 * // Create a toolset with read-only access
 * const toolset = new BigQueryToolset({
 *   toolConfig: {
 *     writeMode: WriteMode.BLOCKED,
 *     maxQueryResultRows: 100,
 *   },
 * });
 *
 * // Use specific tools
 * const toolset = new BigQueryToolset({
 *   toolFilter: ['list_dataset_ids', 'execute_sql'],
 * });
 * ```
 *
 * @packageDocumentation
 */

export {BigQueryToolset} from './bigquery_toolset.js';
export type {BigQueryToolsetOptions} from './bigquery_toolset.js';

export {
  BigQueryToolConfig,
  MINIMUM_BYTES_BILLED,
  validateBigQueryToolConfig,
  WriteMode,
} from './config.js';

export {
  BigQueryCredentialsConfig,
  DEFAULT_BIGQUERY_SCOPE,
  getBigQueryScopes,
} from './credentials.js';

export {
  BIGQUERY_SESSION_INFO_KEY,
  getBigQueryUserAgent,
} from './client.js';
export type {
  BigQueryClient,
  BigQueryClientFactory,
  DatasetMetadata,
  DatasetReference,
  DryRunResult,
  JobMetadata,
  JobReference,
  QueryOptions,
  QueryResult,
  SchemaField,
  SessionInfo,
  TableMetadata,
  TableReference,
  TableSchema,
} from './client.js';

export type {BigQueryToolResult} from './metadata_tools.js';
export type {QueryExecutionResult} from './query_tool.js';
