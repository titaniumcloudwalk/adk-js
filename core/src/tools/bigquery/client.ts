/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {version} from '../../version.js';

import {BigQueryCredentialsConfig, getBigQueryScopes} from './credentials.js';
import {BigQueryToolConfig} from './config.js';

/**
 * BigQuery client interface - minimal interface for the operations we need.
 * This allows for easy mocking in tests and doesn't require the full BigQuery SDK.
 */
export interface BigQueryClient {
  projectId: string;
  location?: string;

  /**
   * Execute a query and return results.
   */
  query(options: QueryOptions): Promise<QueryResult>;

  /**
   * Get dataset metadata.
   */
  getDataset(datasetId: string): Promise<DatasetMetadata>;

  /**
   * List datasets in a project.
   */
  listDatasets(projectId?: string): Promise<DatasetReference[]>;

  /**
   * Get table metadata.
   */
  getTable(
    datasetId: string,
    tableId: string,
  ): Promise<TableMetadata>;

  /**
   * List tables in a dataset.
   */
  listTables(datasetId: string): Promise<TableReference[]>;

  /**
   * Get job metadata.
   */
  getJob(jobId: string): Promise<JobMetadata>;

  /**
   * Perform a dry run query to estimate costs.
   */
  dryRunQuery(query: string): Promise<DryRunResult>;

  /**
   * Create a BigQuery session for PROTECTED write mode.
   */
  createSession(datasetId: string): Promise<SessionInfo>;
}

export interface QueryOptions {
  query: string;
  projectId?: string;
  location?: string;
  maximumBytesBilled?: number;
  jobLabels?: Record<string, string>;
  maxResults?: number;
  dryRun?: boolean;
  sessionId?: string;
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  totalRows?: number;
  schema?: TableSchema;
  jobReference?: JobReference;
}

export interface DryRunResult {
  totalBytesProcessed: number;
  statementType?: string;
}

export interface SessionInfo {
  sessionId: string;
  location: string;
}

export interface DatasetReference {
  datasetId: string;
  projectId: string;
}

export interface DatasetMetadata {
  datasetId: string;
  projectId: string;
  location?: string;
  description?: string;
  creationTime?: string;
  lastModifiedTime?: string;
  labels?: Record<string, string>;
}

export interface TableReference {
  tableId: string;
  datasetId: string;
  projectId: string;
}

export interface TableMetadata {
  tableId: string;
  datasetId: string;
  projectId: string;
  type?: string;
  description?: string;
  schema?: TableSchema;
  numRows?: string;
  numBytes?: string;
  creationTime?: string;
  lastModifiedTime?: string;
  labels?: Record<string, string>;
}

export interface TableSchema {
  fields: SchemaField[];
}

export interface SchemaField {
  name: string;
  type: string;
  mode?: string;
  description?: string;
  fields?: SchemaField[];
}

export interface JobReference {
  jobId: string;
  projectId: string;
  location?: string;
}

export interface JobMetadata {
  jobId: string;
  projectId: string;
  location?: string;
  status?: {
    state: string;
    errorResult?: {
      reason: string;
      message: string;
    };
  };
  statistics?: {
    startTime?: string;
    endTime?: string;
    totalBytesProcessed?: string;
    totalBytesBilled?: string;
  };
  configuration?: {
    query?: {
      query: string;
      destinationTable?: TableReference;
    };
  };
}

/**
 * User agent string for BigQuery requests.
 */
export function getBigQueryUserAgent(applicationName?: string): string {
  const baseAgent = `adk-bigquery-tool google-adk/${version}`;
  if (applicationName) {
    return `${baseAgent} ${applicationName}`;
  }
  return baseAgent;
}

/**
 * Creates a BigQuery client factory function.
 *
 * Note: The actual BigQuery client is created lazily when needed.
 * This allows the SDK to be optionally installed.
 *
 * @param credentialsConfig Credentials configuration
 * @param toolConfig Tool configuration
 * @returns Factory function that creates a BigQuery client
 */
export type BigQueryClientFactory = (
  credentialsConfig?: BigQueryCredentialsConfig,
  toolConfig?: BigQueryToolConfig,
) => Promise<BigQueryClient>;

/**
 * Key for storing BigQuery session info in tool context state.
 */
export const BIGQUERY_SESSION_INFO_KEY = 'temp:_adk_bigquery_session_info';
