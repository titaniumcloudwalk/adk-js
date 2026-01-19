/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ReadonlyContext} from '../agents/readonly_context.js';

import {BaseTool} from './base_tool.js';
import {BaseToolset, ToolPredicate} from './base_toolset.js';

/**
 * Function type that returns an authentication token string.
 * Used for providing auth tokens to tools that require authentication.
 */
export type AuthTokenGetter = () => string | Promise<string>;

/**
 * Function type that returns a bound parameter value.
 * Can return either a static value or be a function that produces values as needed.
 */
export type BoundParamValue<T = unknown> = T | (() => T | Promise<T>);

/**
 * Configuration options for tool credentials.
 * This is a placeholder interface that should match toolbox-adk's CredentialConfig.
 */
export interface ToolboxCredentialConfig {
  [key: string]: unknown;
}

/**
 * Configuration options for creating a ToolboxToolset.
 */
export interface ToolboxToolsetOptions {
  /**
   * The URL of the Toolbox server to connect to.
   */
  serverUrl: string;

  /**
   * Optional name of a specific toolset to load from the server.
   * If omitted, tools are loaded based on toolNames or all tools if both are omitted.
   */
  toolsetName?: string;

  /**
   * Optional list of specific tool names to load.
   * If omitted along with toolsetName, all tools are loaded by default.
   */
  toolNames?: string[];

  /**
   * Optional mapping of authentication service names to callables that return
   * the corresponding authentication token.
   *
   * @see https://github.com/googleapis/mcp-toolbox-sdk-python/tree/main/packages/toolbox-core#authenticating-tools
   */
  authTokenGetters?: Record<string, AuthTokenGetter>;

  /**
   * Optional mapping of parameter names to bind to specific values or callables.
   * Bound parameters are automatically provided to tools without needing to be
   * passed explicitly.
   *
   * @see https://github.com/googleapis/mcp-toolbox-sdk-python/tree/main/packages/toolbox-core#binding-parameter-values
   */
  boundParams?: Record<string, BoundParamValue>;

  /**
   * Optional credentials configuration for the toolbox.
   */
  credentials?: ToolboxCredentialConfig;

  /**
   * Optional static headers to include with all requests.
   */
  additionalHeaders?: Record<string, string>;

  /**
   * Optional filter to select specific tools. Can be either a list of tool
   * names to include or a ToolPredicate function for custom filtering logic.
   * This is applied after toolbox-level filtering (toolsetName, toolNames).
   */
  toolFilter?: ToolPredicate | string[];
}

// Type for the actual ToolboxClient from @toolbox-sdk/adk
interface ToolboxClientLike {
  loadToolset(name?: string): Promise<BaseTool[]>;
  loadTool(name: string): Promise<BaseTool>;
  close?(): Promise<void>;
}

/**
 * A toolset that provides access to tools from an MCP Toolbox server.
 *
 * MCP Toolbox for Databases is an open-source MCP server designed with
 * enterprise-grade and production-quality in mind. It enables easier, faster,
 * and more secure tool development by handling complexities such as connection
 * pooling, authentication, and more.
 *
 * This class wraps the `@toolbox-sdk/adk` package and delegates to its
 * `ToolboxClient` implementation.
 *
 * @example
 * ```typescript
 * import { ToolboxToolset } from '@google/adk';
 *
 * // Load all tools from the server
 * const toolset = new ToolboxToolset({
 *   serverUrl: 'http://127.0.0.1:5000',
 * });
 *
 * // Load a specific toolset
 * const toolset = new ToolboxToolset({
 *   serverUrl: 'http://127.0.0.1:5000',
 *   toolsetName: 'my-toolset',
 * });
 *
 * // Load specific tools by name
 * const toolset = new ToolboxToolset({
 *   serverUrl: 'http://127.0.0.1:5000',
 *   toolNames: ['search', 'query'],
 * });
 *
 * // With authentication
 * const toolset = new ToolboxToolset({
 *   serverUrl: 'http://127.0.0.1:5000',
 *   authTokenGetters: {
 *     'my-auth-service': () => getMyAuthToken(),
 *   },
 * });
 *
 * // With bound parameters
 * const toolset = new ToolboxToolset({
 *   serverUrl: 'http://127.0.0.1:5000',
 *   boundParams: {
 *     userId: () => getCurrentUserId(),
 *     region: 'us-central1',  // static value
 *   },
 * });
 * ```
 *
 * @see https://google.github.io/adk-docs/tools/google-cloud/mcp-toolbox-for-databases/
 */
export class ToolboxToolset extends BaseToolset {
  private readonly serverUrl: string;
  private readonly toolsetName?: string;
  private readonly toolNames?: string[];
  private readonly authTokenGetters?: Record<string, AuthTokenGetter>;
  private readonly boundParams?: Record<string, BoundParamValue>;
  private readonly credentials?: ToolboxCredentialConfig;
  private readonly additionalHeaders?: Record<string, string>;

  private delegate: ToolboxClientLike | undefined;
  private cachedTools: BaseTool[] | undefined;

  /**
   * Creates a new ToolboxToolset.
   *
   * @param options Configuration options for the toolset.
   * @throws {Error} If the `@toolbox-sdk/adk` package is not installed.
   */
  constructor(options: ToolboxToolsetOptions) {
    super(options.toolFilter ?? []);

    this.serverUrl = options.serverUrl;
    this.toolsetName = options.toolsetName;
    this.toolNames = options.toolNames;
    this.authTokenGetters = options.authTokenGetters;
    this.boundParams = options.boundParams;
    this.credentials = options.credentials;
    this.additionalHeaders = options.additionalHeaders;
  }

  /**
   * Lazily initializes the delegate ToolboxClient from @toolbox-sdk/adk.
   */
  private async ensureDelegate(): Promise<ToolboxClientLike> {
    if (this.delegate) {
      return this.delegate;
    }

    // Dynamic import to make @toolbox-sdk/adk an optional peer dependency
    let ToolboxClient: new (
      url: string,
      options?: {
        session?: unknown;
        headers?: Record<string, string>;
        authTokenGetters?: Record<string, AuthTokenGetter>;
        boundParams?: Record<string, BoundParamValue>;
        credentials?: ToolboxCredentialConfig;
      },
    ) => ToolboxClientLike;

    try {
      // Try @toolbox-sdk/adk first (the official package)
      // @ts-ignore - Optional peer dependency, may not be installed
      const toolboxAdk = await import('@toolbox-sdk/adk');
      ToolboxClient = toolboxAdk.ToolboxClient;
    } catch {
      throw new Error(
        "ToolboxToolset requires the '@toolbox-sdk/adk' package. " +
          "Please install it using `npm install @toolbox-sdk/adk`.",
      );
    }

    this.delegate = new ToolboxClient(this.serverUrl, {
      headers: this.additionalHeaders,
      authTokenGetters: this.authTokenGetters,
      boundParams: this.boundParams,
      credentials: this.credentials,
    });

    return this.delegate;
  }

  /**
   * Returns the tools from the Toolbox server.
   *
   * Tools are loaded based on the configuration:
   * - If `toolsetName` is provided, loads tools from that toolset
   * - If `toolNames` is provided, loads only those specific tools
   * - If neither is provided, loads all available tools
   *
   * The resulting tools are then further filtered by `toolFilter` if provided.
   *
   * @param context Context used to filter tools. If not defined, all matching
   *     tools are returned.
   * @returns A Promise that resolves to the list of tools.
   */
  override async getTools(context?: ReadonlyContext): Promise<BaseTool[]> {
    // Return cached tools if available
    if (this.cachedTools) {
      return this.filterTools(this.cachedTools, context);
    }

    const client = await this.ensureDelegate();
    let tools: BaseTool[];

    if (this.toolsetName) {
      // Load tools from a specific toolset
      tools = await client.loadToolset(this.toolsetName);
    } else if (this.toolNames && this.toolNames.length > 0) {
      // Load specific tools by name
      tools = await Promise.all(
        this.toolNames.map((name) => client.loadTool(name)),
      );
    } else {
      // Load all tools (default behavior when no parameters specified)
      tools = await client.loadToolset();
    }

    this.cachedTools = tools;
    return this.filterTools(tools, context);
  }

  /**
   * Filter tools based on the toolFilter configuration.
   */
  private filterTools(tools: BaseTool[], context?: ReadonlyContext): BaseTool[] {
    if (!this.toolFilter || (Array.isArray(this.toolFilter) && this.toolFilter.length === 0)) {
      return tools;
    }

    // Create a minimal context if none provided
    const readonlyContext = context ?? ({
      state: {},
      userContent: {role: 'user', parts: []},
      invocationContext: undefined,
      invocationId: '',
      agentName: '',
    } as unknown as ReadonlyContext);

    return tools.filter((tool) => this.isToolSelected(tool, readonlyContext));
  }

  /**
   * Closes the toolset and releases any resources held by the underlying
   * ToolboxClient.
   */
  override async close(): Promise<void> {
    if (this.delegate?.close) {
      await this.delegate.close();
    }
    this.delegate = undefined;
    this.cachedTools = undefined;
  }
}

/**
 * Factory function to create a ToolboxToolset.
 *
 * @param options Configuration options for the toolset.
 * @returns A new ToolboxToolset instance.
 *
 * @example
 * ```typescript
 * const toolset = createToolboxToolset({
 *   serverUrl: 'http://127.0.0.1:5000',
 *   toolsetName: 'my-toolset',
 * });
 * ```
 */
export function createToolboxToolset(
  options: ToolboxToolsetOptions,
): ToolboxToolset {
  return new ToolboxToolset(options);
}
