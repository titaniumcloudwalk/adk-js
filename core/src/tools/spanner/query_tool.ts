/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration, Type} from '@google/genai';

import {BaseTool, RunAsyncToolRequest} from '../base_tool.js';

import {SpannerClient} from './client.js';
import {QueryResultMode, SpannerToolSettings} from './config.js';
import {SpannerToolResult} from './metadata_tools.js';

/**
 * Result structure for query execution.
 */
export interface QueryExecutionResult {
  rows: unknown[];
  result_is_likely_truncated: boolean;
}

/**
 * Gets the description for execute_sql based on the query result mode.
 */
function getExecuteSqlDescription(queryResultMode: QueryResultMode): string {
  const baseDescription =
    'Executes a read-only SQL query against the Spanner database and returns the results. ' +
    'The query must be a SELECT statement. Write operations are not allowed.';

  if (queryResultMode === QueryResultMode.DICT_LIST) {
    return (
      baseDescription +
      ' Results are returned as a list of dictionaries with column names as keys.'
    );
  }

  return (
    baseDescription +
    ' Results are returned as a list of row arrays.'
  );
}

/**
 * Tool for executing SQL queries against Spanner.
 */
class ExecuteSqlTool extends BaseTool {
  constructor(
    private readonly getClient: () => Promise<SpannerClient>,
    private readonly settings: Required<
      Pick<SpannerToolSettings, 'maxExecutedQueryResultRows' | 'queryResultMode'>
    > &
      SpannerToolSettings,
  ) {
    super({
      name: 'spanner_execute_sql',
      description: getExecuteSqlDescription(settings.queryResultMode),
    });
  }

  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description:
              'The SQL query to execute. Must be a valid SELECT statement.',
          },
        },
        required: ['query'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<SpannerToolResult<QueryExecutionResult>> {
    try {
      const client = await this.getClient();
      const args = request.args as {query: string};

      // Validate that the query is read-only
      const trimmedQuery = args.query.trim().toUpperCase();
      if (!trimmedQuery.startsWith('SELECT') && !trimmedQuery.startsWith('WITH')) {
        return {
          status: 'ERROR',
          error_details:
            'Only SELECT queries are allowed. Write operations (INSERT, UPDATE, DELETE, etc.) are not permitted.',
        };
      }

      const result = await client.executeQuery({
        query: args.query,
        maxResults: this.settings.maxExecutedQueryResultRows,
        resultMode: this.settings.queryResultMode,
      });

      return {
        status: 'SUCCESS',
        results: {
          rows: result.rows,
          result_is_likely_truncated: result.resultIsLikelyTruncated ?? false,
        },
      };
    } catch (error) {
      return {
        status: 'ERROR',
        error_details: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Creates the execute_sql tool with appropriate behavior for the settings.
 */
export function createExecuteSqlTool(
  getClient: () => Promise<SpannerClient>,
  settings: Required<Pick<SpannerToolSettings, 'maxExecutedQueryResultRows' | 'queryResultMode'>> &
    SpannerToolSettings,
): BaseTool {
  return new ExecuteSqlTool(getClient, settings);
}
