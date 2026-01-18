/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BigQuery Data Insights tool using Gemini Data Analytics API.
 *
 * Allows natural language queries against BigQuery tables with
 * automatic SQL generation and execution.
 */

import {FunctionDeclaration, Type} from '@google/genai';
import {GoogleAuth} from 'google-auth-library';

import {BaseTool, RunAsyncToolRequest} from '../base_tool.js';

import {BigQueryToolConfig} from './config.js';
import {BigQueryCredentialsConfig, getBigQueryScopes} from './credentials.js';
import {BigQueryToolResult} from './metadata_tools.js';

/**
 * Table reference for data insights queries.
 */
export interface TableReference {
  projectId: string;
  datasetId: string;
  tableId: string;
}

/**
 * Result structure for data insights.
 */
export interface DataInsightsResult {
  response: DataInsightsMessage[];
}

/**
 * Message types in data insights response.
 */
export type DataInsightsMessage =
  | {'SQL Generated': string}
  | {
      'Data Retrieved': {
        headers: string[];
        rows: unknown[][];
        summary: string;
      };
    }
  | {'Answer': string}
  | {'Error': string}
  | {'Schema': Record<string, unknown>};

/**
 * Internal response structure from Gemini Data Analytics API.
 */
interface GeminiDataAnalyticsResponse {
  textResponse?: {text?: string};
  schemaResponse?: {
    displayName?: string;
    summary?: string;
    schema?: {columns?: Array<{columnName?: string; columnType?: string}>};
  };
  dataResponse?: {
    dataSourceResponse?: {
      sql?: string;
      rows?: Array<{values?: Array<{stringValue?: string}>}>;
      columns?: Array<{columnName?: string}>;
      totalRowCount?: string;
    };
  };
  errorResponse?: {errorMessage?: string};
}

const GEMINI_DATA_ANALYTICS_API =
  'https://geminidataanalytics.googleapis.com/v1alpha/models/v1alpha:streamGenerateAnswer';

const SYSTEM_INSTRUCTION = `You are a data analyst assistant.
Provide clear, concise answers based on the data.
Format your responses as plain text only - do not include charts, visualizations, or markdown formatting.
Focus on the key insights from the data.`;

/**
 * Tool for natural language data queries using Gemini Data Analytics API.
 *
 * Allows users to ask questions about BigQuery data in natural language.
 * The tool generates SQL, executes it, and provides a natural language answer.
 */
class AskDataInsightsTool extends BaseTool {
  private auth?: GoogleAuth;

  constructor(
    private readonly credentialsConfig?: BigQueryCredentialsConfig,
    private readonly toolConfig?: BigQueryToolConfig,
  ) {
    super({
      name: 'ask_data_insights',
      description:
        'Answers natural language questions about BigQuery data using AI. ' +
        'Provide your question along with table references, and the tool will ' +
        'generate SQL, execute it, and provide a human-readable answer. ' +
        'Best for exploratory data analysis and quick insights.',
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
            description: 'The Google Cloud project ID.',
          },
          user_query: {
            type: Type.STRING,
            description:
              'Your question about the data in natural language. ' +
              'Be specific about what you want to know.',
          },
          table_references: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                projectId: {
                  type: Type.STRING,
                  description: 'The project ID containing the table.',
                },
                datasetId: {
                  type: Type.STRING,
                  description: 'The dataset ID containing the table.',
                },
                tableId: {
                  type: Type.STRING,
                  description: 'The table ID.',
                },
              },
              required: ['projectId', 'datasetId', 'tableId'],
            },
            description:
              'List of tables to query. Each table must include projectId, datasetId, and tableId.',
          },
        },
        required: ['user_query', 'table_references'],
      },
    };
  }

  /**
   * Gets an authenticated Google Auth instance.
   */
  private async getAuth(): Promise<GoogleAuth> {
    if (!this.auth) {
      this.auth = new GoogleAuth({
        scopes: getBigQueryScopes(this.credentialsConfig),
        projectId: this.credentialsConfig?.projectId,
      });
    }
    return this.auth;
  }

  /**
   * Gets an access token for API calls.
   */
  private async getAccessToken(): Promise<string> {
    const auth = await this.getAuth();
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    if (!tokenResponse.token) {
      throw new Error('Failed to get access token for Gemini Data Analytics API');
    }
    return tokenResponse.token;
  }

  /**
   * Formats a table reference for the API.
   */
  private formatTableReference(ref: TableReference): Record<string, unknown> {
    return {
      bigqueryTableSpec: {
        projectDatasetTable: `${ref.projectId}.${ref.datasetId}.${ref.tableId}`,
      },
    };
  }

  /**
   * Parses a streaming response line.
   */
  private parseResponseLine(line: string): GeminiDataAnalyticsResponse | null {
    if (!line.trim()) {
      return null;
    }

    // Handle SSE format
    if (line.startsWith('data: ')) {
      line = line.substring(6);
    }

    try {
      return JSON.parse(line) as GeminiDataAnalyticsResponse;
    } catch {
      return null;
    }
  }

  /**
   * Formats a text response message.
   */
  private formatTextResponse(text: string): DataInsightsMessage {
    return {'Answer': text};
  }

  /**
   * Formats a schema response message.
   */
  private formatSchemaResponse(
    schema: GeminiDataAnalyticsResponse['schemaResponse'],
  ): DataInsightsMessage {
    const columns: Record<string, string> = {};
    if (schema?.schema?.columns) {
      for (const col of schema.schema.columns) {
        if (col.columnName) {
          columns[col.columnName] = col.columnType ?? 'UNKNOWN';
        }
      }
    }
    return {
      Schema: {
        displayName: schema?.displayName ?? '',
        summary: schema?.summary ?? '',
        columns,
      },
    };
  }

  /**
   * Formats a data response message.
   */
  private formatDataResponse(
    data: GeminiDataAnalyticsResponse['dataResponse'],
    maxRows: number,
  ): DataInsightsMessage[] {
    const messages: DataInsightsMessage[] = [];
    const dataSourceResponse = data?.dataSourceResponse;

    if (dataSourceResponse?.sql) {
      messages.push({'SQL Generated': dataSourceResponse.sql});
    }

    if (dataSourceResponse?.rows || dataSourceResponse?.columns) {
      const headers =
        dataSourceResponse.columns?.map((c) => c.columnName ?? '') ?? [];
      const rows =
        dataSourceResponse.rows
          ?.slice(0, maxRows)
          .map((r) => r.values?.map((v) => v.stringValue ?? '') ?? []) ?? [];

      const totalRows = parseInt(dataSourceResponse.totalRowCount ?? '0', 10);
      const displayedRows = rows.length;

      messages.push({
        'Data Retrieved': {
          headers,
          rows,
          summary:
            displayedRows < totalRows
              ? `Showing ${displayedRows} of ${totalRows} rows.`
              : `Showing all ${displayedRows} rows.`,
        },
      });
    }

    return messages;
  }

  /**
   * Formats an error response message.
   */
  private formatErrorResponse(error: string): DataInsightsMessage {
    return {'Error': error};
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<BigQueryToolResult<DataInsightsResult>> {
    try {
      const args = request.args as {
        project_id?: string;
        user_query: string;
        table_references: TableReference[];
      };

      if (!args.table_references || args.table_references.length === 0) {
        return {
          status: 'ERROR',
          error_details: 'At least one table reference is required.',
        };
      }

      const accessToken = await this.getAccessToken();
      const projectId =
        args.project_id ??
        this.toolConfig?.computeProjectId ??
        this.credentialsConfig?.projectId;

      if (!projectId) {
        return {
          status: 'ERROR',
          error_details:
            'Project ID is required. Provide it in the request, tool config, or credentials config.',
        };
      }

      // Build the request body
      const requestBody = {
        datasources: args.table_references.map((ref) =>
          this.formatTableReference(ref),
        ),
        question: args.user_query,
        systemInstruction: SYSTEM_INSTRUCTION,
        generationConfig: {
          temperature: 0.2,
        },
      };

      // Make the streaming API request
      const response = await fetch(GEMINI_DATA_ANALYTICS_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'x-goog-user-project': projectId,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          status: 'ERROR',
          error_details: `Gemini Data Analytics API error (${response.status}): ${errorText}`,
        };
      }

      // Process the streaming response
      const messages: DataInsightsMessage[] = [];
      const maxRows = this.toolConfig?.maxQueryResultRows ?? 50;

      const responseText = await response.text();
      const lines = responseText.split('\n');

      for (const line of lines) {
        const parsed = this.parseResponseLine(line);
        if (!parsed) continue;

        if (parsed.textResponse?.text) {
          messages.push(this.formatTextResponse(parsed.textResponse.text));
        }

        if (parsed.schemaResponse) {
          messages.push(this.formatSchemaResponse(parsed.schemaResponse));
        }

        if (parsed.dataResponse) {
          messages.push(...this.formatDataResponse(parsed.dataResponse, maxRows));
        }

        if (parsed.errorResponse?.errorMessage) {
          messages.push(
            this.formatErrorResponse(parsed.errorResponse.errorMessage),
          );
        }
      }

      return {
        status: 'SUCCESS',
        data: {response: messages},
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
 * Creates the ask_data_insights tool.
 */
export function createDataInsightsTool(
  credentialsConfig?: BigQueryCredentialsConfig,
  toolConfig?: BigQueryToolConfig,
): BaseTool {
  return new AskDataInsightsTool(credentialsConfig, toolConfig);
}
