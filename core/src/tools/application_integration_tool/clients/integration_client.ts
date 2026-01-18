/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleAuth} from 'google-auth-library';

import {ConnectionsClient} from './connections_client.js';

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/**
 * Options for creating an IntegrationClient.
 */
export interface IntegrationClientOptions {
  /** The Google Cloud project ID. */
  project: string;
  /** The Google Cloud location (e.g., us-central1). */
  location: string;
  /** Overrides ExecuteConnection default integration name. */
  connectionTemplateOverride?: string;
  /** The integration name. */
  integration?: string;
  /** The list of trigger IDs for the integration. */
  triggers?: string[];
  /** The connection name. */
  connection?: string;
  /** A dictionary mapping entity names to a list of operations. */
  entityOperations?: Record<string, string[]>;
  /** List of actions. */
  actions?: string[];
  /** Service account JSON string for authentication. */
  serviceAccountJson?: string;
}

/**
 * A client for interacting with Google Cloud Application Integration.
 *
 * This class provides methods for retrieving OpenAPI spec for an integration
 * or a connection.
 */
export class IntegrationClient {
  private readonly project: string;
  private readonly location: string;
  private readonly connectionTemplateOverride?: string;
  private readonly integration?: string;
  private readonly triggers?: string[];
  private readonly connection?: string;
  private readonly entityOperations: Record<string, string[]>;
  private readonly actions: string[];
  private readonly serviceAccountJson?: string;
  private auth: GoogleAuth | null = null;
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;
  private quotaProjectId?: string;

  constructor(options: IntegrationClientOptions) {
    this.project = options.project;
    this.location = options.location;
    this.connectionTemplateOverride = options.connectionTemplateOverride;
    this.integration = options.integration;
    this.triggers = options.triggers;
    this.connection = options.connection;
    this.entityOperations = options.entityOperations || {};
    this.actions = options.actions || [];
    this.serviceAccountJson = options.serviceAccountJson;
  }

  /**
   * Gets the OpenAPI spec for the integration.
   *
   * @returns The OpenAPI spec as a dictionary.
   * @throws Error if there are credential issues or request errors.
   */
  async getOpenApiSpecForIntegration(): Promise<Record<string, unknown>> {
    const url = `https://${this.location}-integrations.googleapis.com/v1/projects/${this.project}/locations/${this.location}:generateOpenApiSpec`;

    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };

    // Add quota project header for default credentials
    if (!this.serviceAccountJson) {
      headers['x-goog-user-project'] = this.quotaProjectId || this.project;
    }

    const data = {
      apiTriggerResources: [
        {
          integrationResource: this.integration,
          triggerId: this.triggers,
        },
      ],
      fileFormat: 'JSON',
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 404 || status === 400) {
          throw new Error(
            `Invalid request. Please check the provided values of project(${this.project}), location(${this.location}), integration(${this.integration}).`
          );
        }
        throw new Error(`Request error: ${response.statusText}`);
      }

      const responseData = await response.json();
      const spec = responseData.openApiSpec || {};
      return JSON.parse(spec);
    } catch (error) {
      if (error instanceof Error && error.message.includes('credentials')) {
        throw new Error(`Credentials error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Gets the OpenAPI spec for the connection.
   *
   * @param toolName Optional tool name prefix.
   * @param toolInstructions Optional tool instructions.
   * @returns The OpenAPI spec as a dictionary.
   * @throws Error if there are credential issues or request errors.
   */
  async getOpenApiSpecForConnection(
    toolName: string = '',
    toolInstructions: string = ''
  ): Promise<Record<string, unknown>> {
    // Application Integration needs to be provisioned in the same region as
    // connection and an integration with name "ExecuteConnection" and trigger
    // "api_trigger/ExecuteConnection" should be created as per the documentation.
    const integrationName =
      this.connectionTemplateOverride || 'ExecuteConnection';

    const connectionsClient = new ConnectionsClient({
      project: this.project,
      location: this.location,
      connection: this.connection!,
      serviceAccountJson: this.serviceAccountJson,
    });

    if (
      Object.keys(this.entityOperations).length === 0 &&
      this.actions.length === 0
    ) {
      throw new Error(
        'No entity operations or actions provided. Please provide at least one of them.'
      );
    }

    const connectorSpec = ConnectionsClient.getConnectorBaseSpec() as {
      paths: Record<string, unknown>;
      components: {
        schemas: Record<string, unknown>;
      };
    };

    // Process entity operations
    for (const [entity, operations] of Object.entries(this.entityOperations)) {
      const [schema, supportedOperations] =
        await connectionsClient.getEntitySchemaAndOperations(entity);

      // Use supported operations if none specified
      const opsToProcess =
        operations.length > 0 ? operations : supportedOperations;

      const jsonSchemaAsString = JSON.stringify(schema);
      const entityLower = entity;

      // Add entity payload schema
      connectorSpec.components.schemas[
        `connectorInputPayload_${entityLower}`
      ] = connectionsClient.connectorPayload(schema);

      // Generate paths for each operation
      for (const operation of opsToProcess) {
        const operationLower = operation.toLowerCase();
        const path = `/v2/projects/${this.project}/locations/${this.location}/integrations/${integrationName}:execute?triggerId=api_trigger/${integrationName}#${operationLower}_${entityLower}`;

        switch (operationLower) {
          case 'create':
            connectorSpec.paths[path] = ConnectionsClient.createOperation(
              entityLower,
              toolName,
              toolInstructions
            );
            connectorSpec.components.schemas[`create_${entityLower}_Request`] =
              ConnectionsClient.createOperationRequest(entityLower);
            break;

          case 'update':
            connectorSpec.paths[path] = ConnectionsClient.updateOperation(
              entityLower,
              toolName,
              toolInstructions
            );
            connectorSpec.components.schemas[`update_${entityLower}_Request`] =
              ConnectionsClient.updateOperationRequest(entityLower);
            break;

          case 'delete':
            connectorSpec.paths[path] = ConnectionsClient.deleteOperation(
              entityLower,
              toolName,
              toolInstructions
            );
            connectorSpec.components.schemas[`delete_${entityLower}_Request`] =
              ConnectionsClient.deleteOperationRequest();
            break;

          case 'list':
            connectorSpec.paths[path] = ConnectionsClient.listOperation(
              entityLower,
              jsonSchemaAsString,
              toolName,
              toolInstructions
            );
            connectorSpec.components.schemas[`list_${entityLower}_Request`] =
              ConnectionsClient.listOperationRequest();
            break;

          case 'get':
            connectorSpec.paths[path] = ConnectionsClient.getOperation(
              entityLower,
              jsonSchemaAsString,
              toolName,
              toolInstructions
            );
            connectorSpec.components.schemas[`get_${entityLower}_Request`] =
              ConnectionsClient.getOperationRequest();
            break;

          default:
            throw new Error(
              `Invalid operation: ${operation} for entity: ${entity}`
            );
        }
      }
    }

    // Process actions
    for (const action of this.actions) {
      const actionDetails = await connectionsClient.getActionSchema(action);
      const inputSchema = actionDetails.inputSchema;
      const outputSchema = actionDetails.outputSchema;
      // Remove spaces from the display name to generate valid spec
      const actionDisplayName = actionDetails.displayName.replace(/ /g, '');

      let operation = 'EXECUTE_ACTION';
      if (action === 'ExecuteCustomQuery') {
        connectorSpec.components.schemas[`${actionDisplayName}_Request`] =
          ConnectionsClient.executeCustomQueryRequest();
        operation = 'EXECUTE_QUERY';
      } else {
        connectorSpec.components.schemas[`${actionDisplayName}_Request`] =
          ConnectionsClient.actionRequest(actionDisplayName);
        connectorSpec.components.schemas[
          `connectorInputPayload_${actionDisplayName}`
        ] = connectionsClient.connectorPayload(inputSchema);
      }

      connectorSpec.components.schemas[
        `connectorOutputPayload_${actionDisplayName}`
      ] = connectionsClient.connectorPayload(outputSchema);
      connectorSpec.components.schemas[`${actionDisplayName}_Response`] =
        ConnectionsClient.actionResponse(actionDisplayName);

      const path = `/v2/projects/${this.project}/locations/${this.location}/integrations/${integrationName}:execute?triggerId=api_trigger/${integrationName}#${action}`;
      connectorSpec.paths[path] = ConnectionsClient.getActionOperation(
        action,
        operation,
        actionDisplayName,
        toolName,
        toolInstructions
      );
    }

    return connectorSpec;
  }

  /**
   * Gets the access token for authentication.
   */
  private async getAccessToken(): Promise<string> {
    // Check cache first
    if (this.cachedToken && Date.now() < this.tokenExpiry) {
      return this.cachedToken;
    }

    if (this.serviceAccountJson) {
      // Use service account JSON
      const credentials = JSON.parse(this.serviceAccountJson);
      this.auth = new GoogleAuth({
        credentials,
        scopes: [CLOUD_PLATFORM_SCOPE],
      });
    } else {
      // Use application default credentials
      if (!this.auth) {
        this.auth = new GoogleAuth({
          scopes: [CLOUD_PLATFORM_SCOPE],
        });
      }

      // Try to get quota project ID from credentials
      try {
        const projectId = await this.auth.getProjectId();
        this.quotaProjectId = projectId;
      } catch {
        // Ignore - will use project from config
      }
    }

    const client = await this.auth.getClient();
    const tokenResponse = await client.getAccessToken();

    if (!tokenResponse.token) {
      throw new Error(
        'Please provide a service account that has the required permissions to access the connection.'
      );
    }

    // Cache token with 5-minute buffer before actual expiry
    this.cachedToken = tokenResponse.token;
    // Default to 1 hour expiry if not provided
    const expiryMs =
      tokenResponse.res?.data?.expires_in ?
        tokenResponse.res.data.expires_in * 1000 :
        3600000;
    this.tokenExpiry = Date.now() + expiryMs - 300000; // 5-minute buffer

    return tokenResponse.token;
  }
}
