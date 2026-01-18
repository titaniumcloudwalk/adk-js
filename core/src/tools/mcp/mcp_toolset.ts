/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ListToolsResult} from '@modelcontextprotocol/sdk/types.js';

import {ReadonlyContext} from '../../agents/readonly_context.js';
import {logger} from '../../utils/logger.js';
import {BaseTool} from '../base_tool.js';
import {BaseToolset, ToolPredicate} from '../base_toolset.js';

import {MCPConnectionParams, MCPSessionManager} from './mcp_session_manager.js';
import {MCPTool} from './mcp_tool.js';

/**
 * Function type for providing dynamic headers for MCP server calls.
 * The function receives the current readonly context (if available) and should
 * return a dictionary of headers to be merged with any existing static headers.
 * Can be synchronous or asynchronous.
 */
export type HeaderProvider =
    (context?: ReadonlyContext) => Record<string, string> | Promise<Record<string, string>>;

/**
 * A toolset that dynamically discovers and provides tools from a Model Context
 * Protocol (MCP) server.
 *
 * This class connects to an MCP server, retrieves the list of available tools,
 * and wraps each of them in an {@link MCPTool} instance. This allows the agent
 * to seamlessly use tools from an external MCP-compliant service.
 *
 * The toolset can be configured with a filter to selectively expose a subset
 * of the tools provided by the MCP server.
 *
 * Usage:
 *   import { MCPToolset } from '@google/adk';
 *   import { StreamableHTTPConnectionParamsSchema } from '@google/adk';
 *
 *   const connectionParams = StreamableHTTPConnectionParamsSchema.parse({
 *     type: "StreamableHTTPConnectionParams",
 *     url: "http://localhost:8788/mcp"
 *   });
 *
 *   const mcpToolset = new MCPToolset(connectionParams);
 *   const tools = await mcpToolset.getTools();
 *
 */
export class MCPToolset extends BaseToolset {
  private readonly mcpSessionManager: MCPSessionManager;
  private readonly connectionParams: MCPConnectionParams;
  private readonly headerProvider?: HeaderProvider;

  /**
   * Creates a new MCPToolset instance.
   *
   * @param connectionParams Connection parameters for the MCP server.
   * @param toolFilter Optional filter to select specific tools. Can be either
   *     a list of tool names to include or a ToolPredicate function for custom
   *     filtering logic.
   * @param toolNamePrefix Optional prefix to prepend to the names of all tools
   *     returned by this toolset.
   * @param headerProvider Optional function to provide additional headers for
   *     MCP server calls. The function receives the current context and returns
   *     headers to be merged with any existing static headers.
   */
  constructor(
      connectionParams: MCPConnectionParams,
      toolFilter: ToolPredicate|string[] = [],
      toolNamePrefix?: string,
      headerProvider?: HeaderProvider) {
    super(toolFilter, toolNamePrefix);
    this.connectionParams = connectionParams;
    this.headerProvider = headerProvider;
    this.mcpSessionManager = new MCPSessionManager(connectionParams);
  }

  async getTools(context?: ReadonlyContext): Promise<BaseTool[]> {
    // Get headers from the header provider if available
    let providedHeaders: Record<string, string> = {};
    if (this.headerProvider) {
      const result = this.headerProvider(context);
      providedHeaders = result instanceof Promise ? await result : result;
    }

    const session = await this.mcpSessionManager.createSession(providedHeaders);

    const listResult = await session.listTools() as ListToolsResult;
    logger.debug(`number of tools: ${listResult.tools.length}`)
    for (const tool of listResult.tools) {
      logger.debug(`tool: ${tool.name}`)
    }

    // Filter tools based on tool filter
    const tools: BaseTool[] = [];
    for (const mcpTool of listResult.tools) {
      const tool = new MCPTool(mcpTool, this.mcpSessionManager);
      if (!context || this.isToolSelected(tool, context)) {
        tools.push(tool);
      }
    }
    return tools;
  }

  async close(): Promise<void> {}
}
