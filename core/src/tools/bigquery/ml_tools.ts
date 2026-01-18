/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BigQuery ML tools for advanced analytics.
 *
 * These tools provide access to BigQuery ML capabilities including:
 * - Time series forecasting with TimesFM 2.0
 * - Contribution analysis
 * - Anomaly detection with ARIMA_PLUS
 */

import {FunctionDeclaration, Type} from '@google/genai';
import {randomUUID} from 'crypto';

import {BaseTool, RunAsyncToolRequest} from '../base_tool.js';
import {ToolContext} from '../tool_context.js';

import {BigQueryClient, BIGQUERY_SESSION_INFO_KEY, SessionInfo} from './client.js';
import {BigQueryToolConfig, WriteMode} from './config.js';
import {BigQueryToolResult} from './metadata_tools.js';

/**
 * Result structure for forecast operations.
 */
export interface ForecastResult {
  forecast_timestamp: string;
  forecast_value: number;
  confidence_level: number;
  prediction_interval_lower_bound: number;
  prediction_interval_upper_bound: number;
  ai_forecast_status: string;
}

/**
 * Result structure for contribution analysis.
 */
export interface ContributionResult {
  contributors: string[];
  metric_test: number;
  metric_control: number;
  difference: number;
  relative_difference: number;
  unexpected_difference: number;
  relative_unexpected_difference: number;
  apriori_support: number;
  [key: string]: unknown; // Additional dimension columns
}

/**
 * Result structure for anomaly detection.
 */
export interface AnomalyResult {
  ts_timestamp: string;
  ts_data: number;
  is_anomaly: boolean;
  lower_bound: number;
  upper_bound: number;
  anomaly_probability: number;
  unique_id?: string;
}

/**
 * Checks if a string is a table reference (not a SELECT/WITH query).
 */
function isTableReference(input: string): boolean {
  const trimmed = input.trim().toUpperCase();
  return !trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH');
}

/**
 * Wraps input as a table or subquery for ML functions.
 */
function wrapAsTableOrQuery(input: string): string {
  if (isTableReference(input)) {
    // It's a table ID like 'project.dataset.table' or 'dataset.table'
    return `\`${input.replace(/`/g, '')}\``;
  }
  // It's a query, wrap in parentheses
  return `(${input})`;
}

/**
 * Validates that all items in an array are strings.
 */
function validateStringArray(arr: unknown[], paramName: string): void {
  for (const item of arr) {
    if (typeof item !== 'string') {
      throw new Error(`All items in ${paramName} must be strings, got ${typeof item}`);
    }
  }
}

/**
 * Gets or creates a BigQuery session for ML operations in PROTECTED mode.
 */
async function getOrCreateSession(
  client: BigQueryClient,
  toolContext: ToolContext | undefined,
  datasetId: string,
): Promise<string | undefined> {
  if (!toolContext) {
    return undefined;
  }

  const existingSession = toolContext.state.get(BIGQUERY_SESSION_INFO_KEY) as
    | SessionInfo
    | undefined;

  if (existingSession) {
    return existingSession.sessionId;
  }

  const newSession = await client.createSession(datasetId);
  toolContext.state.set(BIGQUERY_SESSION_INFO_KEY, newSession);
  return newSession.sessionId;
}

/**
 * Tool for time series forecasting using BigQuery ML.
 *
 * Uses AI.FORECAST() with the TimesFM 2.0 model to generate predictions
 * for time series data.
 */
class ForecastTool extends BaseTool {
  constructor(
    private readonly getClient: () => Promise<BigQueryClient>,
    private readonly config: Required<
      Pick<BigQueryToolConfig, 'writeMode' | 'maxQueryResultRows'>
    > &
      BigQueryToolConfig,
  ) {
    super({
      name: 'forecast',
      description:
        'Performs time series forecasting using BigQuery ML with the TimesFM 2.0 model. ' +
        'Returns predicted values with confidence intervals for future time points. ' +
        'Supports both single and multiple time series (specify id_cols for multi-series).',
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
          history_data: {
            type: Type.STRING,
            description:
              'The historical time series data. Can be a table ID (e.g., "dataset.table") ' +
              'or a SELECT query returning the time series data.',
          },
          timestamp_col: {
            type: Type.STRING,
            description: 'The name of the timestamp column in the data.',
          },
          data_col: {
            type: Type.STRING,
            description: 'The name of the numeric data column to forecast.',
          },
          horizon: {
            type: Type.INTEGER,
            description: 'Number of future time points to forecast. Default is 10.',
          },
          id_cols: {
            type: Type.ARRAY,
            items: {type: Type.STRING},
            description:
              'Column names that identify individual time series (for multi-series forecasting). ' +
              'Optional - omit for single time series.',
          },
        },
        required: ['history_data', 'timestamp_col', 'data_col'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<BigQueryToolResult<ForecastResult[]>> {
    try {
      const client = await this.getClient();
      const args = request.args as {
        project_id?: string;
        history_data: string;
        timestamp_col: string;
        data_col: string;
        horizon?: number;
        id_cols?: string[];
      };

      const horizon = args.horizon ?? 10;
      const idCols = args.id_cols ?? [];

      // Validate id_cols
      if (idCols.length > 0) {
        validateStringArray(idCols, 'id_cols');
      }

      // Build the forecast query
      const dataSource = wrapAsTableOrQuery(args.history_data);
      const idColsClause = idCols.length > 0 ? `, [${idCols.map(c => `'${c}'`).join(', ')}]` : '';

      const query = `
        SELECT *
        FROM AI.FORECAST(
          MODEL \`google_cloud_ai.timesfm_2_0\`,
          ${dataSource},
          STRUCT(
            '${args.timestamp_col}' AS time_col,
            '${args.data_col}' AS data_col,
            ${horizon} AS horizon,
            0.95 AS confidence_level
            ${idColsClause ? `, ${idColsClause.substring(2)} AS id_cols` : ''}
          )
        )
      `.trim();

      const result = await client.query({
        query,
        projectId: args.project_id ?? this.config.computeProjectId,
        location: this.config.location,
        maximumBytesBilled: this.config.maximumBytesBilled,
        jobLabels: this.config.jobLabels,
        maxResults: this.config.maxQueryResultRows,
      });

      const forecasts = result.rows.map((row) => ({
        forecast_timestamp: String(row.forecast_timestamp ?? ''),
        forecast_value: Number(row.forecast_value ?? 0),
        confidence_level: Number(row.confidence_level ?? 0.95),
        prediction_interval_lower_bound: Number(row.prediction_interval_lower_bound ?? 0),
        prediction_interval_upper_bound: Number(row.prediction_interval_upper_bound ?? 0),
        ai_forecast_status: String(row.ai_forecast_status ?? ''),
      }));

      return {
        status: 'SUCCESS',
        data: forecasts,
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
 * Valid pruning methods for contribution analysis.
 */
const VALID_PRUNING_METHODS = ['NO_PRUNING', 'PRUNE_REDUNDANT_INSIGHTS'] as const;
type PruningMethod = (typeof VALID_PRUNING_METHODS)[number];

/**
 * Tool for contribution analysis using BigQuery ML.
 *
 * Uses ML.CREATE_MODEL with CONTRIBUTION_ANALYSIS and ML.GET_INSIGHTS
 * to identify key contributors to metric changes.
 */
class AnalyzeContributionTool extends BaseTool {
  constructor(
    private readonly getClient: () => Promise<BigQueryClient>,
    private readonly config: Required<
      Pick<BigQueryToolConfig, 'writeMode' | 'maxQueryResultRows'>
    > &
      BigQueryToolConfig,
  ) {
    super({
      name: 'analyze_contribution',
      description:
        'Analyzes the contribution of different dimensions to changes in a metric. ' +
        'Uses BigQuery ML CONTRIBUTION_ANALYSIS to identify key factors driving metric differences ' +
        'between test and control groups. Requires PROTECTED or ALLOWED write mode.',
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
          input_data: {
            type: Type.STRING,
            description:
              'The input data. Can be a table ID or a SELECT query containing ' +
              'the metric, dimension columns, and a boolean test/control indicator.',
          },
          contribution_metric: {
            type: Type.STRING,
            description:
              'The aggregation expression for the metric to analyze (e.g., "SUM(sales)").',
          },
          dimension_id_cols: {
            type: Type.ARRAY,
            items: {type: Type.STRING},
            description: 'Column names representing dimensions to analyze for contribution.',
          },
          is_test_col: {
            type: Type.STRING,
            description:
              'Column name containing a boolean indicating test (true) vs control (false) groups.',
          },
          top_k_insights: {
            type: Type.INTEGER,
            description: 'Maximum number of insights to return. Default is 30.',
          },
          pruning_method: {
            type: Type.STRING,
            description:
              'Method for pruning insights: "NO_PRUNING" or "PRUNE_REDUNDANT_INSIGHTS". ' +
              'Default is "PRUNE_REDUNDANT_INSIGHTS".',
          },
        },
        required: ['input_data', 'contribution_metric', 'dimension_id_cols', 'is_test_col'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<BigQueryToolResult<ContributionResult[]>> {
    try {
      // Check write mode
      if (this.config.writeMode === WriteMode.BLOCKED) {
        return {
          status: 'ERROR',
          error_details:
            'analyze_contribution requires PROTECTED or ALLOWED write mode ' +
            'to create temporary models. Current mode is BLOCKED.',
        };
      }

      const client = await this.getClient();
      const args = request.args as {
        project_id?: string;
        input_data: string;
        contribution_metric: string;
        dimension_id_cols: string[];
        is_test_col: string;
        top_k_insights?: number;
        pruning_method?: string;
      };

      // Validate dimension_id_cols
      validateStringArray(args.dimension_id_cols, 'dimension_id_cols');

      // Validate pruning_method
      const pruningMethod = (args.pruning_method ??
        'PRUNE_REDUNDANT_INSIGHTS') as PruningMethod;
      if (!VALID_PRUNING_METHODS.includes(pruningMethod)) {
        return {
          status: 'ERROR',
          error_details: `pruning_method must be one of: ${VALID_PRUNING_METHODS.join(', ')}`,
        };
      }

      const topKInsights = args.top_k_insights ?? 30;
      const modelName = `_adk_contribution_${randomUUID().replace(/-/g, '_')}`;
      const dataSource = wrapAsTableOrQuery(args.input_data);

      // Get or create session for PROTECTED mode
      const toolContext = request.toolContext as ToolContext | undefined;
      let sessionId: string | undefined;
      if (this.config.writeMode === WriteMode.PROTECTED) {
        // Extract dataset from model name or use a default
        sessionId = await getOrCreateSession(client, toolContext, 'temp');
      }

      // Build dimension columns list
      const dimensionColsList = args.dimension_id_cols.map((c) => `'${c}'`).join(', ');

      // Create the contribution analysis model
      const createModelQuery = `
        CREATE TEMP MODEL \`${modelName}\`
        OPTIONS (
          model_type = 'CONTRIBUTION_ANALYSIS',
          contribution_metric = '${args.contribution_metric}',
          dimension_id_cols = [${dimensionColsList}],
          is_test_col = '${args.is_test_col}'
        )
        AS ${dataSource}
      `.trim();

      await client.query({
        query: createModelQuery,
        projectId: args.project_id ?? this.config.computeProjectId,
        location: this.config.location,
        maximumBytesBilled: this.config.maximumBytesBilled,
        jobLabels: this.config.jobLabels,
        sessionId,
      });

      // Get insights from the model
      const getInsightsQuery = `
        SELECT *
        FROM ML.GET_INSIGHTS(
          MODEL \`${modelName}\`,
          STRUCT(${topKInsights} AS top_k_insights, '${pruningMethod}' AS pruning_method)
        )
      `.trim();

      const result = await client.query({
        query: getInsightsQuery,
        projectId: args.project_id ?? this.config.computeProjectId,
        location: this.config.location,
        maximumBytesBilled: this.config.maximumBytesBilled,
        jobLabels: this.config.jobLabels,
        maxResults: this.config.maxQueryResultRows,
        sessionId,
      });

      const contributions = result.rows.map((row) => ({
        contributors: Array.isArray(row.contributors)
          ? (row.contributors as string[])
          : [],
        metric_test: Number(row.metric_test ?? 0),
        metric_control: Number(row.metric_control ?? 0),
        difference: Number(row.difference ?? 0),
        relative_difference: Number(row.relative_difference ?? 0),
        unexpected_difference: Number(row.unexpected_difference ?? 0),
        relative_unexpected_difference: Number(row.relative_unexpected_difference ?? 0),
        apriori_support: Number(row.apriori_support ?? 0),
        ...Object.fromEntries(
          Object.entries(row).filter(
            ([key]) =>
              ![
                'contributors',
                'metric_test',
                'metric_control',
                'difference',
                'relative_difference',
                'unexpected_difference',
                'relative_unexpected_difference',
                'apriori_support',
              ].includes(key),
          ),
        ),
      }));

      return {
        status: 'SUCCESS',
        data: contributions,
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
 * Tool for anomaly detection using BigQuery ML.
 *
 * Uses ARIMA_PLUS model and ML.DETECT_ANOMALIES to identify anomalous
 * points in time series data.
 */
class DetectAnomaliesTool extends BaseTool {
  constructor(
    private readonly getClient: () => Promise<BigQueryClient>,
    private readonly config: Required<
      Pick<BigQueryToolConfig, 'writeMode' | 'maxQueryResultRows'>
    > &
      BigQueryToolConfig,
  ) {
    super({
      name: 'detect_anomalies',
      description:
        'Detects anomalies in time series data using BigQuery ML ARIMA_PLUS model. ' +
        'Returns data points flagged as anomalies with probability scores and bounds. ' +
        'Requires PROTECTED or ALLOWED write mode.',
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
          history_data: {
            type: Type.STRING,
            description:
              'The historical time series data. Can be a table ID or a SELECT query.',
          },
          timestamp_col: {
            type: Type.STRING,
            description: 'The name of the timestamp column.',
          },
          data_col: {
            type: Type.STRING,
            description: 'The name of the numeric data column to analyze.',
          },
          horizon: {
            type: Type.INTEGER,
            description: 'Forecast horizon for the ARIMA model. Default is 1000.',
          },
          target_data: {
            type: Type.STRING,
            description:
              'Optional separate dataset to analyze for anomalies. ' +
              'If not provided, anomalies are detected in the history_data.',
          },
          id_cols: {
            type: Type.ARRAY,
            items: {type: Type.STRING},
            description:
              'Column names identifying individual time series (for multi-series analysis).',
          },
          anomaly_prob_threshold: {
            type: Type.NUMBER,
            description:
              'Probability threshold for anomaly detection (0-1). Default is 0.95.',
          },
        },
        required: ['history_data', 'timestamp_col', 'data_col'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<BigQueryToolResult<AnomalyResult[]>> {
    try {
      // Check write mode
      if (this.config.writeMode === WriteMode.BLOCKED) {
        return {
          status: 'ERROR',
          error_details:
            'detect_anomalies requires PROTECTED or ALLOWED write mode ' +
            'to create temporary models. Current mode is BLOCKED.',
        };
      }

      const client = await this.getClient();
      const args = request.args as {
        project_id?: string;
        history_data: string;
        timestamp_col: string;
        data_col: string;
        horizon?: number;
        target_data?: string;
        id_cols?: string[];
        anomaly_prob_threshold?: number;
      };

      const horizon = args.horizon ?? 1000;
      const anomalyProbThreshold = args.anomaly_prob_threshold ?? 0.95;
      const idCols = args.id_cols ?? [];

      // Validate id_cols
      if (idCols.length > 0) {
        validateStringArray(idCols, 'id_cols');
      }

      const modelName = `_adk_anomaly_${randomUUID().replace(/-/g, '_')}`;
      const historyDataSource = wrapAsTableOrQuery(args.history_data);

      // Get or create session for PROTECTED mode
      const toolContext = request.toolContext as ToolContext | undefined;
      let sessionId: string | undefined;
      if (this.config.writeMode === WriteMode.PROTECTED) {
        sessionId = await getOrCreateSession(client, toolContext, 'temp');
      }

      // Build id_cols option if provided
      const idColsOption =
        idCols.length > 0
          ? `, TIME_SERIES_ID_COL = [${idCols.map((c) => `'${c}'`).join(', ')}]`
          : '';

      // Create the ARIMA_PLUS model
      const createModelQuery = `
        CREATE TEMP MODEL \`${modelName}\`
        OPTIONS (
          model_type = 'ARIMA_PLUS',
          time_series_timestamp_col = '${args.timestamp_col}',
          time_series_data_col = '${args.data_col}',
          horizon = ${horizon}
          ${idColsOption}
        )
        AS SELECT * FROM ${historyDataSource}
      `.trim();

      await client.query({
        query: createModelQuery,
        projectId: args.project_id ?? this.config.computeProjectId,
        location: this.config.location,
        maximumBytesBilled: this.config.maximumBytesBilled,
        jobLabels: this.config.jobLabels,
        sessionId,
      });

      // Detect anomalies
      const targetDataClause = args.target_data
        ? `, ${wrapAsTableOrQuery(args.target_data)}`
        : '';

      const detectQuery = `
        SELECT *
        FROM ML.DETECT_ANOMALIES(
          MODEL \`${modelName}\`${targetDataClause},
          STRUCT(${anomalyProbThreshold} AS anomaly_prob_threshold)
        )
        ${idCols.length > 0 ? `ORDER BY ${idCols.join(', ')}, ${args.timestamp_col}` : `ORDER BY ${args.timestamp_col}`}
      `.trim();

      const result = await client.query({
        query: detectQuery,
        projectId: args.project_id ?? this.config.computeProjectId,
        location: this.config.location,
        maximumBytesBilled: this.config.maximumBytesBilled,
        jobLabels: this.config.jobLabels,
        maxResults: this.config.maxQueryResultRows,
        sessionId,
      });

      const anomalies = result.rows.map((row) => ({
        ts_timestamp: String(row[args.timestamp_col] ?? row.ts_timestamp ?? ''),
        ts_data: Number(row[args.data_col] ?? row.ts_data ?? 0),
        is_anomaly: Boolean(row.is_anomaly),
        lower_bound: Number(row.lower_bound ?? 0),
        upper_bound: Number(row.upper_bound ?? 0),
        anomaly_probability: Number(row.anomaly_probability ?? 0),
        ...(idCols.length > 0 && {unique_id: String(row[idCols[0]] ?? '')}),
      }));

      return {
        status: 'SUCCESS',
        data: anomalies,
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
 * Creates all BigQuery ML tools.
 */
export function createMlTools(
  getClient: () => Promise<BigQueryClient>,
  config: Required<Pick<BigQueryToolConfig, 'writeMode' | 'maxQueryResultRows'>> &
    BigQueryToolConfig,
): BaseTool[] {
  return [
    new ForecastTool(getClient, config),
    new AnalyzeContributionTool(getClient, config),
    new DetectAnomaliesTool(getClient, config),
  ];
}
