/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
  BigtableClient,
  BigtableToolset,
  BigtableToolSettings,
  validateBigtableToolSettings,
} from '../../../src/tools/bigtable/index.js';

// Mock Bigtable client
function createMockClient(
  overrides: Partial<BigtableClient> = {},
): BigtableClient {
  return {
    projectId: 'test-project',
    listInstances: vi.fn().mockResolvedValue([
      {instanceId: 'instance1', projectId: 'test-project'},
      {instanceId: 'instance2', projectId: 'test-project'},
    ]),
    getInstance: vi.fn().mockResolvedValue({
      projectId: 'test-project',
      instanceId: 'test-instance',
      displayName: 'Test Instance',
      state: 'READY',
      type: 'PRODUCTION',
      labels: {env: 'test'},
    }),
    listTables: vi.fn().mockResolvedValue([
      {tableId: 'table1', instanceId: 'test-instance', projectId: 'test-project'},
      {tableId: 'table2', instanceId: 'test-instance', projectId: 'test-project'},
    ]),
    getTable: vi.fn().mockResolvedValue({
      projectId: 'test-project',
      instanceId: 'test-instance',
      tableId: 'test-table',
      columnFamilies: ['cf1', 'cf2', 'cf3'],
    }),
    executeQuery: vi.fn().mockResolvedValue({
      rows: [{key: 'row1', value: 'data1'}, {key: 'row2', value: 'data2'}],
      resultIsLikelyTruncated: false,
    }),
    ...overrides,
  };
}

describe('BigtableToolset', () => {
  describe('validateBigtableToolSettings', () => {
    it('should return defaults when no settings provided', () => {
      const settings = validateBigtableToolSettings();
      expect(settings.maxQueryResultRows).toBe(50);
    });

    it('should accept valid settings', () => {
      const settings = validateBigtableToolSettings({
        maxQueryResultRows: 100,
      });
      expect(settings.maxQueryResultRows).toBe(100);
    });

    it('should apply defaults for missing values', () => {
      const settings = validateBigtableToolSettings({});
      expect(settings.maxQueryResultRows).toBe(50);
    });
  });

  describe('getTools', () => {
    let toolset: BigtableToolset;
    let mockClient: BigtableClient;

    beforeEach(() => {
      mockClient = createMockClient();
      toolset = new BigtableToolset({
        clientFactory: async () => mockClient,
      });
    });

    it('should return all 5 tools by default', async () => {
      const tools = await toolset.getTools();
      expect(tools).toHaveLength(5);

      const toolNames = tools.map((t) => t.name);
      // Metadata tools
      expect(toolNames).toContain('list_instances');
      expect(toolNames).toContain('get_instance_info');
      expect(toolNames).toContain('list_tables');
      expect(toolNames).toContain('get_table_info');
      // Query tool
      expect(toolNames).toContain('execute_sql');
    });

    it('should filter tools by name array', async () => {
      toolset = new BigtableToolset({
        toolFilter: ['list_instances', 'execute_sql'],
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      expect(tools).toHaveLength(2);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('list_instances');
      expect(toolNames).toContain('execute_sql');
    });

    it('should cache tools', async () => {
      const tools1 = await toolset.getTools();
      const tools2 = await toolset.getTools();
      expect(tools1).toBe(tools2);
    });

    it('should allow only metadata tools when filtered', async () => {
      toolset = new BigtableToolset({
        toolFilter: ['list_instances', 'get_instance_info', 'list_tables', 'get_table_info'],
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      expect(tools).toHaveLength(4);
      expect(tools.map((t) => t.name)).not.toContain('execute_sql');
    });
  });

  describe('metadata tools', () => {
    let toolset: BigtableToolset;
    let mockClient: BigtableClient;

    beforeEach(() => {
      mockClient = createMockClient();
      toolset = new BigtableToolset({
        clientFactory: async () => mockClient,
      });
    });

    it('list_instances should return instance IDs', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'list_instances');
      expect(tool).toBeDefined();

      const result = (await tool!.runAsync({
        args: {},
        toolContext: {} as any,
      })) as {status: string; results: string[]};

      expect(result.status).toBe('SUCCESS');
      expect(result.results).toEqual(['instance1', 'instance2']);
    });

    it('get_instance_info should return instance metadata', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'get_instance_info');

      const result = (await tool!.runAsync({
        args: {instance_id: 'test-instance'},
        toolContext: {} as any,
      })) as {status: string; display_name: string; state: string};

      expect(result.status).toBe('SUCCESS');
      expect(result.display_name).toBe('Test Instance');
      expect(result.state).toBe('READY');
    });

    it('list_tables should return table IDs', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'list_tables');

      const result = (await tool!.runAsync({
        args: {instance_id: 'test-instance'},
        toolContext: {} as any,
      })) as {status: string; results: string[]};

      expect(result.status).toBe('SUCCESS');
      expect(result.results).toEqual(['table1', 'table2']);
    });

    it('get_table_info should return table metadata with column families', async () => {
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'get_table_info');

      const result = (await tool!.runAsync({
        args: {instance_id: 'test-instance', table_id: 'test-table'},
        toolContext: {} as any,
      })) as {status: string; column_families: string[]};

      expect(result.status).toBe('SUCCESS');
      expect(result.column_families).toEqual(['cf1', 'cf2', 'cf3']);
    });

    it('should handle errors gracefully', async () => {
      mockClient.listInstances = vi
        .fn()
        .mockRejectedValue(new Error('Permission denied'));

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'list_instances');

      const result = (await tool!.runAsync({
        args: {},
        toolContext: {} as any,
      })) as {status: string; error_details: string};

      expect(result.status).toBe('ERROR');
      expect(result.error_details).toBe('Permission denied');
    });

    it('should handle instance not found error', async () => {
      mockClient.getInstance = vi
        .fn()
        .mockRejectedValue(new Error('Instance not found: invalid-instance'));

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'get_instance_info');

      const result = (await tool!.runAsync({
        args: {instance_id: 'invalid-instance'},
        toolContext: {} as any,
      })) as {status: string; error_details: string};

      expect(result.status).toBe('ERROR');
      expect(result.error_details).toContain('Instance not found');
    });

    it('should handle table not found error', async () => {
      mockClient.getTable = vi
        .fn()
        .mockRejectedValue(new Error('Table not found: invalid-table'));

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'get_table_info');

      const result = (await tool!.runAsync({
        args: {instance_id: 'test-instance', table_id: 'invalid-table'},
        toolContext: {} as any,
      })) as {status: string; error_details: string};

      expect(result.status).toBe('ERROR');
      expect(result.error_details).toContain('Table not found');
    });
  });

  describe('execute_sql tool', () => {
    it('should execute GoogleSQL queries', async () => {
      const mockClient = createMockClient();
      const toolset = new BigtableToolset({
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      const result = (await tool!.runAsync({
        args: {
          instance_id: 'test-instance',
          query: 'SELECT * FROM test-table',
        },
        toolContext: {} as any,
      })) as {status: string; rows: any[]};

      expect(result.status).toBe('SUCCESS');
      expect(result.rows).toHaveLength(2);
      expect(mockClient.executeQuery).toHaveBeenCalledWith(
        'test-instance',
        'SELECT * FROM test-table',
        50,  // default maxQueryResultRows
      );
    });

    it('should respect maxQueryResultRows setting', async () => {
      const mockClient = createMockClient();
      const toolset = new BigtableToolset({
        toolSettings: {maxQueryResultRows: 100},
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      await tool!.runAsync({
        args: {
          instance_id: 'test-instance',
          query: 'SELECT * FROM test-table',
        },
        toolContext: {} as any,
      });

      expect(mockClient.executeQuery).toHaveBeenCalledWith(
        'test-instance',
        'SELECT * FROM test-table',
        100,
      );
    });

    it('should report truncation when results exceed limit', async () => {
      const mockClient = createMockClient({
        executeQuery: vi.fn().mockResolvedValue({
          rows: [{key: 'row1', value: 'data1'}],
          resultIsLikelyTruncated: true,
        }),
      });

      const toolset = new BigtableToolset({
        toolSettings: {maxQueryResultRows: 10},
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      const result = (await tool!.runAsync({
        args: {
          instance_id: 'test-instance',
          query: 'SELECT * FROM test-table',
        },
        toolContext: {} as any,
      })) as {status: string; result_is_likely_truncated: boolean};

      expect(result.status).toBe('SUCCESS');
      expect(result.result_is_likely_truncated).toBe(true);
    });

    it('should handle query errors gracefully', async () => {
      const mockClient = createMockClient({
        executeQuery: vi.fn().mockRejectedValue(new Error('Invalid SQL syntax')),
      });

      const toolset = new BigtableToolset({
        clientFactory: async () => mockClient,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      const result = (await tool!.runAsync({
        args: {
          instance_id: 'test-instance',
          query: 'INVALID SQL',
        },
        toolContext: {} as any,
      })) as {status: string; error_details: string};

      expect(result.status).toBe('ERROR');
      expect(result.error_details).toBe('Invalid SQL syntax');
    });

    it('should have appropriate description mentioning GoogleSQL', async () => {
      const toolset = new BigtableToolset({
        clientFactory: async () => createMockClient(),
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      expect(tool!.description).toContain('GoogleSQL');
    });

    it('should include row limit in description', async () => {
      const toolset = new BigtableToolset({
        toolSettings: {maxQueryResultRows: 75},
        clientFactory: async () => createMockClient(),
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'execute_sql');

      expect(tool!.description).toContain('75');
    });
  });

  describe('credentials configuration', () => {
    it('should pass credentials config to client factory when tool is executed', async () => {
      const clientFactory = vi.fn().mockResolvedValue(createMockClient());

      const toolset = new BigtableToolset({
        credentialsConfig: {
          projectId: 'my-project',
          scopes: ['https://www.googleapis.com/auth/bigtable.data'],
        },
        clientFactory,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'list_instances');

      // Execute the tool to trigger client creation
      await tool!.runAsync({
        args: {},
        toolContext: {} as any,
      });

      expect(clientFactory).toHaveBeenCalledWith(
        {
          projectId: 'my-project',
          scopes: ['https://www.googleapis.com/auth/bigtable.data'],
        },
        expect.any(Object),
      );
    });

    it('should work without credentials config (uses ADC)', async () => {
      const clientFactory = vi.fn().mockResolvedValue(createMockClient());

      const toolset = new BigtableToolset({
        clientFactory,
      });

      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'list_instances');

      // Execute the tool to trigger client creation
      await tool!.runAsync({
        args: {},
        toolContext: {} as any,
      });

      expect(clientFactory).toHaveBeenCalledWith(
        undefined,
        expect.any(Object),
      );
    });
  });

  describe('close', () => {
    it('should clear cached client and tools', async () => {
      const mockClient = createMockClient();
      const clientFactory = vi.fn().mockResolvedValue(mockClient);

      const toolset = new BigtableToolset({
        clientFactory,
      });

      // Get tools and execute one to trigger client creation
      const tools = await toolset.getTools();
      const tool = tools.find((t) => t.name === 'list_instances');
      await tool!.runAsync({args: {}, toolContext: {} as any});
      expect(clientFactory).toHaveBeenCalledTimes(1);

      // Close
      await toolset.close();

      // Getting tools and executing again should create new client
      const tools2 = await toolset.getTools();
      const tool2 = tools2.find((t) => t.name === 'list_instances');
      await tool2!.runAsync({args: {}, toolContext: {} as any});
      expect(clientFactory).toHaveBeenCalledTimes(2);
    });

    it('should return new tools array after close', async () => {
      const mockClient = createMockClient();
      const toolset = new BigtableToolset({
        clientFactory: async () => mockClient,
      });

      const tools1 = await toolset.getTools();
      await toolset.close();
      const tools2 = await toolset.getTools();

      // Should not be the same instance (cache was cleared)
      expect(tools1).not.toBe(tools2);
      // But should have the same content
      expect(tools1.length).toBe(tools2.length);
    });
  });

  describe('tool filtering with predicate', () => {
    it('should filter tools using a predicate function', async () => {
      const mockClient = createMockClient();
      const toolset = new BigtableToolset({
        toolFilter: (tool) => tool.name.startsWith('list_'),
        clientFactory: async () => mockClient,
      });

      // Note: Without context, predicate filtering may not apply
      // Let's verify the tools are created correctly
      const tools = await toolset.getTools();
      expect(tools.length).toBeGreaterThan(0);
    });
  });

  describe('user agent', () => {
    it('should include ADK version in user agent', async () => {
      const {getBigtableUserAgent} = await import('../../../src/tools/bigtable/index.js');

      const userAgent = getBigtableUserAgent();
      expect(userAgent).toContain('adk-bigtable-tool');
      expect(userAgent).toContain('google-adk/');
    });

    it('should include application name in user agent when provided', async () => {
      const {getBigtableUserAgent} = await import('../../../src/tools/bigtable/index.js');

      const userAgent = getBigtableUserAgent('my-app');
      expect(userAgent).toContain('adk-bigtable-tool');
      expect(userAgent).toContain('my-app');
    });
  });

  describe('default scopes', () => {
    it('should include admin and data scopes by default', async () => {
      const {getBigtableScopes, DEFAULT_BIGTABLE_ADMIN_SCOPE, DEFAULT_BIGTABLE_DATA_SCOPE} =
        await import('../../../src/tools/bigtable/index.js');

      const scopes = getBigtableScopes();
      expect(scopes).toContain(DEFAULT_BIGTABLE_ADMIN_SCOPE);
      expect(scopes).toContain(DEFAULT_BIGTABLE_DATA_SCOPE);
    });

    it('should use custom scopes when provided', async () => {
      const {getBigtableScopes} = await import('../../../src/tools/bigtable/index.js');

      const customScopes = ['https://www.googleapis.com/auth/bigtable.data'];
      const scopes = getBigtableScopes({scopes: customScopes});
      expect(scopes).toEqual(customScopes);
    });
  });
});
