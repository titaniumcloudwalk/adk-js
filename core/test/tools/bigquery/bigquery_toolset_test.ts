/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
  BigQueryClient,
  BigQueryToolConfig,
  BigQueryToolset,
  MINIMUM_BYTES_BILLED,
  validateBigQueryToolConfig,
  WriteMode,
} from '../../../src/tools/bigquery/index.js';

// Mock BigQuery client
function createMockClient(
  overrides: Partial<BigQueryClient> = {},
): BigQueryClient {
  return {
    projectId: 'test-project',
    location: 'US',
    query: vi.fn().mockResolvedValue({
      rows: [{col1: 'value1', col2: 'value2'}],
      totalRows: 1,
    }),
    getDataset: vi.fn().mockResolvedValue({
      datasetId: 'test-dataset',
      projectId: 'test-project',
      location: 'US',
      description: 'Test dataset',
    }),
    listDatasets: vi.fn().mockResolvedValue([
      {datasetId: 'dataset1', projectId: 'test-project'},
      {datasetId: 'dataset2', projectId: 'test-project'},
    ]),
    getTable: vi.fn().mockResolvedValue({
      tableId: 'test-table',
      datasetId: 'test-dataset',
      projectId: 'test-project',
      type: 'TABLE',
      schema: {
        fields: [
          {name: 'col1', type: 'STRING'},
          {name: 'col2', type: 'INTEGER'},
        ],
      },
      numRows: '100',
    }),
    listTables: vi.fn().mockResolvedValue([
      {tableId: 'table1', datasetId: 'test-dataset', projectId: 'test-project'},
      {tableId: 'table2', datasetId: 'test-dataset', projectId: 'test-project'},
    ]),
    getJob: vi.fn().mockResolvedValue({
      jobId: 'test-job',
      projectId: 'test-project',
      status: {state: 'DONE'},
    }),
    dryRunQuery: vi.fn().mockResolvedValue({
      totalBytesProcessed: 1000000,
      statementType: 'SELECT',
    }),
    createSession: vi.fn().mockResolvedValue({
      sessionId: 'test-session',
      location: 'US',
    }),
    ...overrides,
  };
}

describe('BigQueryToolset', () => {
  describe('validateBigQueryToolConfig', () => {
    it('should return defaults when no config provided', () => {
      const config = validateBigQueryToolConfig();
      expect(config.writeMode).toBe(WriteMode.BLOCKED);
      expect(config.maxQueryResultRows).toBe(50);
    });

    it('should accept valid configuration', () => {
      const config = validateBigQueryToolConfig({
        writeMode: WriteMode.PROTECTED,
        maxQueryResultRows: 100,
        maximumBytesBilled: 100000000,
        applicationName: 'test-app',
        location: 'US',
      });

      expect(config.writeMode).toBe(WriteMode.PROTECTED);
      expect(config.maxQueryResultRows).toBe(100);
      expect(config.maximumBytesBilled).toBe(100000000);
      expect(config.applicationName).toBe('test-app');
    });

    it('should reject maximumBytesBilled below minimum', () => {
      expect(() =>
        validateBigQueryToolConfig({
          maximumBytesBilled: 1000,
        }),
      ).toThrow(`maximumBytesBilled must be at least ${MINIMUM_BYTES_BILLED}`);
    });

    it('should reject applicationName with spaces', () => {
      expect(() =>
        validateBigQueryToolConfig({
          applicationName: 'my app name',
        }),
      ).toThrow('applicationName cannot contain spaces');
    });

    it('should reject empty jobLabels keys', () => {
      expect(() =>
        validateBigQueryToolConfig({
          jobLabels: {'': 'value'},
        }),
      ).toThrow('jobLabels keys cannot be empty strings');
    });
  });

  describe('getTools', () => {
    let toolset: BigQueryToolset;
    let mockClient: BigQueryClient;

    beforeEach(() => {
      mockClient = createMockClient();
      toolset = new BigQueryToolset({
        clientFactory: async () => mockClient,
      });
    });

    it('should return all 10 tools by default', async () => {
      const tools = await toolset.getTools();
      expect(tools).toHaveLength(10);

      const toolNames = tools.map((t) => t.name);
      // Metadata tools
      expect(toolNames).toContain('list_dataset_ids');
      expect(toolNames).toContain('get_dataset_info');
      expect(toolNames).toContain('list_table_ids');
      expect(toolNames).toContain('get_table_info');
      expect(toolNames).toContain('get_job_info');
      // Query tool
      expect(toolNames).toContain('execute_sql');
      // ML tools
      expect(toolNames).toContain('forecast');
      expect(toolNames).toContain('analyze_contribution');
      expect(toolNames).toContain('detect_anomalies');
      // Data insights tool
      expect(toolNames).toContain('ask_data_insights');
    });

    it('should filter tools by name array', async () => {
      toolset = new BigQueryToolset({
        toolFilter: ['list_dataset_ids', 'execute_sql'],
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      expect(tools).toHaveLength(2);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('list_dataset_ids');
      expect(toolNames).toContain('execute_sql');
    });

    it('should cache tools', async () => {
      const tools1 = await toolset.getTools();
      const tools2 = await toolset.getTools();
      expect(tools1).toBe(tools2);
    });
  });

  describe('metadata tools', () => {
    let toolset: BigQueryToolset;
    let mockClient: BigQueryClient;

    beforeEach(() => {
      mockClient = createMockClient();
      toolset = new BigQueryToolset({
        clientFactory: async () => mockClient,
      });
    });

    it('list_dataset_ids should return dataset IDs', async () => {
      const tools = await toolset.getTools();
      const listDatasetsTool = tools.find((t) => t.name === 'list_dataset_ids');
      expect(listDatasetsTool).toBeDefined();

      const result = (await listDatasetsTool!.runAsync({
        args: {},
        toolContext: {} as any,
      })) as {status: string; data: string[]};

      expect(result.status).toBe('SUCCESS');
      expect(result.data).toEqual(['dataset1', 'dataset2']);
    });

    it('get_dataset_info should return dataset metadata', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'get_dataset_info');

      const result = (await tool!.runAsync({
        args: {dataset_id: 'test-dataset'},
        toolContext: {} as any,
      })) as {status: string; data: any};

      expect(result.status).toBe('SUCCESS');
      expect(result.data.datasetId).toBe('test-dataset');
      expect(result.data.description).toBe('Test dataset');
    });

    it('list_table_ids should return table IDs', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'list_table_ids');

      const result = (await tool!.runAsync({
        args: {dataset_id: 'test-dataset'},
        toolContext: {} as any,
      })) as {status: string; data: string[]};

      expect(result.status).toBe('SUCCESS');
      expect(result.data).toEqual(['table1', 'table2']);
    });

    it('get_table_info should return table metadata with schema', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'get_table_info');

      const result = (await tool!.runAsync({
        args: {dataset_id: 'test-dataset', table_id: 'test-table'},
        toolContext: {} as any,
      })) as {status: string; data: any};

      expect(result.status).toBe('SUCCESS');
      expect(result.data.tableId).toBe('test-table');
      expect(result.data.schema.fields).toHaveLength(2);
    });

    it('get_job_info should return job metadata', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'get_job_info');

      const result = (await tool!.runAsync({
        args: {job_id: 'test-job'},
        toolContext: {} as any,
      })) as {status: string; data: any};

      expect(result.status).toBe('SUCCESS');
      expect(result.data.jobId).toBe('test-job');
      expect(result.data.status.state).toBe('DONE');
    });

    it('should handle errors gracefully', async () => {
      mockClient.listDatasets = vi
        .fn()
        .mockRejectedValue(new Error('Permission denied'));

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'list_dataset_ids');

      const result = (await tool!.runAsync({
        args: {},
        toolContext: {} as any,
      })) as {status: string; error_details: string};

      expect(result.status).toBe('ERROR');
      expect(result.error_details).toBe('Permission denied');
    });
  });

  describe('execute_sql tool', () => {
    it('should execute SELECT queries in BLOCKED mode', async () => {
      const mockClient = createMockClient();
      const toolset = new BigQueryToolset({
        toolConfig: {writeMode: WriteMode.BLOCKED},
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      const result = (await tool!.runAsync({
        args: {query: 'SELECT * FROM dataset.table'},
        toolContext: {} as any,
      })) as {status: string; data: any};

      expect(result.status).toBe('SUCCESS');
      expect(result.data.rows).toHaveLength(1);
      expect(mockClient.query).toHaveBeenCalled();
    });

    it('should reject write queries in BLOCKED mode', async () => {
      const mockClient = createMockClient();
      const toolset = new BigQueryToolset({
        toolConfig: {writeMode: WriteMode.BLOCKED},
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      const result = (await tool!.runAsync({
        args: {query: 'INSERT INTO dataset.table VALUES (1, 2)'},
        toolContext: {} as any,
      })) as {status: string; error_details: string};

      expect(result.status).toBe('ERROR');
      expect(result.error_details).toContain('Write operations are not allowed');
    });

    it('should allow write queries in ALLOWED mode', async () => {
      const mockClient = createMockClient();
      const toolset = new BigQueryToolset({
        toolConfig: {writeMode: WriteMode.ALLOWED},
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      const result = (await tool!.runAsync({
        args: {query: 'INSERT INTO dataset.table VALUES (1, 2)'},
        toolContext: {} as any,
      })) as {status: string; data: any};

      expect(result.status).toBe('SUCCESS');
      expect(mockClient.query).toHaveBeenCalled();
    });

    it('should perform dry run when requested', async () => {
      const mockClient = createMockClient();
      const toolset = new BigQueryToolset({
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      const result = (await tool!.runAsync({
        args: {query: 'SELECT * FROM dataset.table', dry_run: true},
        toolContext: {} as any,
      })) as {status: string; data: {bytes_processed: number}};

      expect(result.status).toBe('SUCCESS');
      expect(result.data.bytes_processed).toBe(1000000);
      expect(mockClient.dryRunQuery).toHaveBeenCalled();
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('should report truncation when results exceed limit', async () => {
      const mockClient = createMockClient({
        query: vi.fn().mockResolvedValue({
          rows: [{col1: 'value1'}],
          totalRows: 1000,
        }),
      });

      const toolset = new BigQueryToolset({
        toolConfig: {maxQueryResultRows: 50},
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      const result = (await tool!.runAsync({
        args: {query: 'SELECT * FROM dataset.table'},
        toolContext: {} as any,
      })) as {status: string; data: any};

      expect(result.status).toBe('SUCCESS');
      expect(result.data.result_is_likely_truncated).toBe(true);
      expect(result.data.total_rows).toBe(1000);
    });

    it('should pass configuration to query options', async () => {
      const mockClient = createMockClient();
      const toolset = new BigQueryToolset({
        toolConfig: {
          maximumBytesBilled: 100000000,
          location: 'EU',
          jobLabels: {team: 'data'},
          maxQueryResultRows: 25,
        },
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      await tool!.runAsync({
        args: {query: 'SELECT * FROM dataset.table'},
        toolContext: {} as any,
      });

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          maximumBytesBilled: 100000000,
          location: 'EU',
          jobLabels: {team: 'data'},
          maxResults: 25,
        }),
      );
    });

    it('should have appropriate description for BLOCKED mode', async () => {
      const toolset = new BigQueryToolset({
        toolConfig: {writeMode: WriteMode.BLOCKED},
        clientFactory: async () => createMockClient(),
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      expect(tool!.description).toContain('Only SELECT queries are allowed');
    });

    it('should have appropriate description for ALLOWED mode', async () => {
      const toolset = new BigQueryToolset({
        toolConfig: {writeMode: WriteMode.ALLOWED},
        clientFactory: async () => createMockClient(),
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      expect(tool!.description).toContain('read and write operations are allowed');
    });
  });

  describe('close', () => {
    it('should clear cached client and tools', async () => {
      const mockClient = createMockClient();
      const toolset = new BigQueryToolset({
        clientFactory: async () => mockClient,
      });

      // Get tools to populate cache
      await toolset.getTools();

      // Close
      await toolset.close();

      // Getting tools again should work (new client created)
      const tools = await toolset.getTools();
      expect(tools).toHaveLength(10);
    });
  });
});
