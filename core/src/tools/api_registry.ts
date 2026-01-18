/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleAuth} from 'google-auth-library';

import {ReadonlyContext} from '../agents/readonly_context.js';
import {logger} from '../utils/logger.js';

import {ToolPredicate} from './base_toolset.js';
import {HeaderProvider, MCPToolset} from './mcp/mcp_toolset.js';
import {StreamableHTTPConnectionParams} from './mcp/mcp_session_manager.js';

/**
 * URL for the Cloud API Registry service.
 */
const API_REGISTRY_URL = 'https://cloudapiregistry.googleapis.com';

/**
 * Represents an MCP server registered in API Registry.
 */
interface McpServer {
  name: string;
  urls?: string[];
  [key: string]: unknown;
}

/**
 * Response from listing MCP servers in API Registry.
 */
interface ListMcpServersResponse {
  mcpServers?: McpServer[];
  nextPageToken?: string;
}

/**
 * Options for creating an ApiRegistry instance.
 */
export interface ApiRegistryOptions {
  /**
   * The Google Cloud project ID for the API Registry.
   */
  apiRegistryProjectId: string;

  /**
   * The location of the API Registry resources. Defaults to 'global'.
   */
  location?: string;

  /**
   * Optional function to provide additional headers for MCP server calls.
   * Useful for passing project context headers to BigQuery or other services.
   */
  headerProvider?: HeaderProvider;
}

/**
 * Registry that provides MCPToolsets for MCP servers registered in API Registry.
 *
 * This class connects to the Google Cloud API Registry to discover available
 * MCP servers and provides MCPToolsets for interacting with them.
 *
 * Usage:
 * ```typescript
 * const registry = new ApiRegistry({
 *   apiRegistryProjectId: 'my-project',
 *   location: 'global',
 * });
 *
 * await registry.initialize();
 *
 * const toolset = registry.getToolset('my-mcp-server');
 * const tools = await toolset.getTools();
 * ```
 */
export class ApiRegistry {
  private readonly apiRegistryProjectId: string;
  private readonly location: string;
  private readonly auth: GoogleAuth;
  private readonly mcpServers: Map<string, McpServer>;
  private readonly headerProvider?: HeaderProvider;

  constructor(options: ApiRegistryOptions) {
    this.apiRegistryProjectId = options.apiRegistryProjectId;
    this.location = options.location || 'global';
    this.headerProvider = options.headerProvider;
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    this.mcpServers = new Map();
  }

  /**
   * Initializes the API Registry by fetching available MCP servers.
   *
   * This method must be called before using getToolset(). It connects to the
   * Cloud API Registry and fetches the list of available MCP servers with
   * pagination support.
   *
   * @throws Error if the API call fails or returns invalid data.
   */
  async initialize(): Promise<void> {
    const baseUrl =
        `${API_REGISTRY_URL}/v1beta/projects/${this.apiRegistryProjectId}/locations/${this.location}/mcpServers`;

    try {
      let pageToken: string | undefined = undefined;

      do {
        const url = new URL(baseUrl);
        if (pageToken) {
          url.searchParams.set('pageToken', pageToken);
        }

        const headers = await this.getAuthHeaders();
        headers['Content-Type'] = 'application/json';

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers,
        });

        if (!response.ok) {
          throw new Error(
              `API Registry request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as ListMcpServersResponse;
        const mcpServersList = data.mcpServers || [];

        for (const server of mcpServersList) {
          const serverName = server.name || '';
          if (serverName) {
            this.mcpServers.set(serverName, server);
            logger.debug(`Discovered MCP server: ${serverName}`);
          }
        }

        pageToken = data.nextPageToken;
      } while (pageToken);

      logger.info(
          `API Registry initialized with ${this.mcpServers.size} MCP servers`);
    } catch (error) {
      const errorMessage =
          error instanceof Error ? error.message : String(error);
      throw new Error(
          `Error fetching MCP servers from API Registry: ${errorMessage}`);
    }
  }

  /**
   * Returns an MCPToolset for the specified MCP server.
   *
   * @param mcpServerName The name of the MCP server to get tools from.
   * @param toolFilter Optional filter to select specific tools. Can be a list
   *     of tool names or a ToolPredicate function.
   * @param toolNamePrefix Optional prefix to prepend to the names of the tools
   *     returned by the toolset.
   * @returns An MCPToolset configured to connect to the specified MCP server.
   * @throws Error if the server is not found or has no URLs configured.
   */
  getToolset(
      mcpServerName: string,
      toolFilter?: ToolPredicate|string[],
      toolNamePrefix?: string,
      ): MCPToolset {
    const server = this.mcpServers.get(mcpServerName);
    if (!server) {
      throw new Error(
          `MCP server ${mcpServerName} not found in API Registry.`);
    }

    if (!server.urls || server.urls.length === 0) {
      throw new Error(`MCP server ${mcpServerName} has no URLs.`);
    }

    let mcpServerUrl = server.urls[0];

    // Only prepend "https://" if the URL doesn't already have a scheme
    if (!mcpServerUrl.startsWith('http://') &&
        !mcpServerUrl.startsWith('https://')) {
      mcpServerUrl = 'https://' + mcpServerUrl;
    }

    const connectionParams: StreamableHTTPConnectionParams = {
      type: 'StreamableHTTPConnectionParams',
      url: mcpServerUrl,
    };

    // Create async header provider that merges auth headers with custom headers
    const mergedHeaderProvider: HeaderProvider = async (
        context?: ReadonlyContext) => {
      const authHeaders = await this.getAuthHeaders();
      let customHeaders: Record<string, string> = {};
      if (this.headerProvider) {
        const result = this.headerProvider(context);
        customHeaders = result instanceof Promise ? await result : result;
      }
      return {...authHeaders, ...customHeaders};
    };

    return new MCPToolset(
        connectionParams,
        toolFilter || [],
        toolNamePrefix,
        mergedHeaderProvider,
    );
  }

  /**
   * Returns the list of discovered MCP server names.
   *
   * @returns An array of MCP server names available in the registry.
   */
  getServerNames(): string[] {
    return Array.from(this.mcpServers.keys());
  }

  /**
   * Refreshes credentials and returns authorization headers.
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const client = await this.auth.getClient();
    const accessToken = await client.getAccessToken();

    const headers: Record<string, string> = {};
    if (accessToken.token) {
      headers['Authorization'] = `Bearer ${accessToken.token}`;
    }

    // Add quota project header if available in credentials
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const credentials = client.credentials as any;
    const quotaProjectId = credentials?.quota_project_id;
    if (quotaProjectId) {
      headers['x-goog-user-project'] = quotaProjectId;
    }

    return headers;
  }
}
