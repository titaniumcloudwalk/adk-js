/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration, Type} from '@google/genai';

import {BaseTool, RunAsyncToolRequest} from '../base_tool.js';

import {
  SpannerClient,
  TableSchemaInfo,
  ColumnSchemaInfo,
  KeyColumnInfo,
  TableMetadataInfo,
  IndexInfo,
  IndexColumnInfo,
} from './client.js';

/**
 * Standard result structure for Spanner tool responses.
 */
export interface SpannerToolResult<T = unknown> {
  status: 'SUCCESS' | 'ERROR';
  results?: T;
  error_details?: string;
}

/**
 * Tool for listing table names in a Spanner database.
 */
class ListTableNamesTool extends BaseTool {
  constructor(
    private readonly getClient: () => Promise<SpannerClient>,
  ) {
    super({
      name: 'spanner_list_table_names',
      description:
        'Lists all table names in the specified Spanner database. ' +
        'Use this to discover what tables are available before exploring schemas.',
    });
  }

  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          named_schema: {
            type: Type.STRING,
            description:
              'The schema name to filter tables by. Defaults to "_default" schema.',
          },
        },
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<SpannerToolResult<string[]>> {
    try {
      const client = await this.getClient();
      const args = request.args as {named_schema?: string};
      const namedSchema = args.named_schema ?? '_default';

      // Query INFORMATION_SCHEMA for table names
      const query = namedSchema === '_default'
        ? `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = '' AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`
        : `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = @schema AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`;

      const result = await client.executeQuery({
        query,
        params: namedSchema !== '_default' ? {schema: namedSchema} : undefined,
      });

      const tableNames = result.rows.map((row) => {
        if (Array.isArray(row)) {
          return String(row[0]);
        }
        if (typeof row === 'object' && row !== null && 'TABLE_NAME' in row) {
          return String((row as Record<string, unknown>).TABLE_NAME);
        }
        return String(row);
      });

      return {
        status: 'SUCCESS',
        results: tableNames,
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
 * Tool for getting table schema information.
 */
class GetTableSchemaTool extends BaseTool {
  constructor(
    private readonly getClient: () => Promise<SpannerClient>,
  ) {
    super({
      name: 'spanner_get_table_schema',
      description:
        'Gets detailed schema information for a Spanner table including ' +
        'column definitions, types, nullability, and key columns.',
    });
  }

  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          table_name: {
            type: Type.STRING,
            description: 'The name of the table to get schema information for.',
          },
        },
        required: ['table_name'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<SpannerToolResult<TableSchemaInfo>> {
    try {
      const client = await this.getClient();
      const args = request.args as {table_name: string};

      // Query column information
      const columnQuery = `
        SELECT
          COLUMN_NAME,
          SPANNER_TYPE,
          ORDINAL_POSITION,
          IS_NULLABLE,
          COLUMN_DEFAULT,
          GENERATION_EXPRESSION
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = @table_name
        ORDER BY ORDINAL_POSITION
      `;

      const columnResult = await client.executeQuery({
        query: columnQuery,
        params: {table_name: args.table_name},
      });

      const columns: ColumnSchemaInfo[] = columnResult.rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          name: String(r.COLUMN_NAME ?? r[0]),
          type: String(r.SPANNER_TYPE ?? r[1]),
          ordinalPosition: Number(r.ORDINAL_POSITION ?? r[2]),
          isNullable: (r.IS_NULLABLE ?? r[3]) === 'YES',
          columnDefault: r.COLUMN_DEFAULT != null ? String(r.COLUMN_DEFAULT) : undefined,
          generationExpression: r.GENERATION_EXPRESSION != null ? String(r.GENERATION_EXPRESSION) : undefined,
        };
      });

      // Query key column information
      const keyQuery = `
        SELECT
          COLUMN_NAME,
          CONSTRAINT_NAME,
          ORDINAL_POSITION
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_NAME = @table_name
        ORDER BY ORDINAL_POSITION
      `;

      const keyResult = await client.executeQuery({
        query: keyQuery,
        params: {table_name: args.table_name},
      });

      const keyColumns: KeyColumnInfo[] = keyResult.rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          columnName: String(r.COLUMN_NAME ?? r[0]),
          constraintName: String(r.CONSTRAINT_NAME ?? r[1]),
          ordinalPosition: Number(r.ORDINAL_POSITION ?? r[2]),
        };
      });

      // Query table metadata
      const tableQuery = `
        SELECT
          TABLE_TYPE,
          PARENT_TABLE_NAME,
          ON_DELETE_ACTION,
          INTERLEAVE_TYPE
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = @table_name
      `;

      const tableResult = await client.executeQuery({
        query: tableQuery,
        params: {table_name: args.table_name},
      });

      let tableMetadata: TableMetadataInfo | undefined;
      if (tableResult.rows.length > 0) {
        const r = tableResult.rows[0] as Record<string, unknown>;
        tableMetadata = {
          tableType: r.TABLE_TYPE != null ? String(r.TABLE_TYPE) : undefined,
          parentTableName: r.PARENT_TABLE_NAME != null ? String(r.PARENT_TABLE_NAME) : undefined,
          onDeleteAction: r.ON_DELETE_ACTION != null ? String(r.ON_DELETE_ACTION) : undefined,
          interleaveType: r.INTERLEAVE_TYPE != null ? String(r.INTERLEAVE_TYPE) : undefined,
        };
      }

      return {
        status: 'SUCCESS',
        results: {
          columns,
          keyColumns: keyColumns.length > 0 ? keyColumns : undefined,
          tableMetadata,
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
 * Tool for listing table indexes.
 */
class ListTableIndexesTool extends BaseTool {
  constructor(
    private readonly getClient: () => Promise<SpannerClient>,
  ) {
    super({
      name: 'spanner_list_table_indexes',
      description:
        'Lists all indexes for a specified Spanner table including ' +
        'index type, uniqueness, and state.',
    });
  }

  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          table_name: {
            type: Type.STRING,
            description: 'The name of the table to list indexes for.',
          },
        },
        required: ['table_name'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<SpannerToolResult<IndexInfo[]>> {
    try {
      const client = await this.getClient();
      const args = request.args as {table_name: string};

      const query = `
        SELECT
          INDEX_NAME,
          INDEX_TYPE,
          PARENT_TABLE_NAME,
          IS_UNIQUE,
          IS_NULL_FILTERED,
          INDEX_STATE
        FROM INFORMATION_SCHEMA.INDEXES
        WHERE TABLE_NAME = @table_name
        ORDER BY INDEX_NAME
      `;

      const result = await client.executeQuery({
        query,
        params: {table_name: args.table_name},
      });

      const indexes: IndexInfo[] = result.rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          indexName: String(r.INDEX_NAME ?? r[0]),
          indexType: String(r.INDEX_TYPE ?? r[1]),
          parentTableName: r.PARENT_TABLE_NAME != null ? String(r.PARENT_TABLE_NAME) : undefined,
          isUnique: (r.IS_UNIQUE ?? r[3]) === true || (r.IS_UNIQUE ?? r[3]) === 'true',
          isNullFiltered: (r.IS_NULL_FILTERED ?? r[4]) === true || (r.IS_NULL_FILTERED ?? r[4]) === 'true',
          indexState: String(r.INDEX_STATE ?? r[5]),
        };
      });

      return {
        status: 'SUCCESS',
        results: indexes,
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
 * Tool for listing index columns.
 */
class ListTableIndexColumnsTool extends BaseTool {
  constructor(
    private readonly getClient: () => Promise<SpannerClient>,
  ) {
    super({
      name: 'spanner_list_table_index_columns',
      description:
        'Lists all columns for indexes on a specified Spanner table.',
    });
  }

  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          table_name: {
            type: Type.STRING,
            description: 'The name of the table to list index columns for.',
          },
        },
        required: ['table_name'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<SpannerToolResult<IndexColumnInfo[]>> {
    try {
      const client = await this.getClient();
      const args = request.args as {table_name: string};

      const query = `
        SELECT
          INDEX_NAME,
          COLUMN_NAME,
          COLUMN_ORDERING,
          IS_NULLABLE,
          SPANNER_TYPE,
          ORDINAL_POSITION
        FROM INFORMATION_SCHEMA.INDEX_COLUMNS
        WHERE TABLE_NAME = @table_name
        ORDER BY INDEX_NAME, ORDINAL_POSITION
      `;

      const result = await client.executeQuery({
        query,
        params: {table_name: args.table_name},
      });

      const indexColumns: IndexColumnInfo[] = result.rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          indexName: String(r.INDEX_NAME ?? r[0]),
          columnName: String(r.COLUMN_NAME ?? r[1]),
          columnOrdering: r.COLUMN_ORDERING != null ? String(r.COLUMN_ORDERING) : undefined,
          isNullable: (r.IS_NULLABLE ?? r[3]) === 'YES',
          spannerType: String(r.SPANNER_TYPE ?? r[4]),
          ordinalPosition: Number(r.ORDINAL_POSITION ?? r[5]),
        };
      });

      return {
        status: 'SUCCESS',
        results: indexColumns,
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
 * Tool for listing named schemas.
 */
class ListNamedSchemasTool extends BaseTool {
  constructor(
    private readonly getClient: () => Promise<SpannerClient>,
  ) {
    super({
      name: 'spanner_list_named_schemas',
      description:
        'Lists all named schemas in the Spanner database (excluding system schemas).',
    });
  }

  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {},
      },
    };
  }

  override async runAsync(
    _request: RunAsyncToolRequest,
  ): Promise<SpannerToolResult<string[]>> {
    try {
      const client = await this.getClient();

      const query = `
        SELECT SCHEMA_NAME
        FROM INFORMATION_SCHEMA.SCHEMATA
        WHERE SCHEMA_NAME NOT IN ('', 'INFORMATION_SCHEMA', 'SPANNER_SYS')
        ORDER BY SCHEMA_NAME
      `;

      const result = await client.executeQuery({query});

      const schemas: string[] = result.rows.map((row) => {
        if (Array.isArray(row)) {
          return String(row[0]);
        }
        if (typeof row === 'object' && row !== null && 'SCHEMA_NAME' in row) {
          return String((row as Record<string, unknown>).SCHEMA_NAME);
        }
        return String(row);
      });

      return {
        status: 'SUCCESS',
        results: schemas,
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
  getClient: () => Promise<SpannerClient>,
): BaseTool[] {
  return [
    new ListTableNamesTool(getClient),
    new GetTableSchemaTool(getClient),
    new ListTableIndexesTool(getClient),
    new ListTableIndexColumnsTool(getClient),
    new ListNamedSchemasTool(getClient),
  ];
}
