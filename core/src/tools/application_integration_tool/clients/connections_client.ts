/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleAuth} from 'google-auth-library';

import {logger} from '../../../utils/logger.js';

const CONNECTOR_URL = 'https://connectors.googleapis.com';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/**
 * Connection details returned by getConnectionDetails.
 */
export interface ConnectionDetails {
  /** Full resource name of the connection. */
  name: string;
  /** Service directory name for the connection. */
  serviceName: string;
  /** Host name for TLS service directory. */
  host: string;
  /** Whether auth override is enabled for the connection. */
  authOverrideEnabled: boolean;
}

/**
 * Action schema returned by getActionSchema.
 */
export interface ActionSchema {
  /** Input JSON schema for the action. */
  inputSchema: Record<string, unknown>;
  /** Output JSON schema for the action. */
  outputSchema: Record<string, unknown>;
  /** Description of the action. */
  description: string;
  /** Display name of the action. */
  displayName: string;
}

/**
 * Options for creating a ConnectionsClient.
 */
export interface ConnectionsClientOptions {
  /** The Google Cloud project ID. */
  project: string;
  /** The Google Cloud location (e.g., us-central1). */
  location: string;
  /** The connection name. */
  connection: string;
  /** Service account JSON string for authentication. */
  serviceAccountJson?: string;
}

/**
 * Utility class for interacting with Google Cloud Connectors API.
 *
 * This client fetches connection metadata, entity schemas, and action schemas
 * from the Connectors API for use with Application Integration tools.
 */
export class ConnectionsClient {
  private readonly project: string;
  private readonly location: string;
  private readonly connection: string;
  private readonly serviceAccountJson?: string;
  private auth: GoogleAuth | null = null;
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(options: ConnectionsClientOptions) {
    this.project = options.project;
    this.location = options.location;
    this.connection = options.connection;
    this.serviceAccountJson = options.serviceAccountJson;
  }

  /**
   * Retrieves service details for a given connection.
   *
   * @returns Connection details including name, service name, host, and auth override status.
   * @throws Error if there are credential issues or request errors.
   */
  async getConnectionDetails(): Promise<ConnectionDetails> {
    const url = `${CONNECTOR_URL}/v1/projects/${this.project}/locations/${this.location}/connections/${this.connection}?view=BASIC`;

    const response = await this.executeApiCall(url);
    const connectionData = await response.json();

    const connectionName = connectionData.name || '';
    let serviceName = connectionData.serviceDirectory || '';
    const host = connectionData.host || '';

    // If host is specified, use TLS service directory
    if (host) {
      serviceName = connectionData.tlsServiceDirectory || '';
    }

    const authOverrideEnabled = connectionData.authOverrideEnabled || false;

    return {
      name: connectionName,
      serviceName,
      host,
      authOverrideEnabled,
    };
  }

  /**
   * Retrieves the JSON schema and supported operations for a given entity.
   *
   * @param entity The entity name.
   * @returns A tuple of [schema, operations] where operations is a list of supported operations.
   * @throws Error if there are credential issues or request errors.
   */
  async getEntitySchemaAndOperations(
    entity: string
  ): Promise<[Record<string, unknown>, string[]]> {
    const url = `${CONNECTOR_URL}/v1/projects/${this.project}/locations/${this.location}/connections/${this.connection}/connectionSchemaMetadata:getEntityType?entityId=${entity}`;

    const apiResponse = await this.executeApiCall(url);
    const data = await apiResponse.json();
    const operationId = data.name;

    if (!operationId) {
      throw new Error(
        `Failed to get entity schema and operations for entity: ${entity}`
      );
    }

    const operationResponse = await this.pollOperation(operationId);

    const opResponseData = operationResponse.response as Record<string, unknown> | undefined;
    const schema = (opResponseData?.jsonSchema as Record<string, unknown>) || {};
    const operations = (opResponseData?.operations as string[]) || [];

    return [schema, operations];
  }

  /**
   * Retrieves the input and output JSON schema for a given action.
   *
   * @param action The action name.
   * @returns Action schema including input schema, output schema, description, and display name.
   * @throws Error if there are credential issues or request errors.
   */
  async getActionSchema(action: string): Promise<ActionSchema> {
    const url = `${CONNECTOR_URL}/v1/projects/${this.project}/locations/${this.location}/connections/${this.connection}/connectionSchemaMetadata:getAction?actionId=${action}`;

    const apiResponse = await this.executeApiCall(url);
    const data = await apiResponse.json();
    const operationId = data.name;

    if (!operationId) {
      throw new Error(`Failed to get action schema for action: ${action}`);
    }

    const operationResponse = await this.pollOperation(operationId);

    const opResponseData = operationResponse.response as Record<string, unknown> | undefined;
    const inputSchema = (opResponseData?.inputJsonSchema as Record<string, unknown>) || {};
    const outputSchema = (opResponseData?.outputJsonSchema as Record<string, unknown>) || {};
    const description = (opResponseData?.description as string) || '';
    const displayName = (opResponseData?.displayName as string) || '';

    return {
      inputSchema,
      outputSchema,
      description,
      displayName,
    };
  }

  /**
   * Returns the base OpenAPI spec template for connectors.
   */
  static getConnectorBaseSpec(): Record<string, unknown> {
    return {
      openapi: '3.0.1',
      info: {
        title: 'ExecuteConnection',
        description: 'This tool can execute a query on connection',
        version: '4',
      },
      servers: [{url: 'https://integrations.googleapis.com'}],
      security: [
        {google_auth: ['https://www.googleapis.com/auth/cloud-platform']},
      ],
      paths: {},
      components: {
        schemas: {
          operation: {
            type: 'string',
            default: 'LIST_ENTITIES',
            description:
              'Operation to execute. Possible values are LIST_ENTITIES, GET_ENTITY, CREATE_ENTITY, UPDATE_ENTITY, DELETE_ENTITY in case of entities. EXECUTE_ACTION in case of actions. and EXECUTE_QUERY in case of custom queries.',
          },
          entityId: {
            type: 'string',
            description: 'Name of the entity',
          },
          connectorInputPayload: {type: 'object'},
          filterClause: {
            type: 'string',
            default: '',
            description: 'WHERE clause in SQL query',
          },
          pageSize: {
            type: 'integer',
            default: 50,
            description: 'Number of entities to return in the response',
          },
          pageToken: {
            type: 'string',
            default: '',
            description: 'Page token to return the next page of entities',
          },
          connectionName: {
            type: 'string',
            default: '',
            description: 'Connection resource name to run the query for',
          },
          serviceName: {
            type: 'string',
            default: '',
            description: 'Service directory for the connection',
          },
          host: {
            type: 'string',
            default: '',
            description: 'Host name incase of tls service directory',
          },
          entity: {
            type: 'string',
            default: 'Issues',
            description: 'Entity to run the query for',
          },
          action: {
            type: 'string',
            default: 'ExecuteCustomQuery',
            description: 'Action to run the query for',
          },
          query: {
            type: 'string',
            default: '',
            description: 'Custom Query to execute on the connection',
          },
          dynamicAuthConfig: {
            type: 'object',
            default: {},
            description: 'Dynamic auth config for the connection',
          },
          timeout: {
            type: 'integer',
            default: 120,
            description: 'Timeout in seconds for execution of custom query',
          },
          sortByColumns: {
            type: 'array',
            items: {type: 'string'},
            default: [],
            description: 'Column to sort the results by',
          },
          connectorOutputPayload: {type: 'object'},
          nextPageToken: {type: 'string'},
          'execute-connector_Response': {
            required: ['connectorOutputPayload'],
            type: 'object',
            properties: {
              connectorOutputPayload: {
                $ref: '#/components/schemas/connectorOutputPayload',
              },
              nextPageToken: {
                $ref: '#/components/schemas/nextPageToken',
              },
            },
          },
        },
        securitySchemes: {
          google_auth: {
            type: 'oauth2',
            flows: {
              implicit: {
                authorizationUrl: 'https://accounts.google.com/o/oauth2/auth',
                scopes: {
                  'https://www.googleapis.com/auth/cloud-platform':
                    'Auth for google cloud services',
                },
              },
            },
          },
        },
      },
    };
  }

  /**
   * Creates an OpenAPI path object for an action operation.
   */
  static getActionOperation(
    action: string,
    operation: string,
    actionDisplayName: string,
    toolName: string = '',
    toolInstructions: string = ''
  ): Record<string, unknown> {
    let description = `Use this tool to execute ${action}`;
    if (operation === 'EXECUTE_QUERY') {
      description +=
        ' Use pageSize = 50 and timeout = 120 until user specifies a different value otherwise. If user provides a query in natural language, convert it to SQL query and then execute it using the tool.';
    }

    return {
      post: {
        summary: actionDisplayName,
        description: `${description} ${toolInstructions}`,
        operationId: `${toolName}_${actionDisplayName}`,
        'x-action': action,
        'x-operation': operation,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                $ref: `#/components/schemas/${actionDisplayName}_Request`,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Success response',
            content: {
              'application/json': {
                schema: {
                  $ref: `#/components/schemas/${actionDisplayName}_Response`,
                },
              },
            },
          },
        },
      },
    };
  }

  /**
   * Creates an OpenAPI path object for a LIST operation.
   */
  static listOperation(
    entity: string,
    schemaAsString: string = '',
    toolName: string = '',
    toolInstructions: string = ''
  ): Record<string, unknown> {
    return {
      post: {
        summary: `List ${entity}`,
        description: `Returns the list of ${entity} data. If the page token was available in the response, let users know there are more records available. Ask if the user wants to fetch the next page of results. When passing filter use the following format: \`field_name1='value1' AND field_name2='value2'\`. ${toolInstructions}`,
        'x-operation': 'LIST_ENTITIES',
        'x-entity': entity,
        operationId: `${toolName}_list_${entity}`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                $ref: `#/components/schemas/list_${entity}_Request`,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Success response',
            content: {
              'application/json': {
                schema: {
                  description: `Returns a list of ${entity} of json schema: ${schemaAsString}`,
                  $ref: '#/components/schemas/execute-connector_Response',
                },
              },
            },
          },
        },
      },
    };
  }

  /**
   * Creates an OpenAPI path object for a GET operation.
   */
  static getOperation(
    entity: string,
    schemaAsString: string = '',
    toolName: string = '',
    toolInstructions: string = ''
  ): Record<string, unknown> {
    return {
      post: {
        summary: `Get ${entity}`,
        description: `Returns the details of the ${entity}. ${toolInstructions}`,
        operationId: `${toolName}_get_${entity}`,
        'x-operation': 'GET_ENTITY',
        'x-entity': entity,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                $ref: `#/components/schemas/get_${entity}_Request`,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Success response',
            content: {
              'application/json': {
                schema: {
                  description: `Returns ${entity} of json schema: ${schemaAsString}`,
                  $ref: '#/components/schemas/execute-connector_Response',
                },
              },
            },
          },
        },
      },
    };
  }

  /**
   * Creates an OpenAPI path object for a CREATE operation.
   */
  static createOperation(
    entity: string,
    toolName: string = '',
    toolInstructions: string = ''
  ): Record<string, unknown> {
    return {
      post: {
        summary: `Creates a new ${entity}`,
        description: `Creates a new ${entity}. ${toolInstructions}`,
        'x-operation': 'CREATE_ENTITY',
        'x-entity': entity,
        operationId: `${toolName}_create_${entity}`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                $ref: `#/components/schemas/create_${entity}_Request`,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Success response',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/execute-connector_Response',
                },
              },
            },
          },
        },
      },
    };
  }

  /**
   * Creates an OpenAPI path object for an UPDATE operation.
   */
  static updateOperation(
    entity: string,
    toolName: string = '',
    toolInstructions: string = ''
  ): Record<string, unknown> {
    return {
      post: {
        summary: `Updates the ${entity}`,
        description: `Updates the ${entity}. ${toolInstructions}`,
        'x-operation': 'UPDATE_ENTITY',
        'x-entity': entity,
        operationId: `${toolName}_update_${entity}`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                $ref: `#/components/schemas/update_${entity}_Request`,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Success response',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/execute-connector_Response',
                },
              },
            },
          },
        },
      },
    };
  }

  /**
   * Creates an OpenAPI path object for a DELETE operation.
   */
  static deleteOperation(
    entity: string,
    toolName: string = '',
    toolInstructions: string = ''
  ): Record<string, unknown> {
    return {
      post: {
        summary: `Delete the ${entity}`,
        description: `Deletes the ${entity}. ${toolInstructions}`,
        'x-operation': 'DELETE_ENTITY',
        'x-entity': entity,
        operationId: `${toolName}_delete_${entity}`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                $ref: `#/components/schemas/delete_${entity}_Request`,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Success response',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/execute-connector_Response',
                },
              },
            },
          },
        },
      },
    };
  }

  /**
   * Creates a request schema for CREATE operation.
   */
  static createOperationRequest(entity: string): Record<string, unknown> {
    return {
      type: 'object',
      required: [
        'connectorInputPayload',
        'operation',
        'connectionName',
        'serviceName',
        'host',
        'entity',
      ],
      properties: {
        connectorInputPayload: {
          $ref: `#/components/schemas/connectorInputPayload_${entity}`,
        },
        operation: {$ref: '#/components/schemas/operation'},
        connectionName: {$ref: '#/components/schemas/connectionName'},
        serviceName: {$ref: '#/components/schemas/serviceName'},
        host: {$ref: '#/components/schemas/host'},
        entity: {$ref: '#/components/schemas/entity'},
        dynamicAuthConfig: {$ref: '#/components/schemas/dynamicAuthConfig'},
      },
    };
  }

  /**
   * Creates a request schema for UPDATE operation.
   */
  static updateOperationRequest(entity: string): Record<string, unknown> {
    return {
      type: 'object',
      required: [
        'connectorInputPayload',
        'entityId',
        'operation',
        'connectionName',
        'serviceName',
        'host',
        'entity',
      ],
      properties: {
        connectorInputPayload: {
          $ref: `#/components/schemas/connectorInputPayload_${entity}`,
        },
        entityId: {$ref: '#/components/schemas/entityId'},
        operation: {$ref: '#/components/schemas/operation'},
        connectionName: {$ref: '#/components/schemas/connectionName'},
        serviceName: {$ref: '#/components/schemas/serviceName'},
        host: {$ref: '#/components/schemas/host'},
        entity: {$ref: '#/components/schemas/entity'},
        dynamicAuthConfig: {$ref: '#/components/schemas/dynamicAuthConfig'},
        filterClause: {$ref: '#/components/schemas/filterClause'},
      },
    };
  }

  /**
   * Creates a request schema for GET operation.
   */
  static getOperationRequest(): Record<string, unknown> {
    return {
      type: 'object',
      required: [
        'entityId',
        'operation',
        'connectionName',
        'serviceName',
        'host',
        'entity',
      ],
      properties: {
        entityId: {$ref: '#/components/schemas/entityId'},
        operation: {$ref: '#/components/schemas/operation'},
        connectionName: {$ref: '#/components/schemas/connectionName'},
        serviceName: {$ref: '#/components/schemas/serviceName'},
        host: {$ref: '#/components/schemas/host'},
        entity: {$ref: '#/components/schemas/entity'},
        dynamicAuthConfig: {$ref: '#/components/schemas/dynamicAuthConfig'},
      },
    };
  }

  /**
   * Creates a request schema for DELETE operation.
   */
  static deleteOperationRequest(): Record<string, unknown> {
    return {
      type: 'object',
      required: [
        'entityId',
        'operation',
        'connectionName',
        'serviceName',
        'host',
        'entity',
      ],
      properties: {
        entityId: {$ref: '#/components/schemas/entityId'},
        operation: {$ref: '#/components/schemas/operation'},
        connectionName: {$ref: '#/components/schemas/connectionName'},
        serviceName: {$ref: '#/components/schemas/serviceName'},
        host: {$ref: '#/components/schemas/host'},
        entity: {$ref: '#/components/schemas/entity'},
        dynamicAuthConfig: {$ref: '#/components/schemas/dynamicAuthConfig'},
        filterClause: {$ref: '#/components/schemas/filterClause'},
      },
    };
  }

  /**
   * Creates a request schema for LIST operation.
   */
  static listOperationRequest(): Record<string, unknown> {
    return {
      type: 'object',
      required: [
        'operation',
        'connectionName',
        'serviceName',
        'host',
        'entity',
      ],
      properties: {
        filterClause: {$ref: '#/components/schemas/filterClause'},
        pageSize: {$ref: '#/components/schemas/pageSize'},
        pageToken: {$ref: '#/components/schemas/pageToken'},
        operation: {$ref: '#/components/schemas/operation'},
        connectionName: {$ref: '#/components/schemas/connectionName'},
        serviceName: {$ref: '#/components/schemas/serviceName'},
        host: {$ref: '#/components/schemas/host'},
        entity: {$ref: '#/components/schemas/entity'},
        sortByColumns: {$ref: '#/components/schemas/sortByColumns'},
        dynamicAuthConfig: {$ref: '#/components/schemas/dynamicAuthConfig'},
      },
    };
  }

  /**
   * Creates a request schema for an action.
   */
  static actionRequest(action: string): Record<string, unknown> {
    return {
      type: 'object',
      required: [
        'operation',
        'connectionName',
        'serviceName',
        'host',
        'action',
        'connectorInputPayload',
      ],
      properties: {
        operation: {$ref: '#/components/schemas/operation'},
        connectionName: {$ref: '#/components/schemas/connectionName'},
        serviceName: {$ref: '#/components/schemas/serviceName'},
        host: {$ref: '#/components/schemas/host'},
        action: {$ref: '#/components/schemas/action'},
        connectorInputPayload: {
          $ref: `#/components/schemas/connectorInputPayload_${action}`,
        },
        dynamicAuthConfig: {$ref: '#/components/schemas/dynamicAuthConfig'},
      },
    };
  }

  /**
   * Creates a response schema for an action.
   */
  static actionResponse(action: string): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        connectorOutputPayload: {
          $ref: `#/components/schemas/connectorOutputPayload_${action}`,
        },
      },
    };
  }

  /**
   * Creates a request schema for ExecuteCustomQuery action.
   */
  static executeCustomQueryRequest(): Record<string, unknown> {
    return {
      type: 'object',
      required: [
        'operation',
        'connectionName',
        'serviceName',
        'host',
        'action',
        'query',
        'timeout',
        'pageSize',
      ],
      properties: {
        operation: {$ref: '#/components/schemas/operation'},
        connectionName: {$ref: '#/components/schemas/connectionName'},
        serviceName: {$ref: '#/components/schemas/serviceName'},
        host: {$ref: '#/components/schemas/host'},
        action: {$ref: '#/components/schemas/action'},
        query: {$ref: '#/components/schemas/query'},
        timeout: {$ref: '#/components/schemas/timeout'},
        pageSize: {$ref: '#/components/schemas/pageSize'},
        dynamicAuthConfig: {$ref: '#/components/schemas/dynamicAuthConfig'},
      },
    };
  }

  /**
   * Converts a JSON schema to an OpenAPI schema.
   */
  connectorPayload(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    return this.convertJsonSchemaToOpenApiSchema(jsonSchema);
  }

  /**
   * Converts a JSON schema dictionary to an OpenAPI schema dictionary.
   * Handles variable types, properties, items, nullable, and description.
   */
  private convertJsonSchemaToOpenApiSchema(
    jsonSchema: Record<string, unknown>
  ): Record<string, unknown> {
    const openapiSchema: Record<string, unknown> = {};

    if (jsonSchema.description !== undefined) {
      openapiSchema.description = jsonSchema.description;
    }

    if (jsonSchema.type !== undefined) {
      const type = jsonSchema.type;
      if (Array.isArray(type)) {
        if (type.includes('null')) {
          openapiSchema.nullable = true;
          const otherTypes = type.filter((t) => t !== 'null');
          if (otherTypes.length > 0) {
            openapiSchema.type = otherTypes[0];
          }
        } else {
          openapiSchema.type = type[0];
        }
      } else {
        openapiSchema.type = type;
      }
    }

    if (
      openapiSchema.type === 'object' &&
      jsonSchema.properties !== undefined
    ) {
      const properties = jsonSchema.properties as Record<
        string,
        Record<string, unknown>
      >;
      openapiSchema.properties = {};
      for (const [propName, propSchema] of Object.entries(properties)) {
        (openapiSchema.properties as Record<string, unknown>)[propName] =
          this.convertJsonSchemaToOpenApiSchema(propSchema);
      }
    } else if (
      openapiSchema.type === 'array' &&
      jsonSchema.items !== undefined
    ) {
      const items = jsonSchema.items;
      if (Array.isArray(items)) {
        openapiSchema.items = items.map((item) =>
          this.convertJsonSchemaToOpenApiSchema(
            item as Record<string, unknown>
          )
        );
      } else {
        openapiSchema.items = this.convertJsonSchemaToOpenApiSchema(
          items as Record<string, unknown>
        );
      }
    }

    return openapiSchema;
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

  /**
   * Executes an API call to the given URL.
   */
  private async executeApiCall(url: string): Promise<Response> {
    try {
      const token = await this.getAccessToken();
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };

      const response = await fetch(url, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const status = response.status;
        if (status === 404 || status === 400) {
          throw new Error(
            `Invalid request. Please check the provided values of project(${this.project}), location(${this.location}), connection(${this.connection}).`
          );
        }
        throw new Error(`Request error: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      if (error instanceof Error && error.message.includes('credentials')) {
        throw new Error(`Credentials error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Polls an operation until it is done.
   */
  private async pollOperation(
    operationId: string
  ): Promise<Record<string, unknown>> {
    let operationDone = false;
    let operationResponse: Record<string, unknown> = {};

    while (!operationDone) {
      const getOperationUrl = `${CONNECTOR_URL}/v1/${operationId}`;
      const response = await this.executeApiCall(getOperationUrl);
      operationResponse = await response.json();
      operationDone = (operationResponse.done as boolean) || false;

      if (!operationDone) {
        // Wait 1 second before polling again
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return operationResponse;
  }
}
