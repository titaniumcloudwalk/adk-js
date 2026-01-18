/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {OpenAPIV3} from 'openapi-types';

import {ReadonlyContext} from '../../agents/readonly_context.js';
import {
  AuthCredential,
  AuthCredentialTypes,
  ServiceAccount,
  ServiceAccountCredential,
} from '../../auth/auth_credential.js';
import {AuthScheme} from '../../auth/auth_schemes.js';
import {logger} from '../../utils/logger.js';
import {BaseTool} from '../base_tool.js';
import {BaseToolset, ToolPredicate} from '../base_toolset.js';
import {OpenApiSpecParser} from '../openapi/openapi_spec_parser.js';
import {OpenAPIToolset} from '../openapi/openapi_toolset.js';
import {RestApiTool} from '../openapi/rest_api_tool.js';

import {ConnectionDetails, ConnectionsClient} from './clients/connections_client.js';
import {IntegrationClient} from './clients/integration_client.js';
import {IntegrationConnectorTool} from './integration_connector_tool.js';

/**
 * Options for creating an ApplicationIntegrationToolset.
 */
export interface ApplicationIntegrationToolsetOptions {
  /** The GCP project ID. */
  project: string;
  /** The GCP location (e.g., us-central1). */
  location: string;
  /** Overrides `ExecuteConnection` default integration name. */
  connectionTemplateOverride?: string;
  /** The integration name. */
  integration?: string;
  /** The list of trigger names in the integration. */
  triggers?: string[];
  /** The connection name. */
  connection?: string;
  /** The entity operations supported by the connection. Map of entity name to operations. */
  entityOperations?: Record<string, string[]>;
  /** The actions supported by the connection. */
  actions?: string[];
  /** The name prefix of the generated tools. */
  toolNamePrefix?: string;
  /** The instructions for the tool. */
  toolInstructions?: string;
  /** Service account JSON string for authentication. */
  serviceAccountJson?: string;
  /** Optional authentication scheme for connection. */
  authScheme?: AuthScheme;
  /** Optional authentication credential for connection. */
  authCredential?: AuthCredential;
  /** The filter used to filter the tools in the toolset. */
  toolFilter?: ToolPredicate | string[];
}

/**
 * ApplicationIntegrationToolset generates tools from a given Application
 * Integration or Integration Connector resource.
 *
 * @example
 * ```typescript
 * // Get all available tools for an integration with api trigger
 * const toolset = new ApplicationIntegrationToolset({
 *   project: 'test-project',
 *   location: 'us-central1',
 *   integration: 'test-integration',
 *   triggers: ['api_trigger/test_trigger'],
 *   serviceAccountJson: JSON.stringify(credentials),
 * });
 *
 * // Get all available tools for a connection using entity operations and actions
 * const toolset = new ApplicationIntegrationToolset({
 *   project: 'test-project',
 *   location: 'us-central1',
 *   connection: 'test-connection',
 *   entityOperations: {'Issues': ['LIST', 'CREATE'], 'Projects': []},
 *   // empty list means all operations on the entity are supported
 *   actions: ['action1'],
 *   serviceAccountJson: JSON.stringify(credentials),
 * });
 *
 * // Feed the toolset to agent
 * const agent = new LlmAgent({
 *   tools: [toolset],
 * });
 * ```
 */
export class ApplicationIntegrationToolset extends BaseToolset {
  private readonly project: string;
  private readonly location: string;
  private readonly connectionTemplateOverride?: string;
  private readonly integration?: string;
  private readonly triggers?: string[];
  private readonly connection?: string;
  private readonly entityOperations?: Record<string, string[]>;
  private readonly actions?: string[];
  private readonly toolInstructions?: string;
  private readonly serviceAccountJson?: string;
  private readonly authScheme?: AuthScheme;
  private readonly authCredential?: AuthCredential;

  private openApiToolset: OpenAPIToolset | null = null;
  private tools: IntegrationConnectorTool[] = [];
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: ApplicationIntegrationToolsetOptions) {
    super(options.toolFilter || [], options.toolNamePrefix);

    this.project = options.project;
    this.location = options.location;
    this.connectionTemplateOverride = options.connectionTemplateOverride;
    this.integration = options.integration;
    this.triggers = options.triggers;
    this.connection = options.connection;
    this.entityOperations = options.entityOperations;
    this.actions = options.actions;
    this.toolInstructions = options.toolInstructions || '';
    this.serviceAccountJson = options.serviceAccountJson;
    this.authScheme = options.authScheme;
    this.authCredential = options.authCredential;

    // Validate configuration
    if (!this.integration && !(this.connection && (this.entityOperations || this.actions))) {
      throw new Error(
        'Invalid request. Either integration or (connection and (entityOperations or actions)) should be provided.'
      );
    }
  }

  /**
   * Initializes the toolset by fetching specs and creating tools.
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInitialize();
    await this.initPromise;
    this.initialized = true;
  }

  private async doInitialize(): Promise<void> {
    const integrationClient = new IntegrationClient({
      project: this.project,
      location: this.location,
      connectionTemplateOverride: this.connectionTemplateOverride,
      integration: this.integration,
      triggers: this.triggers,
      connection: this.connection,
      entityOperations: this.entityOperations,
      actions: this.actions,
      serviceAccountJson: this.serviceAccountJson,
    });

    let connectionDetails: ConnectionDetails | undefined;
    let spec: Record<string, unknown>;

    if (this.integration) {
      // Integration mode: get OpenAPI spec directly
      spec = await integrationClient.getOpenApiSpecForIntegration();
    } else if (this.connection && (this.entityOperations || this.actions)) {
      // Connection mode: get connection details and generate spec
      const connectionsClient = new ConnectionsClient({
        project: this.project,
        location: this.location,
        connection: this.connection,
        serviceAccountJson: this.serviceAccountJson,
      });

      connectionDetails = await connectionsClient.getConnectionDetails();
      spec = await integrationClient.getOpenApiSpecForConnection(
        this.toolNamePrefix || '',
        this.toolInstructions || ''
      );
    } else {
      throw new Error(
        'Invalid request. Either integration or (connection and (entityOperations or actions)) should be provided.'
      );
    }

    await this.parseSpecToToolset(spec, connectionDetails);
  }

  /**
   * Parses the OpenAPI spec and creates tools.
   */
  private async parseSpecToToolset(
    specDict: Record<string, unknown>,
    connectionDetails?: ConnectionDetails
  ): Promise<void> {
    // Set up authentication
    let authScheme: AuthScheme;
    let authCredential: AuthCredential;

    if (this.serviceAccountJson) {
      // Use service account from JSON
      const saCredential = JSON.parse(this.serviceAccountJson) as ServiceAccountCredential;
      const serviceAccount: ServiceAccount = {
        serviceAccountCredential: saCredential,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      };

      // Create HTTP Bearer auth scheme and credential
      authScheme = {
        type: 'http',
        scheme: 'bearer',
      } as OpenAPIV3.HttpSecurityScheme;

      authCredential = {
        authType: AuthCredentialTypes.SERVICE_ACCOUNT,
        serviceAccount,
      };
    } else {
      // Use default credentials
      authCredential = {
        authType: AuthCredentialTypes.SERVICE_ACCOUNT,
        serviceAccount: {
          useDefaultCredential: true,
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        },
      };

      authScheme = {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      } as OpenAPIV3.HttpSecurityScheme;
    }

    if (this.integration) {
      // Integration mode: use OpenAPIToolset directly
      this.openApiToolset = new OpenAPIToolset({
        specDict: specDict as unknown as OpenAPIV3.Document,
        authCredential,
        authScheme,
        toolFilter: this.toolFilter,
      });
      return;
    }

    // Connection mode: parse spec and create IntegrationConnectorTools
    const parser = new OpenApiSpecParser();
    const operations = parser.parse(specDict as unknown as OpenAPIV3.Document);

    for (const openApiOperation of operations) {
      // Extract x-operation and x-entity/x-action from operation
      const operationObj = openApiOperation.operation as unknown as {
        'x-operation'?: string;
        'x-entity'?: string;
        'x-action'?: string;
      };

      const operation = operationObj['x-operation'] || '';
      const entity = operationObj['x-entity'];
      const action = operationObj['x-action'];

      // Create RestApiTool
      const restApiTool = RestApiTool.fromParsedOperation(openApiOperation);

      // Configure auth for the RestApiTool
      restApiTool.configureAuthScheme(authScheme);
      restApiTool.configureAuthCredential(authCredential);

      // Determine connector auth
      const authOverrideEnabled = connectionDetails?.authOverrideEnabled || false;

      let connectorAuthScheme: AuthScheme | undefined;
      let connectorAuthCredential: AuthCredential | undefined;

      if (this.authScheme && this.authCredential && !authOverrideEnabled) {
        // Case: Auth provided, but override is OFF. Don't use provided auth.
        logger.warn(
          'Authentication schema and credentials are not used because ' +
            'authOverrideEnabled is not enabled in the connection.'
        );
      } else {
        connectorAuthScheme = this.authScheme;
        connectorAuthCredential = this.authCredential;
      }

      this.tools.push(
        new IntegrationConnectorTool({
          name: restApiTool.name,
          description: restApiTool.description,
          connectionName: connectionDetails?.name || '',
          connectionHost: connectionDetails?.host || '',
          connectionServiceName: connectionDetails?.serviceName || '',
          entity,
          operation,
          action,
          restApiTool,
          authScheme: connectorAuthScheme,
          authCredential: connectorAuthCredential,
        })
      );
    }
  }

  /**
   * Returns the tools that should be exposed to LLM.
   */
  override async getTools(
    readonlyContext?: ReadonlyContext
  ): Promise<BaseTool[]> {
    await this.initialize();

    if (this.openApiToolset !== null) {
      return this.openApiToolset.getTools(readonlyContext);
    }

    return this.tools.filter((tool) =>
      this.isToolSelected(tool, readonlyContext as ReadonlyContext)
    );
  }

  /**
   * Closes the toolset and releases resources.
   */
  override async close(): Promise<void> {
    if (this.openApiToolset) {
      await this.openApiToolset.close();
    }
  }
}
