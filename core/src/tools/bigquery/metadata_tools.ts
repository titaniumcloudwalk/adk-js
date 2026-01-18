/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration, Type} from '@google/genai';

import {BaseTool, RunAsyncToolRequest} from '../base_tool.js';

import {
  BigQueryClient,
  DatasetMetadata,
  JobMetadata,
  TableMetadata,
} from './client.js';

/**
 * Standard result structure for BigQuery tool responses.
 */
export interface BigQueryToolResult<T = unknown> {
  status: 'SUCCESS' | 'ERROR';
  data?: T;
  error_details?: string;
}

/**
 * Tool for listing dataset IDs in a BigQuery project.
 */
class ListDatasetIdsTool extends BaseTool {
  constructor(private readonly getClient: () => Promise<BigQueryClient>) {
    super({
      name: 'list_dataset_ids',
      description:
        'Lists all dataset IDs in the specified BigQuery project. ' +
        'Use this to discover what datasets are available before exploring tables.',
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
        },
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<BigQueryToolResult<string[]>> {
    try {
      const client = await this.getClient();
      const projectId =
        (request.args as {project_id?: string}).project_id ?? client.projectId;
      const datasets = await client.listDatasets(projectId);
      return {
        status: 'SUCCESS',
        data: datasets.map((d) => d.datasetId),
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
 * Tool for getting detailed information about a dataset.
 */
class GetDatasetInfoTool extends BaseTool {
  constructor(private readonly getClient: () => Promise<BigQueryClient>) {
    super({
      name: 'get_dataset_info',
      description:
        'Gets detailed metadata about a BigQuery dataset including ' +
        'its location, description, labels, and timestamps.',
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
          dataset_id: {
            type: Type.STRING,
            description: 'The dataset ID to get information about.',
          },
        },
        required: ['dataset_id'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<BigQueryToolResult<DatasetMetadata>> {
    try {
      const client = await this.getClient();
      const args = request.args as {project_id?: string; dataset_id: string};
      const metadata = await client.getDataset(args.dataset_id);
      return {
        status: 'SUCCESS',
        data: metadata,
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
 * Tool for listing table IDs in a dataset.
 */
class ListTableIdsTool extends BaseTool {
  constructor(private readonly getClient: () => Promise<BigQueryClient>) {
    super({
      name: 'list_table_ids',
      description:
        'Lists all table and view IDs in a BigQuery dataset. ' +
        'Use this to discover what tables are available in a dataset.',
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
          dataset_id: {
            type: Type.STRING,
            description: 'The dataset ID to list tables from.',
          },
        },
        required: ['dataset_id'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<BigQueryToolResult<string[]>> {
    try {
      const client = await this.getClient();
      const args = request.args as {project_id?: string; dataset_id: string};
      const tables = await client.listTables(args.dataset_id);
      return {
        status: 'SUCCESS',
        data: tables.map((t) => t.tableId),
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
 * Tool for getting detailed information about a table.
 */
class GetTableInfoTool extends BaseTool {
  constructor(private readonly getClient: () => Promise<BigQueryClient>) {
    super({
      name: 'get_table_info',
      description:
        'Gets detailed metadata about a BigQuery table including ' +
        'its schema, row count, size, and timestamps. The schema ' +
        'includes column names, types, and descriptions.',
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
          dataset_id: {
            type: Type.STRING,
            description: 'The dataset ID containing the table.',
          },
          table_id: {
            type: Type.STRING,
            description: 'The table ID to get information about.',
          },
        },
        required: ['dataset_id', 'table_id'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<BigQueryToolResult<TableMetadata>> {
    try {
      const client = await this.getClient();
      const args = request.args as {
        project_id?: string;
        dataset_id: string;
        table_id: string;
      };
      const metadata = await client.getTable(args.dataset_id, args.table_id);
      return {
        status: 'SUCCESS',
        data: metadata,
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
 * Tool for getting information about a BigQuery job.
 */
class GetJobInfoTool extends BaseTool {
  constructor(private readonly getClient: () => Promise<BigQueryClient>) {
    super({
      name: 'get_job_info',
      description:
        'Gets information about a BigQuery job including its status, ' +
        'statistics, and configuration. Useful for checking the status ' +
        'of long-running queries.',
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
          job_id: {
            type: Type.STRING,
            description: 'The job ID to get information about.',
          },
        },
        required: ['job_id'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<BigQueryToolResult<JobMetadata>> {
    try {
      const client = await this.getClient();
      const args = request.args as {project_id?: string; job_id: string};
      const metadata = await client.getJob(args.job_id);
      return {
        status: 'SUCCESS',
        data: metadata,
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
 * Creates all metadata tools.
 */
export function createMetadataTools(
  getClient: () => Promise<BigQueryClient>,
): BaseTool[] {
  return [
    new ListDatasetIdsTool(getClient),
    new GetDatasetInfoTool(getClient),
    new ListTableIdsTool(getClient),
    new GetTableInfoTool(getClient),
    new GetJobInfoTool(getClient),
  ];
}
