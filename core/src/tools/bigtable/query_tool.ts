/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration, Type} from '@google/genai';

import {BaseTool, RunAsyncToolRequest} from '../base_tool.js';

import {BigtableClient} from './client.js';
import {BigtableToolSettings} from './settings.js';

/**
 * Query result type for SQL operations.
 */
interface QueryResultResponse {
  status: 'SUCCESS' | 'ERROR';
  rows?: Record<string, unknown>[];
  result_is_likely_truncated?: boolean;
  error_details?: string;
}

/**
 * Tool for executing GoogleSQL queries against Bigtable tables.
 */
class ExecuteSqlTool extends BaseTool {
  constructor(
    private readonly getClient: () => Promise<BigtableClient>,
    private readonly toolSettings: Required<BigtableToolSettings>,
  ) {
    super({
      name: 'execute_sql',
      description:
        'Execute a GoogleSQL query against a Bigtable table. ' +
        'Bigtable supports GoogleSQL for reading data from tables. ' +
        'Returns the query results as a list of row dictionaries. ' +
        `Results are limited to ${toolSettings.maxQueryResultRows} rows.`,
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
              'The Google Cloud project ID. If not provided, uses the default project.',
          },
          instance_id: {
            type: Type.STRING,
            description: 'The Bigtable instance ID to query.',
          },
          query: {
            type: Type.STRING,
            description:
              'The GoogleSQL query to execute against the Bigtable table. ' +
              'Bigtable supports a subset of GoogleSQL for querying data.',
          },
        },
        required: ['instance_id', 'query'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<QueryResultResponse> {
    try {
      const args = request.args as {
        project_id?: string;
        instance_id: string;
        query: string;
      };

      const client = await this.getClient();
      const result = await client.executeQuery(
        args.instance_id,
        args.query,
        this.toolSettings.maxQueryResultRows,
      );

      // Serialize rows to JSON-safe format
      const serializedRows = result.rows.map((row) => {
        const serialized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          // Handle non-JSON-serializable values
          if (value === undefined) {
            serialized[key] = null;
          } else if (typeof value === 'bigint') {
            serialized[key] = value.toString();
          } else if (Buffer.isBuffer(value)) {
            serialized[key] = value.toString('utf-8');
          } else {
            serialized[key] = value;
          }
        }
        return serialized;
      });

      return {
        status: 'SUCCESS',
        rows: serializedRows,
        result_is_likely_truncated: result.resultIsLikelyTruncated,
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
 * Creates the execute_sql tool for Bigtable.
 *
 * @param getClient Function to get the Bigtable client
 * @param toolSettings Tool settings for query limits
 * @returns The execute_sql tool
 */
export function createExecuteSqlTool(
  getClient: () => Promise<BigtableClient>,
  toolSettings: Required<BigtableToolSettings>,
): BaseTool {
  return new ExecuteSqlTool(getClient, toolSettings);
}
