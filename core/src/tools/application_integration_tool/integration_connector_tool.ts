/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration, Schema, Type} from '@google/genai';

import {AuthCredential} from '../../auth/auth_credential.js';
import {AuthScheme} from '../../auth/auth_schemes.js';
import {FeatureName, isFeatureEnabled} from '../../features/feature_registry.js';
import {logger} from '../../utils/logger.js';
import {BaseTool, RunAsyncToolRequest} from '../base_tool.js';
import {RestApiTool} from '../openapi/rest_api_tool.js';
import {ToolAuthHandler} from '../openapi/tool_auth_handler.js';
import {ToolContext} from '../tool_context.js';

/**
 * Fields that should be excluded from the function declaration.
 * These are auto-populated by the tool and shouldn't be shown to the user.
 */
const EXCLUDE_FIELDS = [
  'connection_name',
  'service_name',
  'host',
  'entity',
  'operation',
  'action',
  'dynamic_auth_config',
];

/**
 * Fields that should be marked as optional in the function declaration.
 */
const OPTIONAL_FIELDS = ['page_size', 'page_token', 'filter', 'sortByColumns'];

/**
 * Options for creating an IntegrationConnectorTool.
 */
export interface IntegrationConnectorToolOptions {
  /** The name of the tool. */
  name: string;
  /** A description of what the tool does. */
  description: string;
  /** The name of the Integration Connector connection. */
  connectionName: string;
  /** The hostname or IP address for the connection. */
  connectionHost: string;
  /** The specific service name within the host. */
  connectionServiceName: string;
  /** The Integration Connector entity being targeted. */
  entity?: string;
  /** The specific operation being performed on the entity. */
  operation: string;
  /** The action associated with the operation. */
  action?: string;
  /** The underlying RestApiTool instance. */
  restApiTool: RestApiTool;
  /** Optional authentication scheme. */
  authScheme?: AuthScheme;
  /** Optional authentication credential. */
  authCredential?: AuthCredential;
}

/**
 * A tool that wraps a RestApiTool to interact with Application Integration.
 *
 * This tool adds Application Integration specific context like connection
 * details, entity, operation, and action to the underlying REST API call
 * handled by RestApiTool. It prepares the arguments and then delegates the
 * actual API call execution to the contained RestApiTool instance.
 *
 * - Generates request params and body
 * - Attaches auth credentials to API call
 *
 * @example
 * ```typescript
 * // Each API operation in the spec will be turned into its own tool
 * const operations = new OpenApiSpecParser().parse(openapiSpecDict);
 * const tools = operations.map(o => RestApiTool.fromParsedOperation(o));
 * ```
 */
export class IntegrationConnectorTool extends BaseTool {
  private readonly connectionName: string;
  private readonly connectionHost: string;
  private readonly connectionServiceName: string;
  private readonly entity?: string;
  private readonly operation: string;
  private readonly action?: string;
  private readonly restApiTool: RestApiTool;
  private readonly authScheme?: AuthScheme;
  private readonly authCredential?: AuthCredential;

  constructor(options: IntegrationConnectorToolOptions) {
    // Gemini restricts the length of function name to be less than 64 characters
    super({
      name: options.name.substring(0, 60),
      description: options.description,
    });

    this.connectionName = options.connectionName;
    this.connectionHost = options.connectionHost;
    this.connectionServiceName = options.connectionServiceName;
    this.entity = options.entity;
    this.operation = options.operation;
    this.action = options.action;
    this.restApiTool = options.restApiTool;
    this.authScheme = options.authScheme;
    this.authCredential = options.authCredential;
  }

  /**
   * Returns the function declaration in the Gemini Schema format.
   * Filters out internal fields that are auto-populated.
   * If JSON_SCHEMA_FOR_FUNC_DECL feature is enabled, uses parametersJsonSchema
   * instead of converting to Gemini Schema format.
   */
  override _getDeclaration(): FunctionDeclaration {
    // Get the JSON schema from the RestApiTool's operation parser
    const schemaDict = this.restApiTool.operationParser.getJsonSchema();

    // Clone the schema to avoid modifying the original
    const filteredSchema = JSON.parse(JSON.stringify(schemaDict)) as Record<string, unknown>;

    // Remove excluded fields from properties
    if (filteredSchema.properties && typeof filteredSchema.properties === 'object') {
      const properties = filteredSchema.properties as Record<string, unknown>;
      for (const field of EXCLUDE_FIELDS) {
        delete properties[field];
      }
    }

    // Remove excluded and optional fields from required array
    if (filteredSchema.required && Array.isArray(filteredSchema.required)) {
      filteredSchema.required = (filteredSchema.required as string[]).filter(
        (field: string) =>
          !EXCLUDE_FIELDS.includes(field) && !OPTIONAL_FIELDS.includes(field)
      );
    }

    if (isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)) {
      return {
        name: this.name,
        description: this.description,
        parametersJsonSchema: filteredSchema,
      };
    }

    return {
      name: this.name,
      description: this.description,
      parameters: filteredSchema as Schema,
    };
  }

  /**
   * Extracts the access token from an HTTP auth credential.
   */
  private prepareDynamicEuc(authCredential: AuthCredential): string | null {
    if (
      authCredential?.http?.credentials?.token
    ) {
      return authCredential.http.credentials.token;
    }
    return null;
  }

  /**
   * Executes the tool with the provided arguments.
   */
  override async runAsync({
    args,
    toolContext,
  }: RunAsyncToolRequest): Promise<unknown> {
    // Prepare auth credentials
    const toolAuthHandler = ToolAuthHandler.fromToolContext(
      toolContext,
      this.authScheme,
      this.authCredential
    );

    const authResult = await toolAuthHandler.prepareAuthCredentials();

    if (authResult.state === 'pending') {
      return {
        pending: true,
        message: 'Needs your authorization to access your data.',
      };
    }

    // Create a copy of args to modify
    const modifiedArgs: Record<string, unknown> = {...args};

    // Attach parameters from auth into main parameters list
    if (authResult.authCredential) {
      const authCredentialToken = this.prepareDynamicEuc(
        authResult.authCredential
      );
      if (authCredentialToken) {
        modifiedArgs.dynamic_auth_config = {
          'oauth2_auth_code_flow.access_token': authCredentialToken,
        };
      } else {
        modifiedArgs.dynamic_auth_config = {
          'oauth2_auth_code_flow.access_token': {},
        };
      }
    }

    // Add connection context
    modifiedArgs.connection_name = this.connectionName;
    modifiedArgs.service_name = this.connectionServiceName;
    modifiedArgs.host = this.connectionHost;
    modifiedArgs.entity = this.entity || '';
    modifiedArgs.operation = this.operation;
    modifiedArgs.action = this.action || '';

    logger.info(
      `Running tool: ${this.name} with args: ${JSON.stringify(modifiedArgs)}`
    );

    return this.restApiTool.call({args: modifiedArgs, toolContext: toolContext!});
  }

  /**
   * Returns a string representation of the tool.
   */
  override toString(): string {
    return (
      `IntegrationConnectorTool(name="${this.name}", ` +
      `description="${this.description}", ` +
      `connectionName="${this.connectionName}", entity="${this.entity}", ` +
      `operation="${this.operation}", action="${this.action}")`
    );
  }

  /**
   * Returns a detailed representation of the tool.
   */
  toRepr(): string {
    return (
      `IntegrationConnectorTool(name="${this.name}", ` +
      `description="${this.description}", ` +
      `connectionName="${this.connectionName}", ` +
      `connectionHost="${this.connectionHost}", ` +
      `connectionServiceName="${this.connectionServiceName}", ` +
      `entity="${this.entity}", operation="${this.operation}", ` +
      `action="${this.action}", restApiTool=${this.restApiTool.toString()})`
    );
  }
}
