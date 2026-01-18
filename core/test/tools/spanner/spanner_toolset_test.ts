/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
  Capabilities,
  QueryResultMode,
  SpannerClient,
  SpannerToolSettings,
  SpannerToolset,
  validateSpannerToolSettings,
} from '../../../src/tools/spanner/index.js';

// Mock Spanner client
function createMockClient(
  overrides: Partial<SpannerClient> = {},
): SpannerClient {
  return {
    projectId: 'test-project',
    instanceId: 'test-instance',
    databaseId: 'test-database',
    executeQuery: vi.fn().mockResolvedValue({
      rows: [{col1: 'value1', col2: 'value2'}],
      metadata: [{name: 'col1', type: 'STRING'}, {name: 'col2', type: 'STRING'}],
      resultIsLikelyTruncated: false,
    }),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('SpannerToolset', () => {
  describe('validateSpannerToolSettings', () => {
    it('should return defaults when no settings provided', () => {
      const settings = validateSpannerToolSettings();
      expect(settings.capabilities).toEqual([Capabilities.DATA_READ]);
      expect(settings.maxExecutedQueryResultRows).toBe(50);
      expect(settings.queryResultMode).toBe(QueryResultMode.DEFAULT);
    });

    it('should accept valid settings', () => {
      const settings = validateSpannerToolSettings({
        capabilities: [Capabilities.DATA_READ],
        maxExecutedQueryResultRows: 100,
        queryResultMode: QueryResultMode.DICT_LIST,
      });

      expect(settings.capabilities).toEqual([Capabilities.DATA_READ]);
      expect(settings.maxExecutedQueryResultRows).toBe(100);
      expect(settings.queryResultMode).toBe(QueryResultMode.DICT_LIST);
    });

    it('should reject vectorLength <= 0', () => {
      expect(() =>
        validateSpannerToolSettings({
          vectorStoreSettings: {
            projectId: 'test',
            instanceId: 'test',
            databaseId: 'test',
            tableName: 'test',
            contentColumn: 'content',
            embeddingColumn: 'embedding',
            vectorLength: 0,
            vertexAiEmbeddingModelName: 'test-model',
          },
        }),
      ).toThrow('vectorLength must be greater than 0');
    });

    it('should accept valid vector store settings', () => {
      const settings = validateSpannerToolSettings({
        vectorStoreSettings: {
          projectId: 'test',
          instanceId: 'test',
          databaseId: 'test',
          tableName: 'test_vectors',
          contentColumn: 'content',
          embeddingColumn: 'embedding',
          vectorLength: 768,
          vertexAiEmbeddingModelName: 'text-embedding-005',
        },
      });

      expect(settings.vectorStoreSettings).toBeDefined();
      expect(settings.vectorStoreSettings!.vectorLength).toBe(768);
    });
  });

  describe('getTools', () => {
    let toolset: SpannerToolset;
    let mockClient: SpannerClient;

    beforeEach(() => {
      mockClient = createMockClient();
      toolset = new SpannerToolset({
        projectId: 'test-project',
        instanceId: 'test-instance',
        databaseId: 'test-database',
        clientFactory: async () => mockClient,
      });
    });

    it('should return 7 tools by default (with DATA_READ capability)', async () => {
      const tools = await toolset.getTools();
      expect(tools).toHaveLength(7);

      const toolNames = tools.map((t) => t.name);
      // Metadata tools (always available)
      expect(toolNames).toContain('spanner_list_table_names');
      expect(toolNames).toContain('spanner_get_table_schema');
      expect(toolNames).toContain('spanner_list_table_indexes');
      expect(toolNames).toContain('spanner_list_table_index_columns');
      expect(toolNames).toContain('spanner_list_named_schemas');
      // Query tools (require DATA_READ)
      expect(toolNames).toContain('spanner_execute_sql');
      expect(toolNames).toContain('spanner_similarity_search');
    });

    it('should return only metadata tools when no capabilities', async () => {
      toolset = new SpannerToolset({
        projectId: 'test-project',
        instanceId: 'test-instance',
        databaseId: 'test-database',
        toolSettings: {
          capabilities: [],
        },
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      expect(tools).toHaveLength(5);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('spanner_list_table_names');
      expect(toolNames).toContain('spanner_get_table_schema');
      expect(toolNames).not.toContain('spanner_execute_sql');
      expect(toolNames).not.toContain('spanner_similarity_search');
    });

    it('should include vector_store_similarity_search when settings provided', async () => {
      toolset = new SpannerToolset({
        projectId: 'test-project',
        instanceId: 'test-instance',
        databaseId: 'test-database',
        toolSettings: {
          vectorStoreSettings: {
            projectId: 'test-project',
            instanceId: 'test-instance',
            databaseId: 'test-database',
            tableName: 'vectors',
            contentColumn: 'content',
            embeddingColumn: 'embedding',
            vectorLength: 768,
            vertexAiEmbeddingModelName: 'text-embedding-005',
          },
        },
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      expect(tools).toHaveLength(8);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('spanner_vector_store_similarity_search');
    });

    it('should filter tools by name array', async () => {
      toolset = new SpannerToolset({
        projectId: 'test-project',
        instanceId: 'test-instance',
        databaseId: 'test-database',
        toolFilter: ['spanner_list_table_names', 'spanner_execute_sql'],
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      expect(tools).toHaveLength(2);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('spanner_list_table_names');
      expect(toolNames).toContain('spanner_execute_sql');
    });

    it('should cache tools', async () => {
      const tools1 = await toolset.getTools();
      const tools2 = await toolset.getTools();
      expect(tools1).toBe(tools2);
    });
  });

  describe('metadata tools', () => {
    let toolset: SpannerToolset;
    let mockClient: SpannerClient;

    beforeEach(() => {
      mockClient = createMockClient({
        executeQuery: vi.fn().mockImplementation(async (options: {query: string}) => {
          if (options.query.includes('TABLES')) {
            return {
              rows: [{TABLE_NAME: 'table1'}, {TABLE_NAME: 'table2'}],
            };
          }
          // Check INDEX_COLUMNS before COLUMNS (INDEX_COLUMNS contains COLUMNS)
          if (options.query.includes('INDEX_COLUMNS')) {
            return {
              rows: [{
                INDEX_NAME: 'idx_name',
                COLUMN_NAME: 'name',
                COLUMN_ORDERING: 'ASC',
                IS_NULLABLE: 'YES',
                SPANNER_TYPE: 'STRING(MAX)',
                ORDINAL_POSITION: 1,
              }],
            };
          }
          if (options.query.includes('COLUMNS')) {
            return {
              rows: [
                {COLUMN_NAME: 'id', SPANNER_TYPE: 'INT64', ORDINAL_POSITION: 1, IS_NULLABLE: 'NO'},
                {COLUMN_NAME: 'name', SPANNER_TYPE: 'STRING(MAX)', ORDINAL_POSITION: 2, IS_NULLABLE: 'YES'},
              ],
            };
          }
          if (options.query.includes('KEY_COLUMN_USAGE')) {
            return {
              rows: [{COLUMN_NAME: 'id', CONSTRAINT_NAME: 'PK_table1', ORDINAL_POSITION: 1}],
            };
          }
          if (options.query.includes('INDEXES')) {
            return {
              rows: [{
                INDEX_NAME: 'idx_name',
                INDEX_TYPE: 'INDEX',
                IS_UNIQUE: false,
                IS_NULL_FILTERED: false,
                INDEX_STATE: 'READ_WRITE',
              }],
            };
          }
          if (options.query.includes('SCHEMATA')) {
            return {
              rows: [{SCHEMA_NAME: 'my_schema'}],
            };
          }
          return {rows: []};
        }),
      });
      toolset = new SpannerToolset({
        projectId: 'test-project',
        instanceId: 'test-instance',
        databaseId: 'test-database',
        clientFactory: async () => mockClient,
      });
    });

    it('spanner_list_table_names should return table names', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_list_table_names');
      expect(tool).toBeDefined();

      const result = (await tool!.runAsync({
        args: {},
        toolContext: {} as any,
      })) as {status: string; results: string[]};

      expect(result.status).toBe('SUCCESS');
      expect(result.results).toEqual(['table1', 'table2']);
    });

    it('spanner_get_table_schema should return schema info', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_get_table_schema');

      const result = (await tool!.runAsync({
        args: {table_name: 'test_table'},
        toolContext: {} as any,
      })) as {status: string; results: any};

      expect(result.status).toBe('SUCCESS');
      expect(result.results.columns).toHaveLength(2);
      expect(result.results.columns[0].name).toBe('id');
    });

    it('spanner_list_table_indexes should return index info', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_list_table_indexes');

      const result = (await tool!.runAsync({
        args: {table_name: 'test_table'},
        toolContext: {} as any,
      })) as {status: string; results: any[]};

      expect(result.status).toBe('SUCCESS');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].indexName).toBe('idx_name');
    });

    it('spanner_list_table_index_columns should return index column info', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_list_table_index_columns');

      const result = (await tool!.runAsync({
        args: {table_name: 'test_table'},
        toolContext: {} as any,
      })) as {status: string; results: any[]};

      expect(result.status).toBe('SUCCESS');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].columnName).toBe('name');
    });

    it('spanner_list_named_schemas should return schema names', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_list_named_schemas');

      const result = (await tool!.runAsync({
        args: {},
        toolContext: {} as any,
      })) as {status: string; results: string[]};

      expect(result.status).toBe('SUCCESS');
      expect(result.results).toEqual(['my_schema']);
    });

    it('should handle errors gracefully', async () => {
      mockClient.executeQuery = vi
        .fn()
        .mockRejectedValue(new Error('Permission denied'));

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_list_table_names');

      const result = (await tool!.runAsync({
        args: {},
        toolContext: {} as any,
      })) as {status: string; error_details: string};

      expect(result.status).toBe('ERROR');
      expect(result.error_details).toBe('Permission denied');
    });
  });

  describe('execute_sql tool', () => {
    let toolset: SpannerToolset;
    let mockClient: SpannerClient;

    beforeEach(() => {
      mockClient = createMockClient();
      toolset = new SpannerToolset({
        projectId: 'test-project',
        instanceId: 'test-instance',
        databaseId: 'test-database',
        clientFactory: async () => mockClient,
      });
    });

    it('should execute SELECT queries', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_execute_sql');

      const result = (await tool!.runAsync({
        args: {query: 'SELECT * FROM my_table'},
        toolContext: {} as any,
      })) as {status: string; results: any};

      expect(result.status).toBe('SUCCESS');
      expect(result.results.rows).toHaveLength(1);
      expect(mockClient.executeQuery).toHaveBeenCalled();
    });

    it('should execute WITH (CTE) queries', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_execute_sql');

      const result = (await tool!.runAsync({
        args: {query: 'WITH cte AS (SELECT 1) SELECT * FROM cte'},
        toolContext: {} as any,
      })) as {status: string; results: any};

      expect(result.status).toBe('SUCCESS');
      expect(mockClient.executeQuery).toHaveBeenCalled();
    });

    it('should reject write queries', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_execute_sql');

      const result = (await tool!.runAsync({
        args: {query: 'INSERT INTO my_table VALUES (1, 2)'},
        toolContext: {} as any,
      })) as {status: string; error_details: string};

      expect(result.status).toBe('ERROR');
      expect(result.error_details).toContain('Only SELECT queries are allowed');
    });

    it('should report truncation when results are truncated', async () => {
      mockClient.executeQuery = vi.fn().mockResolvedValue({
        rows: [{col1: 'value1'}],
        resultIsLikelyTruncated: true,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_execute_sql');

      const result = (await tool!.runAsync({
        args: {query: 'SELECT * FROM my_table'},
        toolContext: {} as any,
      })) as {status: string; results: any};

      expect(result.status).toBe('SUCCESS');
      expect(result.results.result_is_likely_truncated).toBe(true);
    });

    it('should have appropriate description mentioning read-only', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_execute_sql');

      expect(tool!.description).toContain('read-only');
    });
  });

  describe('similarity_search tool', () => {
    let toolset: SpannerToolset;
    let mockClient: SpannerClient;

    beforeEach(() => {
      mockClient = createMockClient();
      toolset = new SpannerToolset({
        projectId: 'test-project',
        instanceId: 'test-instance',
        databaseId: 'test-database',
        clientFactory: async () => mockClient,
      });
    });

    it('should require exactly one embedding option', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_similarity_search');

      // No embedding options
      const result1 = (await tool!.runAsync({
        args: {
          table_name: 'vectors',
          query: 'test query',
          embedding_column_to_search: 'embedding',
          columns: ['content'],
          embedding_options: {},
        },
        toolContext: {} as any,
      })) as {status: string; error_details: string};

      expect(result1.status).toBe('ERROR');
      expect(result1.error_details).toContain('Exactly one embedding model option must be specified');

      // Multiple embedding options
      const result2 = (await tool!.runAsync({
        args: {
          table_name: 'vectors',
          query: 'test query',
          embedding_column_to_search: 'embedding',
          columns: ['content'],
          embedding_options: {
            vertexAiEmbeddingModelName: 'text-embedding-005',
            spannerGooglesqlEmbeddingModelName: 'model2',
          },
        },
        toolContext: {} as any,
      })) as {status: string; error_details: string};

      expect(result2.status).toBe('ERROR');
      expect(result2.error_details).toContain('Exactly one embedding model option must be specified');
    });

    it('should execute similarity search with Vertex AI model', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_similarity_search');

      const result = (await tool!.runAsync({
        args: {
          table_name: 'vectors',
          query: 'test query',
          embedding_column_to_search: 'embedding',
          columns: ['content', 'title'],
          embedding_options: {
            vertexAiEmbeddingModelName: 'text-embedding-005',
          },
        },
        toolContext: {} as any,
      })) as {status: string; results: any};

      expect(result.status).toBe('SUCCESS');
      expect(mockClient.executeQuery).toHaveBeenCalled();

      // Verify the query contains expected components
      const callArgs = (mockClient.executeQuery as any).mock.calls[0][0];
      expect(callArgs.query).toContain('text-embedding-005');
      expect(callArgs.query).toContain('COSINE_DISTANCE'); // Default distance type
      expect(callArgs.query).toContain('content, title');
    });

    it('should handle search options', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_similarity_search');

      await tool!.runAsync({
        args: {
          table_name: 'vectors',
          query: 'test query',
          embedding_column_to_search: 'embedding',
          columns: ['content'],
          embedding_options: {
            vertexAiEmbeddingModelName: 'text-embedding-005',
          },
          search_options: {
            topK: 10,
            distanceType: 'EUCLIDEAN',
          },
        },
        toolContext: {} as any,
      });

      const callArgs = (mockClient.executeQuery as any).mock.calls[0][0];
      expect(callArgs.query).toContain('EUCLIDEAN_DISTANCE');
      expect(callArgs.query).toContain('LIMIT 10');
    });
  });

  describe('vector_store_similarity_search tool', () => {
    it('should use pre-configured settings', async () => {
      const mockClient = createMockClient();
      const toolset = new SpannerToolset({
        projectId: 'test-project',
        instanceId: 'test-instance',
        databaseId: 'test-database',
        toolSettings: {
          vectorStoreSettings: {
            projectId: 'test-project',
            instanceId: 'test-instance',
            databaseId: 'test-database',
            tableName: 'my_vectors',
            contentColumn: 'text_content',
            embeddingColumn: 'vector_embedding',
            vectorLength: 768,
            vertexAiEmbeddingModelName: 'text-embedding-005',
            topK: 5,
            distanceType: 'DOT_PRODUCT',
          },
        },
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_vector_store_similarity_search');
      expect(tool).toBeDefined();

      const result = (await tool!.runAsync({
        args: {query: 'search query'},
        toolContext: {} as any,
      })) as {status: string; results: any};

      expect(result.status).toBe('SUCCESS');

      const callArgs = (mockClient.executeQuery as any).mock.calls[0][0];
      expect(callArgs.query).toContain('my_vectors');
      expect(callArgs.query).toContain('text-embedding-005');
      expect(callArgs.query).toContain('DOT_PRODUCT');
      expect(callArgs.query).toContain('LIMIT 5');
    });
  });

  describe('close', () => {
    it('should close client and clear cache', async () => {
      const mockClient = createMockClient();
      const toolset = new SpannerToolset({
        projectId: 'test-project',
        instanceId: 'test-instance',
        databaseId: 'test-database',
        clientFactory: async () => mockClient,
      });

      // Get tools and run one to create the client (client is lazily created)
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'spanner_list_table_names');
      await tool!.runAsync({args: {}, toolContext: {} as any});

      // Close
      await toolset.close();

      expect(mockClient.close).toHaveBeenCalled();

      // Getting tools again should work (tools are recreated)
      const newTools = await toolset.getTools();
      expect(newTools).toHaveLength(7);
    });
  });
});
