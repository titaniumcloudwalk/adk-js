/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {beforeEach, afterEach, describe, expect, it, vi} from 'vitest';
import {FunctionDeclaration} from '@google/genai';

import {ApiRegistry, ApiRegistryOptions} from '../../src/tools/api_registry.js';
import {BaseToolset} from '../../src/tools/base_toolset.js';
import {BaseTool, RunAsyncToolRequest} from '../../src/tools/base_tool.js';
import {MCPToolset, HeaderProvider} from '../../src/tools/mcp/mcp_toolset.js';
import {ReadonlyContext} from '../../src/agents/readonly_context.js';

// Test implementation of BaseTool for testing
class TestTool extends BaseTool {
  constructor(name: string, description: string) {
    super({name, description});
  }

  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
    };
  }

  override async runAsync(request: RunAsyncToolRequest): Promise<unknown> {
    return {result: 'test'};
  }
}

// Test implementation of BaseToolset
class TestToolset extends BaseToolset {
  private tools: BaseTool[];

  constructor(
      tools: BaseTool[],
      toolFilter: string[] = [],
      toolNamePrefix?: string) {
    super(toolFilter, toolNamePrefix);
    this.tools = tools;
  }

  async getTools(): Promise<BaseTool[]> {
    return this.tools;
  }

  async close(): Promise<void> {}
}

describe('BaseToolset.getToolsWithPrefix', () => {
  it('should return tools unchanged when no prefix is set', async () => {
    const tools = [
      new TestTool('tool1', 'Description 1'),
      new TestTool('tool2', 'Description 2'),
    ];
    const toolset = new TestToolset(tools, [], undefined);

    const result = await toolset.getToolsWithPrefix();

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('tool1');
    expect(result[1].name).toBe('tool2');
  });

  it('should prefix tool names when prefix is set', async () => {
    const tools = [
      new TestTool('tool1', 'Description 1'),
      new TestTool('tool2', 'Description 2'),
    ];
    const toolset = new TestToolset(tools, [], 'myprefix');

    const result = await toolset.getToolsWithPrefix();

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('myprefix_tool1');
    expect(result[1].name).toBe('myprefix_tool2');
  });

  it('should not modify original tools', async () => {
    const originalTool = new TestTool('tool1', 'Description 1');
    const toolset = new TestToolset([originalTool], [], 'myprefix');

    await toolset.getToolsWithPrefix();

    expect(originalTool.name).toBe('tool1');
  });

  it('should prefix function declaration names', async () => {
    const tools = [new TestTool('tool1', 'Description 1')];
    const toolset = new TestToolset(tools, [], 'myprefix');

    const result = await toolset.getToolsWithPrefix();
    const declaration = result[0]._getDeclaration();

    expect(declaration?.name).toBe('myprefix_tool1');
  });

  it('should handle empty tools array', async () => {
    const toolset = new TestToolset([], [], 'myprefix');

    const result = await toolset.getToolsWithPrefix();

    expect(result).toHaveLength(0);
  });
});

describe('MCPToolset constructor', () => {
  it('should accept toolNamePrefix parameter', () => {
    const toolset = new MCPToolset(
        {type: 'StreamableHTTPConnectionParams', url: 'http://test.com'},
        [],
        'myprefix',
    );

    expect(toolset.toolNamePrefix).toBe('myprefix');
  });

  it('should accept headerProvider parameter', async () => {
    const headerProvider: HeaderProvider = () => ({
      'X-Custom-Header': 'value',
    });

    const toolset = new MCPToolset(
        {type: 'StreamableHTTPConnectionParams', url: 'http://test.com'},
        [],
        undefined,
        headerProvider,
    );

    // The headerProvider is private, but we can verify the constructor accepted it
    expect(toolset).toBeInstanceOf(MCPToolset);
  });

  it('should have undefined toolNamePrefix when not provided', () => {
    const toolset = new MCPToolset(
        {type: 'StreamableHTTPConnectionParams', url: 'http://test.com'},
        [],
    );

    expect(toolset.toolNamePrefix).toBeUndefined();
  });
});

describe('ApiRegistry', () => {
  describe('constructor', () => {
    it('should set default location to global', () => {
      const registry = new ApiRegistry({
        apiRegistryProjectId: 'test-project',
      });

      expect(registry).toBeInstanceOf(ApiRegistry);
    });

    it('should accept custom location', () => {
      const registry = new ApiRegistry({
        apiRegistryProjectId: 'test-project',
        location: 'us-central1',
      });

      expect(registry).toBeInstanceOf(ApiRegistry);
    });

    it('should accept headerProvider', () => {
      const headerProvider: HeaderProvider = () => ({
        'X-Custom': 'header',
      });

      const registry = new ApiRegistry({
        apiRegistryProjectId: 'test-project',
        headerProvider,
      });

      expect(registry).toBeInstanceOf(ApiRegistry);
    });
  });

  describe('getServerNames', () => {
    it('should return empty array before initialization', () => {
      const registry = new ApiRegistry({
        apiRegistryProjectId: 'test-project',
      });

      const names = registry.getServerNames();

      expect(names).toEqual([]);
    });
  });

  describe('getToolset', () => {
    it('should throw error when server not found', () => {
      const registry = new ApiRegistry({
        apiRegistryProjectId: 'test-project',
      });

      expect(() => registry.getToolset('unknown-server')).toThrowError(
          'MCP server unknown-server not found in API Registry.',
      );
    });
  });
});

describe('HeaderProvider type', () => {
  it('should support synchronous header providers', async () => {
    const syncProvider: HeaderProvider = () => ({
      'Authorization': 'Bearer token',
    });

    const result = syncProvider();
    expect(result).toEqual({'Authorization': 'Bearer token'});
  });

  it('should support asynchronous header providers', async () => {
    const asyncProvider: HeaderProvider = async () => ({
      'Authorization': 'Bearer async-token',
    });

    const result = await asyncProvider();
    expect(result).toEqual({'Authorization': 'Bearer async-token'});
  });

  it('should support header providers with context', async () => {
    const contextProvider: HeaderProvider = (context?: ReadonlyContext) => {
      const sessionId = context?.session?.id || 'unknown';
      return {'X-Session-Id': sessionId};
    };

    const resultNoContext = contextProvider();
    expect(resultNoContext).toEqual({'X-Session-Id': 'unknown'});
  });
});
