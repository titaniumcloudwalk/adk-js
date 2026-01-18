/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Spanner client implementation using the @google-cloud/spanner SDK.
 *
 * This file is lazily imported to avoid requiring the SDK unless needed.
 */

import {
  SpannerClient,
  QueryOptions,
  QueryResult,
  getSpannerUserAgent,
} from './client.js';
import {SpannerCredentialsConfig} from './credentials.js';
import {QueryResultMode, SpannerToolSettings} from './config.js';

// Type definitions for @google-cloud/spanner (peer dependency)
// These are minimal definitions to avoid requiring the actual types
interface SpannerRow {
  toJSON?: () => Record<string, unknown>;
  [key: string]: unknown;
}

interface SpannerDatabase {
  run(query: {
    sql: string;
    params?: Record<string, unknown>;
    types?: Record<string, string>;
    json?: boolean;
  }): Promise<[SpannerRow[]]>;
  close(): Promise<void>;
}

interface SpannerInstance {
  database(databaseId: string): SpannerDatabase;
}

interface SpannerInstanceManager {
  instance(instanceId: string): SpannerInstance;
  close(): void;
}

interface SpannerOptions {
  projectId?: string;
  userAgent?: string;
}

interface SpannerModule {
  Spanner: new (options?: SpannerOptions) => SpannerInstanceManager;
}

/**
 * Creates a Spanner client using the @google-cloud/spanner SDK.
 *
 * @param projectId Google Cloud project ID
 * @param instanceId Spanner instance ID
 * @param databaseId Spanner database ID
 * @param credentialsConfig Optional credentials configuration
 * @param toolSettings Optional tool settings
 * @returns A SpannerClient instance
 */
export async function createSpannerClient(
  projectId: string,
  instanceId: string,
  databaseId: string,
  credentialsConfig?: SpannerCredentialsConfig,
  toolSettings?: SpannerToolSettings,
): Promise<SpannerClient> {
  let spannerModule: SpannerModule;

  try {
    // Dynamic import to make the SDK an optional dependency
    spannerModule = await import(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Spanner is an optional peer dependency
      '@google-cloud/spanner'
    ) as unknown as SpannerModule;
  } catch (error) {
    throw new Error(
      'SpannerToolset requires @google-cloud/spanner to be installed. ' +
        'Please run: npm install @google-cloud/spanner',
    );
  }

  const {Spanner} = spannerModule;

  const spanner = new Spanner({
    projectId: credentialsConfig?.projectId ?? projectId,
    userAgent: getSpannerUserAgent(),
  });

  const instance = spanner.instance(instanceId);
  const database = instance.database(databaseId);

  const defaultQueryResultMode =
    toolSettings?.queryResultMode ?? QueryResultMode.DEFAULT;
  const defaultMaxResults = toolSettings?.maxExecutedQueryResultRows ?? 50;

  return {
    projectId,
    instanceId,
    databaseId,

    async executeQuery(options: QueryOptions): Promise<QueryResult> {
      const maxResults = options.maxResults ?? defaultMaxResults;
      const resultMode = options.resultMode ?? defaultQueryResultMode;

      // Build query parameters if provided
      const queryParams: Record<string, unknown> = {};
      if (options.params) {
        for (const [key, value] of Object.entries(options.params)) {
          queryParams[key] = value;
        }
      }

      // Execute with read-only transaction
      const [rows] = await database.run({
        sql: options.query,
        params: options.params ? queryParams : undefined,
        types: options.types as Record<string, string> | undefined,
        json: resultMode === QueryResultMode.DICT_LIST,
      });

      // Get metadata from first row if available
      let metadata;
      if (rows.length > 0 && resultMode === QueryResultMode.DEFAULT) {
        // For default mode, rows are arrays with metadata
        const firstRow = rows[0];
        if (firstRow && typeof firstRow === 'object' && 'toJSON' in firstRow) {
          const jsonRow = (firstRow as {toJSON: () => Record<string, unknown>}).toJSON();
          metadata = Object.keys(jsonRow).map((name) => ({
            name,
            type: 'unknown', // Spanner SDK doesn't expose type info easily
          }));
        }
      }

      // Determine if result is truncated
      const resultIsLikelyTruncated = rows.length > maxResults;

      // Limit results
      const limitedRows = rows.slice(0, maxResults);

      // Convert rows based on result mode
      let formattedRows: unknown[];
      if (resultMode === QueryResultMode.DICT_LIST) {
        // Already in JSON format
        formattedRows = limitedRows.map((row: SpannerRow) => {
          if (row && typeof row === 'object' && 'toJSON' in row && row.toJSON) {
            return row.toJSON();
          }
          return row;
        });
      } else {
        // Convert to arrays
        formattedRows = limitedRows.map((row: SpannerRow) => {
          if (row && typeof row === 'object' && 'toJSON' in row && row.toJSON) {
            return Object.values(row.toJSON());
          }
          if (Array.isArray(row)) {
            return row;
          }
          return [row];
        });
      }

      return {
        rows: formattedRows,
        metadata,
        resultIsLikelyTruncated,
      };
    },

    async close(): Promise<void> {
      await database.close();
      spanner.close();
    },
  };
}
