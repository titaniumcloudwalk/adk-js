/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ReadonlyContext} from '../../agents/readonly_context.js';
import {BaseTool} from '../base_tool.js';
import {BaseToolset, ToolPredicate} from '../base_toolset.js';

import {BigQueryClient, getBigQueryUserAgent} from './client.js';
import {
  BigQueryToolConfig,
  validateBigQueryToolConfig,
} from './config.js';
import {BigQueryCredentialsConfig} from './credentials.js';
import {createDataInsightsTool} from './data_insights_tool.js';
import {createMetadataTools} from './metadata_tools.js';
import {createMlTools} from './ml_tools.js';
import {createExecuteSqlTool} from './query_tool.js';

/**
 * Options for creating a BigQueryToolset.
 */
export interface BigQueryToolsetOptions {
  /**
   * Filter to select which tools to expose.
   * Can be a list of tool names or a predicate function.
   */
  toolFilter?: ToolPredicate | string[];

  /**
   * Credentials configuration for BigQuery access.
   */
  credentialsConfig?: BigQueryCredentialsConfig;

  /**
   * Configuration for BigQuery tool behavior.
   */
  toolConfig?: BigQueryToolConfig;

  /**
   * Optional custom BigQuery client factory for testing.
   * If not provided, uses the real BigQuery SDK (lazily loaded).
   */
  clientFactory?: (
    credentialsConfig?: BigQueryCredentialsConfig,
    toolConfig?: BigQueryToolConfig,
  ) => Promise<BigQueryClient>;
}

/**
 * A toolset that provides access to BigQuery for data exploration, querying,
 * and advanced ML analytics.
 *
 * The toolset includes tools for:
 * - **Metadata** - Listing datasets and tables, getting detailed metadata
 * - **Querying** - Executing SQL queries (with configurable write mode)
 * - **ML Analytics** - Time series forecasting, contribution analysis, anomaly detection
 * - **Data Insights** - Natural language queries using Gemini Data Analytics API
 *
 * **Available Tools:**
 * 1. `list_dataset_ids` - List all dataset IDs in a project
 * 2. `get_dataset_info` - Get detailed dataset metadata
 * 3. `list_table_ids` - List all table IDs in a dataset
 * 4. `get_table_info` - Get detailed table metadata with schema
 * 5. `get_job_info` - Get information about a BigQuery job
 * 6. `execute_sql` - Execute SQL queries (behavior depends on writeMode)
 * 7. `forecast` - Time series forecasting with TimesFM 2.0
 * 8. `analyze_contribution` - Contribution analysis for metric changes
 * 9. `detect_anomalies` - Anomaly detection using ARIMA_PLUS
 * 10. `ask_data_insights` - Natural language queries via Gemini
 *
 * @example
 * ```typescript
 * import {BigQueryToolset, WriteMode} from '@google/adk';
 *
 * // Create a read-only toolset (no ML tools that require models)
 * const toolset = new BigQueryToolset({
 *   toolConfig: {
 *     writeMode: WriteMode.BLOCKED,
 *     maxQueryResultRows: 100,
 *   },
 * });
 *
 * // Create a toolset with ML capabilities (PROTECTED mode for temp models)
 * const mlToolset = new BigQueryToolset({
 *   toolConfig: {
 *     writeMode: WriteMode.PROTECTED,
 *     maxQueryResultRows: 100,
 *   },
 * });
 *
 * // Use with an agent
 * const agent = new LlmAgent({
 *   name: 'data-analyst',
 *   model: new Gemini({model: 'gemini-2.5-flash'}),
 *   tools: [toolset],
 * });
 * ```
 */
export class BigQueryToolset extends BaseToolset {
  private readonly credentialsConfig?: BigQueryCredentialsConfig;
  private readonly toolConfig: Required<
    Pick<BigQueryToolConfig, 'writeMode' | 'maxQueryResultRows'>
  > &
    BigQueryToolConfig;
  private readonly clientFactory?: (
    credentialsConfig?: BigQueryCredentialsConfig,
    toolConfig?: BigQueryToolConfig,
  ) => Promise<BigQueryClient>;

  private cachedClient?: BigQueryClient;
  private tools?: BaseTool[];

  constructor(options: BigQueryToolsetOptions = {}) {
    super(options.toolFilter ?? []);
    this.credentialsConfig = options.credentialsConfig;
    this.toolConfig = validateBigQueryToolConfig(options.toolConfig);
    this.clientFactory = options.clientFactory;
  }

  /**
   * Gets or creates the BigQuery client.
   */
  private async getClient(): Promise<BigQueryClient> {
    if (this.cachedClient) {
      return this.cachedClient;
    }

    if (this.clientFactory) {
      this.cachedClient = await this.clientFactory(
        this.credentialsConfig,
        this.toolConfig,
      );
      return this.cachedClient;
    }

    // Lazily import the BigQuery SDK client wrapper
    // This allows the SDK to be optionally installed
    const {createBigQueryClient} = await import('./bigquery_client_impl.js');
    this.cachedClient = await createBigQueryClient(
      this.credentialsConfig,
      this.toolConfig,
    );
    return this.cachedClient;
  }

  /**
   * Returns the tools exposed by this toolset.
   *
   * Returns up to 10 tools:
   * - 5 metadata tools (list_dataset_ids, get_dataset_info, list_table_ids,
   *   get_table_info, get_job_info)
   * - 1 query tool (execute_sql)
   * - 3 ML tools (forecast, analyze_contribution, detect_anomalies)
   * - 1 data insights tool (ask_data_insights)
   */
  override async getTools(context?: ReadonlyContext): Promise<BaseTool[]> {
    if (!this.tools) {
      const getClient = () => this.getClient();

      this.tools = [
        // Metadata tools
        ...createMetadataTools(getClient),
        // Query tool
        createExecuteSqlTool(getClient, this.toolConfig),
        // ML tools (forecast, analyze_contribution, detect_anomalies)
        ...createMlTools(getClient, this.toolConfig),
        // Data insights tool
        createDataInsightsTool(this.credentialsConfig, this.toolConfig),
      ];
    }

    // Apply filtering if context is provided
    if (context) {
      return this.tools.filter((tool) => this.isToolSelected(tool, context));
    }

    // If no context and toolFilter is a string array, filter by name
    if (Array.isArray(this.toolFilter) && this.toolFilter.length > 0) {
      return this.tools.filter((tool) =>
        (this.toolFilter as string[]).includes(tool.name),
      );
    }

    return this.tools;
  }

  /**
   * Closes the toolset and releases any resources.
   */
  override async close(): Promise<void> {
    // BigQuery client doesn't require explicit cleanup
    this.cachedClient = undefined;
    this.tools = undefined;
  }
}
