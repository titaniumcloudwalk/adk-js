/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {version} from '../../version.js';

/**
 * Bigtable client interface - minimal interface for the operations we need.
 * This allows for easy mocking in tests and doesn't require the full Bigtable SDK.
 */
export interface BigtableClient {
  projectId: string;

  /**
   * List all instances in a project.
   */
  listInstances(): Promise<InstanceReference[]>;

  /**
   * Get detailed metadata about an instance.
   */
  getInstance(instanceId: string): Promise<InstanceMetadata>;

  /**
   * List all tables in an instance.
   */
  listTables(instanceId: string): Promise<TableReference[]>;

  /**
   * Get detailed metadata about a table.
   */
  getTable(instanceId: string, tableId: string): Promise<TableMetadata>;

  /**
   * Execute a GoogleSQL query against Bigtable.
   */
  executeQuery(
    instanceId: string,
    query: string,
    maxResults?: number,
  ): Promise<QueryResult>;
}

/**
 * Reference to a Bigtable instance.
 */
export interface InstanceReference {
  instanceId: string;
  projectId: string;
}

/**
 * Detailed metadata about a Bigtable instance.
 */
export interface InstanceMetadata {
  projectId: string;
  instanceId: string;
  displayName?: string;
  state?: string;
  type?: string;
  labels?: Record<string, string>;
}

/**
 * Reference to a Bigtable table.
 */
export interface TableReference {
  tableId: string;
  instanceId: string;
  projectId: string;
}

/**
 * Detailed metadata about a Bigtable table.
 */
export interface TableMetadata {
  projectId: string;
  instanceId: string;
  tableId: string;
  columnFamilies: string[];
}

/**
 * Result of a query execution.
 */
export interface QueryResult {
  rows: Record<string, unknown>[];
  resultIsLikelyTruncated?: boolean;
}

/**
 * User agent string for Bigtable requests.
 */
export function getBigtableUserAgent(applicationName?: string): string {
  const baseAgent = `adk-bigtable-tool google-adk/${version}`;
  if (applicationName) {
    return `${baseAgent} ${applicationName}`;
  }
  return baseAgent;
}
