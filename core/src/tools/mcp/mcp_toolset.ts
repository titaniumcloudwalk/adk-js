/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ListToolsResult} from '@modelcontextprotocol/sdk/types.js';

import {ReadonlyContext} from '../../agents/readonly_context.js';
import {AuthCredential} from '../../auth/auth_credential.js';
import {AuthScheme} from '../../auth/auth_schemes.js';
import {AuthConfig} from '../../auth/auth_tool.js';
import {CredentialManager} from '../../auth/credential_manager.js';
import {logger} from '../../utils/logger.js';
import {BaseTool} from '../base_tool.js';
import {BaseToolset, ToolPredicate} from '../base_toolset.js';
import {ToolContext} from '../tool_context.js';

import {getMcpAuthHeaders} from './mcp_auth_utils.js';
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
 * Options for creating an MCPToolset.
 */
export interface MCPToolsetOptions {
  /**
   * Connection parameters for the MCP server.
   */
  connectionParams: MCPConnectionParams;

  /**
   * Optional filter to select specific tools. Can be either a list of tool
   * names to include or a ToolPredicate function for custom filtering logic.
   */
  toolFilter?: ToolPredicate | string[];

  /**
   * Optional prefix to prepend to the names of all tools returned by this
   * toolset.
   */
  toolNamePrefix?: string;

  /**
   * Optional function to provide additional headers for MCP server calls.
   * The function receives the current context and returns headers to be merged
   * with any existing static headers.
   */
  headerProvider?: HeaderProvider;

  /**
   * The authentication scheme for tool calling.
   * Used to resolve credentials during tool listing.
   */
  authScheme?: AuthScheme;

  /**
   * The authentication credential for tool calling.
   * Used with authScheme to authenticate MCP requests.
   */
  authCredential?: AuthCredential;

  /**
   * Whether tools in this toolset require confirmation.
   * Can be a single boolean or a callable to apply to all tools.
   */
  requireConfirmation?: boolean | ((args: unknown) => boolean | Promise<boolean>);
}

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
 * **Authentication Support:**
 * The toolset supports authentication for both tool listing and tool execution.
 * You can provide `authScheme` and `authCredential` parameters to enable
 * authenticated access to protected MCP servers.
 *
 * Usage:
 *   import { MCPToolset } from '@google/adk';
 *   import { StreamableHTTPConnectionParamsSchema } from '@google/adk';
 *
 *   // Basic usage without auth
 *   const mcpToolset = new MCPToolset({
 *     connectionParams: {
 *       type: "StreamableHTTPConnectionParams",
 *       url: "http://localhost:8788/mcp"
 *     }
 *   });
 *
 *   // With authentication
 *   const authenticatedToolset = new MCPToolset({
 *     connectionParams: {
 *       type: "StreamableHTTPConnectionParams",
 *       url: "http://protected-server/mcp"
 *     },
 *     authScheme: {
 *       type: 'http',
 *       scheme: 'bearer'
 *     },
 *     authCredential: {
 *       authType: AuthCredentialTypes.HTTP,
 *       http: {
 *         scheme: 'bearer',
 *         credentials: { token: 'your-api-token' }
 *       }
 *     }
 *   });
 *
 *   const tools = await mcpToolset.getTools();
 */
export class MCPToolset extends BaseToolset {
  private readonly mcpSessionManager: MCPSessionManager;
  private readonly connectionParams: MCPConnectionParams;
  private readonly headerProvider?: HeaderProvider;
  private readonly authScheme?: AuthScheme;
  private readonly authCredential?: AuthCredential;
  private readonly requireConfirmation?: boolean | ((args: unknown) => boolean | Promise<boolean>);

  /**
   * Creates a new MCPToolset instance.
   *
   * @param options Configuration options for the toolset.
   *
   * @deprecated Use options object instead. The positional parameters signature
   *             will be removed in a future version.
   */
  constructor(options: MCPToolsetOptions);
  /**
   * @deprecated Use options object instead.
   */
  constructor(
      connectionParams: MCPConnectionParams,
      toolFilter?: ToolPredicate | string[],
      toolNamePrefix?: string,
      headerProvider?: HeaderProvider);
  constructor(
      optionsOrConnectionParams: MCPToolsetOptions | MCPConnectionParams,
      toolFilter?: ToolPredicate | string[],
      toolNamePrefix?: string,
      headerProvider?: HeaderProvider) {
    // Handle both old positional params and new options object
    let options: MCPToolsetOptions;
    if (isMCPToolsetOptions(optionsOrConnectionParams)) {
      options = optionsOrConnectionParams;
    } else {
      // Legacy positional parameters
      options = {
        connectionParams: optionsOrConnectionParams,
        toolFilter,
        toolNamePrefix,
        headerProvider,
      };
    }

    super(options.toolFilter ?? [], options.toolNamePrefix);
    this.connectionParams = options.connectionParams;
    this.headerProvider = options.headerProvider;
    this.authScheme = options.authScheme;
    this.authCredential = options.authCredential;
    this.requireConfirmation = options.requireConfirmation;
    this.mcpSessionManager = new MCPSessionManager(options.connectionParams);
  }

  async getTools(context?: ReadonlyContext): Promise<BaseTool[]> {
    // Get headers from the header provider if available
    let providedHeaders: Record<string, string> = {};
    if (this.headerProvider) {
      const result = this.headerProvider(context);
      providedHeaders = result instanceof Promise ? await result : result;
    }

    // Get auth headers if authScheme is configured
    let authHeaders: Record<string, string> = {};
    if (this.authScheme) {
      try {
        // Create AuthConfig for credential resolution
        const authConfig: AuthConfig = {
          authScheme: this.authScheme,
          rawAuthCredential: this.authCredential,
          credentialKey: 'mcp_toolset_credential',
        };

        // Try to resolve credential if we have a ToolContext
        let resolvedCredential: AuthCredential | undefined;

        if (context && isToolContext(context)) {
          const credentialManager = new CredentialManager(authConfig);
          resolvedCredential = await credentialManager.getAuthCredential(context);
        } else if (this.authCredential) {
          // Use the raw credential directly if no context for resolution
          resolvedCredential = this.authCredential;
        }

        if (resolvedCredential) {
          const headers = getMcpAuthHeaders(this.authScheme, resolvedCredential);
          if (headers) {
            authHeaders = headers;
          }
        } else {
          logger.warn(
            'Failed to resolve credential for MCP tool listing, proceeding without auth headers.',
          );
        }
      } catch (e) {
        logger.warn(
          `Error generating auth headers for MCP tool listing: ${e}, proceeding without auth headers.`,
        );
      }
    }

    // Merge provided headers and auth headers (auth headers take precedence)
    const mergedHeaders = {...providedHeaders, ...authHeaders};

    const session = await this.mcpSessionManager.createSession(mergedHeaders);

    const listResult = await session.listTools() as ListToolsResult;
    logger.debug(`number of tools: ${listResult.tools.length}`)
    for (const tool of listResult.tools) {
      logger.debug(`tool: ${tool.name}`)
    }

    // Filter tools based on tool filter
    const tools: BaseTool[] = [];
    for (const mcpTool of listResult.tools) {
      const tool = new MCPTool(
        mcpTool,
        this.mcpSessionManager,
        this.authScheme,
        this.authCredential,
        this.requireConfirmation,
        this.headerProvider,
      );
      if (!context || this.isToolSelected(tool, context)) {
        tools.push(tool);
      }
    }
    return tools;
  }

  async close(): Promise<void> {}
}

/**
 * Type guard to check if an object is MCPToolsetOptions.
 */
function isMCPToolsetOptions(obj: unknown): obj is MCPToolsetOptions {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'connectionParams' in obj &&
    typeof (obj as MCPToolsetOptions).connectionParams === 'object'
  );
}

/**
 * Type guard to check if a context is a ToolContext (has invocationContext).
 */
function isToolContext(context: ReadonlyContext): context is ToolContext {
  return 'invocationContext' in context;
}
