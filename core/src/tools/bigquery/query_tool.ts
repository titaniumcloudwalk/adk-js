/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration, Type} from '@google/genai';

import {BaseTool, RunAsyncToolRequest} from '../base_tool.js';
import {ToolContext} from '../tool_context.js';

import {
  BigQueryClient,
  BIGQUERY_SESSION_INFO_KEY,
  SessionInfo,
} from './client.js';
import {BigQueryToolConfig, WriteMode} from './config.js';
import {BigQueryToolResult} from './metadata_tools.js';

/**
 * Result structure for query execution.
 */
export interface QueryExecutionResult {
  rows: Record<string, unknown>[];
  result_is_likely_truncated: boolean;
  total_rows?: number;
}

/**
 * Checks if a query is read-only (SELECT or WITH).
 */
function isReadOnlyQuery(query: string): boolean {
  const trimmed = query.trim().toUpperCase();
  return trimmed.startsWith('SELECT') || trimmed.startsWith('WITH');
}

/**
 * Gets the description for execute_sql based on write mode.
 */
function getExecuteSqlDescription(writeMode: WriteMode): string {
  const baseDescription =
    'Executes a SQL query against BigQuery and returns the results. ' +
    'The query should be valid GoogleSQL (BigQuery SQL dialect).';

  switch (writeMode) {
    case WriteMode.BLOCKED:
      return (
        baseDescription +
        ' NOTE: Only SELECT queries are allowed. ' +
        'Write operations (INSERT, UPDATE, DELETE, CREATE, etc.) will be rejected.'
      );
    case WriteMode.PROTECTED:
      return (
        baseDescription +
        ' NOTE: Write operations are limited to temporary tables and models ' +
        'within the BigQuery session. Writes to permanent tables are not allowed.'
      );
    case WriteMode.ALLOWED:
      return (
        baseDescription +
        ' Both read and write operations are allowed.'
      );
  }
}

/**
 * Tool for executing SQL queries against BigQuery.
 */
class ExecuteSqlTool extends BaseTool {
  constructor(
    private readonly getClient: () => Promise<BigQueryClient>,
    private readonly config: Required<
      Pick<BigQueryToolConfig, 'writeMode' | 'maxQueryResultRows'>
    > &
      BigQueryToolConfig,
  ) {
    super({
      name: 'execute_sql',
      description: getExecuteSqlDescription(config.writeMode),
    });
  }

  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          project_id: {
            type: Type.STRING,
            description:
              'The Google Cloud project ID to run the query in. ' +
              'If not provided, uses the default project.',
          },
          query: {
            type: Type.STRING,
            description:
              'The SQL query to execute. Must be valid GoogleSQL syntax.',
          },
          dry_run: {
            type: Type.BOOLEAN,
            description:
              'If true, performs a dry run to estimate query costs ' +
              'without actually executing the query.',
          },
        },
        required: ['query'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<
    BigQueryToolResult<QueryExecutionResult | {bytes_processed: number}>
  > {
    try {
      const client = await this.getClient();
      const args = request.args as {
        project_id?: string;
        query: string;
        dry_run?: boolean;
      };

      // Handle dry run
      if (args.dry_run) {
        const dryRunResult = await client.dryRunQuery(args.query);
        return {
          status: 'SUCCESS',
          data: {
            bytes_processed: dryRunResult.totalBytesProcessed,
          },
        };
      }

      // Write mode validation
      if (this.config.writeMode === WriteMode.BLOCKED) {
        if (!isReadOnlyQuery(args.query)) {
          return {
            status: 'ERROR',
            error_details:
              'Write operations are not allowed in BLOCKED mode. ' +
              'Only SELECT queries are permitted.',
          };
        }
      }

      // Get or create session for PROTECTED mode
      let sessionId: string | undefined;
      const toolContext = request.toolContext as ToolContext | undefined;
      if (this.config.writeMode === WriteMode.PROTECTED && toolContext) {
        const sessionInfo = toolContext.state.get(
          BIGQUERY_SESSION_INFO_KEY,
        ) as SessionInfo | undefined;

        if (sessionInfo) {
          sessionId = sessionInfo.sessionId;
        } else if (!isReadOnlyQuery(args.query)) {
          // Need to create a session for write operations
          // Extract dataset from query if possible (simplified approach)
          const datasetMatch = args.query.match(
            /(?:CREATE\s+(?:TEMP|TEMPORARY)\s+(?:TABLE|MODEL)\s+)?\`?(\w+)\.\w+\`?/i,
          );
          if (datasetMatch) {
            const newSession = await client.createSession(datasetMatch[1]);
            toolContext.state.set(BIGQUERY_SESSION_INFO_KEY, newSession);
            sessionId = newSession.sessionId;
          }
        }
      }

      // Execute the query
      const result = await client.query({
        query: args.query,
        projectId: args.project_id ?? this.config.computeProjectId,
        location: this.config.location,
        maximumBytesBilled: this.config.maximumBytesBilled,
        jobLabels: this.config.jobLabels,
        maxResults: this.config.maxQueryResultRows,
        sessionId,
      });

      const totalRows = result.totalRows
        ? parseInt(String(result.totalRows), 10)
        : result.rows.length;

      return {
        status: 'SUCCESS',
        data: {
          rows: result.rows,
          result_is_likely_truncated: totalRows > result.rows.length,
          total_rows: totalRows,
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
 * Creates the execute_sql tool with appropriate behavior for the write mode.
 */
export function createExecuteSqlTool(
  getClient: () => Promise<BigQueryClient>,
  config: Required<Pick<BigQueryToolConfig, 'writeMode' | 'maxQueryResultRows'>> &
    BigQueryToolConfig,
): BaseTool {
  return new ExecuteSqlTool(getClient, config);
}
