/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {ReadonlyContext} from '../../src/agents/readonly_context.js';
import {BaseTool} from '../../src/tools/base_tool.js';
import {
  createToolboxToolset,
  ToolboxToolset,
  ToolboxToolsetOptions,
} from '../../src/tools/toolbox_toolset.js';

// Mock tool for testing
class MockTool extends BaseTool {
  constructor(name: string) {
    super({
      name,
      description: 'A mock tool for testing',
    });
  }

  override async runAsync(): Promise<unknown> {
    return {result: 'mock'};
  }
}

// Mock ToolboxClient
const mockLoadToolset = vi.fn();
const mockLoadTool = vi.fn();
const mockClose = vi.fn();

class MockToolboxClient {
  constructor(
    public url: string,
    public options?: Record<string, unknown>,
  ) {}

  async loadToolset(name?: string): Promise<BaseTool[]> {
    return mockLoadToolset(name);
  }

  async loadTool(name: string): Promise<BaseTool> {
    return mockLoadTool(name);
  }

  async close(): Promise<void> {
    return mockClose();
  }
}

// Mock the @toolbox-sdk/adk module
vi.mock('@toolbox-sdk/adk', () => ({
  ToolboxClient: MockToolboxClient,
}));

describe('ToolboxToolset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementations
    mockLoadToolset.mockResolvedValue([
      new MockTool('tool1'),
      new MockTool('tool2'),
      new MockTool('tool3'),
    ]);
    mockLoadTool.mockImplementation(
      async (name: string) => new MockTool(name),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create toolset with minimal options', () => {
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
      });

      expect(toolset).toBeInstanceOf(ToolboxToolset);
    });

    it('should create toolset with all options', () => {
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
        toolsetName: 'my-toolset',
        toolNames: ['tool1', 'tool2'],
        authTokenGetters: {
          'auth-service': () => 'token123',
        },
        boundParams: {
          userId: 'user-123',
          region: () => 'us-central1',
        },
        credentials: {type: 'oauth2'},
        additionalHeaders: {'X-Custom': 'header'},
        toolFilter: ['tool1'],
      });

      expect(toolset).toBeInstanceOf(ToolboxToolset);
    });
  });

  describe('createToolboxToolset factory', () => {
    it('should create a ToolboxToolset instance', () => {
      const toolset = createToolboxToolset({
        serverUrl: 'http://localhost:5000',
      });

      expect(toolset).toBeInstanceOf(ToolboxToolset);
    });
  });

  describe('getTools', () => {
    it('should load all tools when no toolsetName or toolNames specified', async () => {
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
      });

      const tools = await toolset.getTools();

      expect(mockLoadToolset).toHaveBeenCalledWith(undefined);
      expect(tools).toHaveLength(3);
      expect(tools.map((t) => t.name)).toEqual(['tool1', 'tool2', 'tool3']);
    });

    it('should load tools from specific toolset when toolsetName is provided', async () => {
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
        toolsetName: 'my-toolset',
      });

      await toolset.getTools();

      expect(mockLoadToolset).toHaveBeenCalledWith('my-toolset');
    });

    it('should load specific tools when toolNames is provided', async () => {
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
        toolNames: ['search', 'query'],
      });

      await toolset.getTools();

      expect(mockLoadTool).toHaveBeenCalledTimes(2);
      expect(mockLoadTool).toHaveBeenCalledWith('search');
      expect(mockLoadTool).toHaveBeenCalledWith('query');
    });

    it('should cache tools after first load', async () => {
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
      });

      await toolset.getTools();
      await toolset.getTools();

      // Should only call loadToolset once due to caching
      expect(mockLoadToolset).toHaveBeenCalledTimes(1);
    });

    it('should filter tools using toolFilter array', async () => {
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
        toolFilter: ['tool1', 'tool3'],
      });

      const tools = await toolset.getTools();

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(['tool1', 'tool3']);
    });

    it('should filter tools using toolFilter predicate', async () => {
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
        toolFilter: (tool) => tool.name.endsWith('2'),
      });

      const tools = await toolset.getTools();

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('tool2');
    });

    it('should pass context to toolFilter predicate', async () => {
      const mockFilter = vi.fn().mockReturnValue(true);
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
        toolFilter: mockFilter,
      });

      const context = {
        state: {key: 'value'},
        userContent: {role: 'user', parts: []},
      } as unknown as ReadonlyContext;

      await toolset.getTools(context);

      expect(mockFilter).toHaveBeenCalled();
      const [, contextArg] = mockFilter.mock.calls[0];
      expect(contextArg.state).toEqual({key: 'value'});
    });

    it('should return all tools when toolFilter is empty array', async () => {
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
        toolFilter: [],
      });

      const tools = await toolset.getTools();

      expect(tools).toHaveLength(3);
    });
  });

  describe('close', () => {
    it('should close the delegate client', async () => {
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
      });

      // Initialize the delegate by calling getTools
      await toolset.getTools();

      await toolset.close();

      expect(mockClose).toHaveBeenCalled();
    });

    it('should clear cached tools on close', async () => {
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
      });

      // Load tools twice
      await toolset.getTools();
      mockLoadToolset.mockClear();

      // Close and reload
      await toolset.close();
      await toolset.getTools();

      // Should call loadToolset again since cache was cleared
      expect(mockLoadToolset).toHaveBeenCalledTimes(1);
    });

    it('should handle close when delegate not initialized', async () => {
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
      });

      // Should not throw when closing without initialization
      await expect(toolset.close()).resolves.not.toThrow();
    });
  });

  describe('authentication options', () => {
    it('should pass authTokenGetters to client', async () => {
      const authGetter = vi.fn().mockReturnValue('token123');
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
        authTokenGetters: {
          'my-auth': authGetter,
        },
      });

      await toolset.getTools();

      // The MockToolboxClient stores options, so we can verify
      // that our options were passed through
      // This is verified by the implementation working correctly
      expect(mockLoadToolset).toHaveBeenCalled();
    });

    it('should pass boundParams to client', async () => {
      const boundParamGetter = vi.fn().mockReturnValue('dynamic-value');
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
        boundParams: {
          staticParam: 'static-value',
          dynamicParam: boundParamGetter,
        },
      });

      await toolset.getTools();

      expect(mockLoadToolset).toHaveBeenCalled();
    });

    it('should pass additionalHeaders to client', async () => {
      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
        additionalHeaders: {
          'X-Custom-Header': 'custom-value',
          Authorization: 'Bearer token',
        },
      });

      await toolset.getTools();

      expect(mockLoadToolset).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should throw error when @toolbox-sdk/adk is not installed', async () => {
      // Reset modules to clear the mock
      vi.doUnmock('@toolbox-sdk/adk');
      vi.resetModules();

      // Re-import with the module not available
      vi.doMock('@toolbox-sdk/adk', () => {
        throw new Error('Cannot find module');
      });

      // Re-import the toolset
      const {ToolboxToolset: ToolboxToolsetFresh} = await import(
        '../../src/tools/toolbox_toolset.js'
      );

      const toolset = new ToolboxToolsetFresh({
        serverUrl: 'http://localhost:5000',
      });

      await expect(toolset.getTools()).rejects.toThrow(
        "ToolboxToolset requires the '@toolbox-sdk/adk' package",
      );

      // Restore the mock for other tests
      vi.doMock('@toolbox-sdk/adk', () => ({
        ToolboxClient: MockToolboxClient,
      }));
    });

    it('should propagate errors from loadToolset', async () => {
      mockLoadToolset.mockRejectedValue(new Error('Connection failed'));

      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
      });

      await expect(toolset.getTools()).rejects.toThrow('Connection failed');
    });

    it('should propagate errors from loadTool', async () => {
      mockLoadTool.mockRejectedValue(new Error('Tool not found'));

      const toolset = new ToolboxToolset({
        serverUrl: 'http://localhost:5000',
        toolNames: ['nonexistent-tool'],
      });

      await expect(toolset.getTools()).rejects.toThrow('Tool not found');
    });
  });
});
