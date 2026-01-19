/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration} from '@google/genai';
import {CallToolRequest, CallToolResult, Tool} from '@modelcontextprotocol/sdk/types.js';

import {ReadonlyContext} from '../../agents/readonly_context.js';
import {AuthCredential} from '../../auth/auth_credential.js';
import {AuthScheme} from '../../auth/auth_schemes.js';
import {AuthConfig} from '../../auth/auth_tool.js';
import {CredentialManager} from '../../auth/credential_manager.js';
import {toGeminiSchema} from '../../utils/gemini_schema_util.js';
import {logger} from '../../utils/logger.js';
import {BaseTool, RunAsyncToolRequest} from '../base_tool.js';
import {ToolContext} from '../tool_context.js';

import {getMcpAuthHeaders} from './mcp_auth_utils.js';
import {MCPSessionManager} from './mcp_session_manager.js';
import {HeaderProvider} from './mcp_toolset.js';

/**
 * Represents a tool exposed via the Model Context Protocol (MCP).
 *
 * This class acts as a wrapper around a tool definition received from an MCP
 * server. It translates the MCP tool's schema into a format compatible with
 * the Gemini AI platform (FunctionDeclaration) and handles the remote
 * execution of the tool by communicating with the MCP server through an
 * {@link MCPSessionManager}.
 *
 * When an LLM decides to call this tool, the `runAsync` method will be
 * invoked, which in turn establishes an MCP session, sends a `callTool`
 * request with the provided arguments, and returns the result from the
 * remote tool.
 */
export class MCPTool extends BaseTool {
  private readonly mcpTool: Tool;
  private readonly mcpSessionManager: MCPSessionManager;
  private readonly authScheme?: AuthScheme;
  private readonly authCredential?: AuthCredential;
  private readonly requireConfirmationValue?: boolean | ((args: unknown) => boolean | Promise<boolean>);
  private readonly headerProvider?: HeaderProvider;

  constructor(
    mcpTool: Tool,
    mcpSessionManager: MCPSessionManager,
    authScheme?: AuthScheme,
    authCredential?: AuthCredential,
    requireConfirmation?: boolean | ((args: unknown) => boolean | Promise<boolean>),
    headerProvider?: HeaderProvider,
  ) {
    super({name: mcpTool.name, description: mcpTool.description || ''});
    this.mcpTool = mcpTool;
    this.mcpSessionManager = mcpSessionManager;
    this.authScheme = authScheme;
    this.authCredential = authCredential;
    this.requireConfirmationValue = requireConfirmation;
    this.headerProvider = headerProvider;
  }

  override _getDeclaration(): FunctionDeclaration {
    let declaration: FunctionDeclaration;
    declaration = {
      name: this.mcpTool.name,
      description: this.mcpTool.description,
      parameters: toGeminiSchema(this.mcpTool.inputSchema),
      // TODO: need revisit, refer to this
      // https://modelcontextprotocol.io/specification/2025-06-18/server/tools#tool-result
      response: toGeminiSchema(this.mcpTool.outputSchema),
    };
    return declaration;
  }

  override async runAsync(request: RunAsyncToolRequest): Promise<unknown> {
    // Get merged headers for the session
    const headers = await this.getMergedHeaders(request.toolContext);
    const session = await this.mcpSessionManager.createSession(headers);

    const callRequest: CallToolRequest = {} as CallToolRequest;
    callRequest.params = {name: this.mcpTool.name, arguments: request.args};

    return await session.callTool(callRequest.params) as CallToolResult;
  }

  /**
   * Gets merged headers from header provider and auth scheme.
   *
   * @param context The context for header generation.
   * @returns Merged headers dictionary.
   */
  private async getMergedHeaders(
    context?: ReadonlyContext,
  ): Promise<Record<string, string>> {
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
          credentialKey: 'mcp_tool_credential',
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
            'Failed to resolve credential for MCP tool call, proceeding without auth headers.',
          );
        }
      } catch (e) {
        logger.warn(
          `Error generating auth headers for MCP tool call: ${e}, proceeding without auth headers.`,
        );
      }
    }

    // Merge provided headers and auth headers (auth headers take precedence)
    return {...providedHeaders, ...authHeaders};
  }
}

/**
 * Type guard to check if a context is a ToolContext (has invocationContext).
 */
function isToolContext(context: ReadonlyContext): context is ToolContext {
  return 'invocationContext' in context;
}
