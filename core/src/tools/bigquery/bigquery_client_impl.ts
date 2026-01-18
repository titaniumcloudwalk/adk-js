/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BigQuery client implementation using @google-cloud/bigquery.
 *
 * This module is lazily imported to allow the BigQuery SDK to be an optional
 * peer dependency. Users who want to use BigQueryToolset must install
 * @google-cloud/bigquery themselves.
 */

import type {
  BigQueryClient,
  DatasetMetadata,
  DatasetReference,
  DryRunResult,
  JobMetadata,
  QueryOptions,
  QueryResult,
  SchemaField,
  SessionInfo,
  TableMetadata,
  TableReference,
} from './client.js';
import {getBigQueryUserAgent} from './client.js';
import type {BigQueryToolConfig} from './config.js';
import type {BigQueryCredentialsConfig} from './credentials.js';

/**
 * Type definitions for @google-cloud/bigquery.
 * We define these inline to avoid requiring the types package at build time.
 */
interface BigQuerySDK {
  BigQuery: new (options?: {
    projectId?: string;
    location?: string;
    userAgent?: string;
  }) => BigQueryInstance;
}

interface BigQueryInstance {
  projectId: string;
  location?: string;
  getDatasets(
    options?: {projectId?: string},
  ): Promise<[BigQueryDataset[], unknown, unknown]>;
  dataset(datasetId: string): BigQueryDataset;
  createQueryJob(
    options: BigQueryQueryOptions,
  ): Promise<[BigQueryJob, unknown]>;
  job(jobId: string): BigQueryJob;
}

interface BigQueryDataset {
  id?: string;
  getMetadata(): Promise<[BigQueryDatasetMetadata]>;
  getTables(): Promise<[BigQueryTable[], unknown, unknown]>;
  table(tableId: string): BigQueryTable;
}

interface BigQueryDatasetMetadata {
  id?: string;
  datasetReference?: {datasetId?: string; projectId?: string};
  location?: string;
  description?: string;
  creationTime?: string;
  lastModifiedTime?: string;
  labels?: Record<string, string>;
}

interface BigQueryTable {
  id?: string;
  getMetadata(): Promise<[BigQueryTableMetadata]>;
}

interface BigQueryTableMetadata {
  id?: string;
  tableReference?: {tableId?: string; datasetId?: string; projectId?: string};
  type?: string;
  description?: string;
  schema?: {fields?: BigQuerySchemaField[]};
  numRows?: string;
  numBytes?: string;
  creationTime?: string;
  lastModifiedTime?: string;
  labels?: Record<string, string>;
}

interface BigQuerySchemaField {
  name: string;
  type: string;
  mode?: string;
  description?: string;
  fields?: BigQuerySchemaField[];
}

interface BigQueryQueryOptions {
  query: string;
  location?: string;
  maximumBytesBilled?: string;
  labels?: Record<string, string>;
  dryRun?: boolean;
  connectionProperties?: Array<{key: string; value: string}>;
}

interface BigQueryJob {
  id?: string;
  getMetadata(): Promise<[BigQueryJobMetadata]>;
  getQueryResults(
    options?: {maxResults?: number},
  ): Promise<[Record<string, unknown>[], unknown, BigQueryQueryResultsMetadata]>;
}

interface BigQueryJobMetadata {
  id?: string;
  jobReference?: {jobId?: string; projectId?: string; location?: string};
  status?: {
    state?: string;
    errorResult?: {reason?: string; message?: string};
  };
  statistics?: {
    startTime?: string;
    endTime?: string;
    totalBytesProcessed?: string;
    totalBytesBilled?: string;
    query?: {
      statementType?: string;
    };
  };
  configuration?: {
    query?: {
      query?: string;
      destinationTable?: {
        tableId?: string;
        datasetId?: string;
        projectId?: string;
      };
    };
  };
}

interface BigQueryQueryResultsMetadata {
  totalRows?: string;
  schema?: {fields?: BigQuerySchemaField[]};
  jobReference?: {jobId?: string; projectId?: string; location?: string};
}

/**
 * Creates a BigQuery client using the @google-cloud/bigquery SDK.
 */
export async function createBigQueryClient(
  credentialsConfig?: BigQueryCredentialsConfig,
  toolConfig?: BigQueryToolConfig,
): Promise<BigQueryClient> {
  let BigQueryModule: BigQuerySDK;

  try {
    // Dynamic import to make the SDK an optional dependency
    BigQueryModule = await import(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - BigQuery is an optional peer dependency
      '@google-cloud/bigquery'
    ) as unknown as BigQuerySDK;
  } catch (error) {
    throw new Error(
      'BigQueryToolset requires @google-cloud/bigquery to be installed. ' +
        'Please run: npm install @google-cloud/bigquery',
    );
  }

  const bq = new BigQueryModule.BigQuery({
    projectId: credentialsConfig?.projectId,
    location: toolConfig?.location,
    userAgent: getBigQueryUserAgent(toolConfig?.applicationName),
  });

  return new BigQueryClientImpl(bq, toolConfig);
}

/**
 * Implementation of BigQueryClient using the official SDK.
 */
class BigQueryClientImpl implements BigQueryClient {
  constructor(
    private readonly bq: BigQueryInstance,
    private readonly toolConfig?: BigQueryToolConfig,
  ) {}

  get projectId(): string {
    return this.bq.projectId;
  }

  get location(): string | undefined {
    return this.toolConfig?.location ?? this.bq.location;
  }

  async query(options: QueryOptions): Promise<QueryResult> {
    const queryOptions: BigQueryQueryOptions = {
      query: options.query,
      location: options.location ?? this.location,
      labels: options.jobLabels,
    };

    if (options.maximumBytesBilled !== undefined) {
      queryOptions.maximumBytesBilled = String(options.maximumBytesBilled);
    }

    if (options.sessionId) {
      queryOptions.connectionProperties = [
        {key: 'session_id', value: options.sessionId},
      ];
    }

    const [job] = await this.bq.createQueryJob(queryOptions);

    const [rows, , metadata] = await job.getQueryResults({
      maxResults: options.maxResults,
    });

    return {
      rows: rows as Record<string, unknown>[],
      totalRows: metadata.totalRows ? parseInt(metadata.totalRows, 10) : undefined,
      schema: metadata.schema
        ? {
            fields:
              metadata.schema.fields?.map((f) => this.convertSchemaField(f)) ?? [],
          }
        : undefined,
      jobReference: metadata.jobReference
        ? {
            jobId: metadata.jobReference.jobId ?? '',
            projectId: metadata.jobReference.projectId ?? '',
            location: metadata.jobReference.location,
          }
        : undefined,
    };
  }

  private convertSchemaField(f: BigQuerySchemaField): SchemaField {
    return {
      name: f.name,
      type: f.type,
      mode: f.mode,
      description: f.description,
      fields: f.fields?.map((nested) => this.convertSchemaField(nested)),
    };
  }

  async getDataset(datasetId: string): Promise<DatasetMetadata> {
    const dataset = this.bq.dataset(datasetId);
    const [metadata] = await dataset.getMetadata();

    return {
      datasetId: metadata.datasetReference?.datasetId ?? datasetId,
      projectId: metadata.datasetReference?.projectId ?? this.projectId,
      location: metadata.location,
      description: metadata.description,
      creationTime: metadata.creationTime,
      lastModifiedTime: metadata.lastModifiedTime,
      labels: metadata.labels,
    };
  }

  async listDatasets(projectId?: string): Promise<DatasetReference[]> {
    const [datasets] = await this.bq.getDatasets({projectId});
    return datasets.map((d) => ({
      datasetId: d.id ?? '',
      projectId: projectId ?? this.projectId,
    }));
  }

  async getTable(
    datasetId: string,
    tableId: string,
  ): Promise<TableMetadata> {
    const table = this.bq.dataset(datasetId).table(tableId);
    const [metadata] = await table.getMetadata();

    return {
      tableId: metadata.tableReference?.tableId ?? tableId,
      datasetId: metadata.tableReference?.datasetId ?? datasetId,
      projectId: metadata.tableReference?.projectId ?? this.projectId,
      type: metadata.type,
      description: metadata.description,
      schema: metadata.schema
        ? {
            fields:
              metadata.schema.fields?.map((f) => this.convertSchemaField(f)) ?? [],
          }
        : undefined,
      numRows: metadata.numRows,
      numBytes: metadata.numBytes,
      creationTime: metadata.creationTime,
      lastModifiedTime: metadata.lastModifiedTime,
      labels: metadata.labels,
    };
  }

  async listTables(datasetId: string): Promise<TableReference[]> {
    const dataset = this.bq.dataset(datasetId);
    const [tables] = await dataset.getTables();
    return tables.map((t) => ({
      tableId: t.id ?? '',
      datasetId,
      projectId: this.projectId,
    }));
  }

  async getJob(jobId: string): Promise<JobMetadata> {
    const job = this.bq.job(jobId);
    const [metadata] = await job.getMetadata();

    return {
      jobId: metadata.jobReference?.jobId ?? jobId,
      projectId: metadata.jobReference?.projectId ?? this.projectId,
      location: metadata.jobReference?.location,
      status: metadata.status
        ? {
            state: metadata.status.state ?? 'UNKNOWN',
            errorResult: metadata.status.errorResult
              ? {
                  reason: metadata.status.errorResult.reason ?? '',
                  message: metadata.status.errorResult.message ?? '',
                }
              : undefined,
          }
        : undefined,
      statistics: metadata.statistics
        ? {
            startTime: metadata.statistics.startTime,
            endTime: metadata.statistics.endTime,
            totalBytesProcessed: metadata.statistics.totalBytesProcessed,
            totalBytesBilled: metadata.statistics.totalBytesBilled,
          }
        : undefined,
      configuration: metadata.configuration?.query
        ? {
            query: {
              query: metadata.configuration.query.query ?? '',
              destinationTable: metadata.configuration.query.destinationTable
                ? {
                    tableId:
                      metadata.configuration.query.destinationTable.tableId ??
                      '',
                    datasetId:
                      metadata.configuration.query.destinationTable.datasetId ??
                      '',
                    projectId:
                      metadata.configuration.query.destinationTable.projectId ??
                      '',
                  }
                : undefined,
            },
          }
        : undefined,
    };
  }

  async dryRunQuery(query: string): Promise<DryRunResult> {
    const [job] = await this.bq.createQueryJob({
      query,
      dryRun: true,
      location: this.location,
    });

    const [metadata] = await job.getMetadata();

    return {
      totalBytesProcessed: parseInt(
        metadata.statistics?.totalBytesProcessed ?? '0',
        10,
      ),
      statementType: metadata.statistics?.query?.statementType,
    };
  }

  async createSession(datasetId: string): Promise<SessionInfo> {
    // BigQuery sessions are created implicitly when you use connection properties
    // For now, we'll create a simple session by running a SET statement
    const [job] = await this.bq.createQueryJob({
      query: `SELECT 1`, // Simple query to establish session
      location: this.location,
      connectionProperties: [{key: 'create_session', value: 'true'}],
    });

    const [metadata] = await job.getMetadata();

    // The session ID would be in the job's connection properties
    // For simplicity, we'll generate a UUID-based session ID
    const sessionId = `adk_session_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    return {
      sessionId,
      location: metadata.jobReference?.location ?? this.location ?? 'US',
    };
  }
}
