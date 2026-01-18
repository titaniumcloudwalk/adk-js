/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration, Type} from '@google/genai';

import {BaseTool, RunAsyncToolRequest} from '../base_tool.js';

import {BigtableClient} from './client.js';

/**
 * Standard result structure for Bigtable tool responses.
 */
export interface BigtableToolResult<T = unknown> {
  status: 'SUCCESS' | 'ERROR';
  results?: T;
  error_details?: string;
}

/**
 * Tool for listing instance IDs in a Bigtable project.
 */
class ListInstancesTool extends BaseTool {
  constructor(private readonly getClient: () => Promise<BigtableClient>) {
    super({
      name: 'list_instances',
      description:
        'Lists all Bigtable instance IDs in the Google Cloud project. ' +
        'Returns a list of instance identifiers that can be used with other Bigtable tools.',
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
  ): Promise<BigtableToolResult<string[]>> {
    try {
      const client = await this.getClient();
      const instances = await client.listInstances();
      return {
        status: 'SUCCESS',
        results: instances.map((i) => i.instanceId),
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
 * Tool for getting detailed information about a Bigtable instance.
 */
class GetInstanceInfoTool extends BaseTool {
  constructor(private readonly getClient: () => Promise<BigtableClient>) {
    super({
      name: 'get_instance_info',
      description:
        'Gets detailed metadata about a Bigtable instance, including its ' +
        'display name, state, type, and labels.',
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
            description: 'The Bigtable instance ID to get information about.',
          },
        },
        required: ['instance_id'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<Record<string, unknown>> {
    try {
      const args = request.args as {project_id?: string; instance_id: string};
      const client = await this.getClient();
      const metadata = await client.getInstance(args.instance_id);
      return {
        status: 'SUCCESS',
        project_id: metadata.projectId,
        instance_id: metadata.instanceId,
        display_name: metadata.displayName,
        state: metadata.state,
        type_: metadata.type,
        labels: metadata.labels,
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
 * Tool for listing table IDs in a Bigtable instance.
 */
class ListTablesTool extends BaseTool {
  constructor(private readonly getClient: () => Promise<BigtableClient>) {
    super({
      name: 'list_tables',
      description:
        'Lists all table IDs in a Bigtable instance. ' +
        'Returns a list of table identifiers that can be used with other Bigtable tools.',
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
            description: 'The Bigtable instance ID to list tables from.',
          },
        },
        required: ['instance_id'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<BigtableToolResult<string[]>> {
    try {
      const args = request.args as {project_id?: string; instance_id: string};
      const client = await this.getClient();
      const tables = await client.listTables(args.instance_id);
      return {
        status: 'SUCCESS',
        results: tables.map((t) => t.tableId),
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
 * Tool for getting detailed information about a Bigtable table.
 */
class GetTableInfoTool extends BaseTool {
  constructor(private readonly getClient: () => Promise<BigtableClient>) {
    super({
      name: 'get_table_info',
      description:
        'Gets detailed metadata about a Bigtable table, including its column families.',
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
            description: 'The Bigtable instance ID containing the table.',
          },
          table_id: {
            type: Type.STRING,
            description: 'The Bigtable table ID to get information about.',
          },
        },
        required: ['instance_id', 'table_id'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<Record<string, unknown>> {
    try {
      const args = request.args as {
        project_id?: string;
        instance_id: string;
        table_id: string;
      };
      const client = await this.getClient();
      const metadata = await client.getTable(args.instance_id, args.table_id);
      return {
        status: 'SUCCESS',
        project_id: metadata.projectId,
        instance_id: metadata.instanceId,
        table_id: metadata.tableId,
        column_families: metadata.columnFamilies,
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
 * Creates all metadata tools for Bigtable.
 *
 * @param getClient Function to get the Bigtable client
 * @returns Array of metadata tools
 */
export function createMetadataTools(
  getClient: () => Promise<BigtableClient>,
): BaseTool[] {
  return [
    new ListInstancesTool(getClient),
    new GetInstanceInfoTool(getClient),
    new ListTablesTool(getClient),
    new GetTableInfoTool(getClient),
  ];
}
