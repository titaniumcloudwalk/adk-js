/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {OpenAPIV3} from 'openapi-types';
import * as yaml from 'js-yaml';

import {ReadonlyContext} from '../../agents/readonly_context.js';
import {AuthCredential} from '../../auth/auth_credential.js';
import {AuthScheme} from '../../auth/auth_schemes.js';
import {logger} from '../../utils/logger.js';
import {BaseTool} from '../base_tool.js';
import {BaseToolset, ToolPredicate} from '../base_toolset.js';

import {OpenApiSpecParser} from './openapi_spec_parser.js';
import {RestApiTool} from './rest_api_tool.js';

/**
 * Parameters for creating an OpenAPIToolset.
 */
export interface OpenAPIToolsetParams {
  /**
   * The OpenAPI spec dictionary. If provided, it will be used
   * instead of parsing from a string.
   */
  specDict?: OpenAPIV3.Document;

  /**
   * The OpenAPI spec string in JSON or YAML format.
   * Used when specDict is not provided.
   */
  specStr?: string;

  /**
   * The type of the OpenAPI spec string. Can be "json" or "yaml".
   * @default "json"
   */
  specStrType?: 'json' | 'yaml';

  /**
   * The auth scheme to use for all tools.
   */
  authScheme?: AuthScheme;

  /**
   * The auth credential to use for all tools.
   */
  authCredential?: AuthCredential;

  /**
   * The filter used to filter the tools in the toolset.
   * Can be either a tool predicate or a list of tool names.
   */
  toolFilter?: ToolPredicate | string[];

  /**
   * The prefix to prepend to the names of the tools.
   * Useful when multiple OpenAPI specs have tools with similar names.
   */
  toolNamePrefix?: string;

  /**
   * SSL certificate verification option for all tools.
   */
  sslVerify?: boolean;

  /**
   * A callable that returns headers to be included in API requests.
   * Receives the ReadonlyContext as an argument for dynamic header generation.
   */
  headerProvider?: (context: ReadonlyContext) => Record<string, string>;
}

/**
 * Class for parsing OpenAPI spec into a list of RestApiTool.
 *
 * @example
 * ```typescript
 * // Initialize OpenAPI toolset from a spec string.
 * const openApiToolset = new OpenAPIToolset({
 *   specStr: openapiSpecStr,
 *   specStrType: 'json',
 * });
 *
 * // Or, initialize OpenAPI toolset from a spec dictionary.
 * const openApiToolset = new OpenAPIToolset({specDict: openapiSpecDict});
 *
 * // Add all tools to an agent.
 * const agent = new LlmAgent({
 *   tools: [...await openApiToolset.getTools()],
 * });
 *
 * // Or, add a single tool to an agent.
 * const agent = new LlmAgent({
 *   tools: [openApiToolset.getTool('tool_name')],
 * });
 * ```
 */
export class OpenAPIToolset extends BaseToolset {
  private readonly tools: RestApiTool[];
  private readonly toolNamePrefix?: string;
  private sslVerify?: boolean;
  private readonly headerProvider?: (
    context: ReadonlyContext
  ) => Record<string, string>;

  constructor(params: OpenAPIToolsetParams) {
    super(params.toolFilter || []);

    this.toolNamePrefix = params.toolNamePrefix;
    this.sslVerify = params.sslVerify;
    this.headerProvider = params.headerProvider;

    // Load or parse spec
    let specDict = params.specDict;
    if (!specDict && params.specStr) {
      specDict = this.loadSpec(params.specStr, params.specStrType || 'json');
    }

    if (!specDict) {
      throw new Error(
        'Either specDict or specStr must be provided to OpenAPIToolset'
      );
    }

    // Parse spec into tools
    this.tools = this.parse(specDict);

    // Configure auth for all tools if provided
    if (params.authScheme || params.authCredential) {
      this.configureAuthAll(params.authScheme, params.authCredential);
    }
  }

  /**
   * Configure auth scheme and credential for all tools.
   */
  private configureAuthAll(
    authScheme?: AuthScheme,
    authCredential?: AuthCredential
  ): void {
    for (const tool of this.tools) {
      if (authScheme) {
        tool.configureAuthScheme(authScheme);
      }
      if (authCredential) {
        tool.configureAuthCredential(authCredential);
      }
    }
  }

  /**
   * Configure SSL certificate verification for all tools.
   */
  configureSslVerifyAll(sslVerify?: boolean): void {
    this.sslVerify = sslVerify;
    // Note: SSL verification would need to be applied at request time
    // in Node.js environments using HTTPS agents
  }

  /**
   * Get all tools in the toolset.
   */
  override async getTools(
    readonlyContext?: ReadonlyContext
  ): Promise<RestApiTool[]> {
    return this.tools.filter((tool) =>
      this.isToolSelected(tool, readonlyContext as ReadonlyContext)
    );
  }

  /**
   * Get a tool by name.
   */
  getTool(toolName: string): RestApiTool | undefined {
    return this.tools.find((t) => t.name === toolName);
  }

  /**
   * Loads the OpenAPI spec string into a dictionary.
   */
  private loadSpec(
    specStr: string,
    specType: 'json' | 'yaml'
  ): OpenAPIV3.Document {
    if (specType === 'json') {
      return JSON.parse(specStr) as OpenAPIV3.Document;
    } else if (specType === 'yaml') {
      return yaml.load(specStr) as OpenAPIV3.Document;
    }
    throw new Error(`Unsupported spec type: ${specType}`);
  }

  /**
   * Parse OpenAPI spec into a list of RestApiTool.
   */
  private parse(openapiSpecDict: OpenAPIV3.Document): RestApiTool[] {
    const parser = new OpenApiSpecParser();
    const operations = parser.parse(openapiSpecDict);

    const tools: RestApiTool[] = [];
    for (const op of operations) {
      const tool = RestApiTool.fromParsedOperation(op, {
        sslVerify: this.sslVerify,
        headerProvider: this.headerProvider,
      });

      // Apply tool name prefix if configured
      if (this.toolNamePrefix) {
        // Create a new tool with prefixed name
        // Note: This is a simple approach; in production, you might want
        // a more robust way to rename tools
        const prefixedName = `${this.toolNamePrefix}_${tool.name}`.substring(
          0,
          60
        );
        Object.defineProperty(tool, 'name', {
          value: prefixedName,
          writable: false,
        });
      }

      logger.info(`Parsed tool: ${tool.name}`);
      tools.push(tool);
    }

    return tools;
  }

  /**
   * Closes the toolset.
   */
  override async close(): Promise<void> {
    // No resources to clean up
  }
}
