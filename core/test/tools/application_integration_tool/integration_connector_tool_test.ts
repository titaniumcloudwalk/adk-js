/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {OpenAPIV3} from 'openapi-types';

import {
  clearAllFeatureOverrides,
  FeatureName,
  overrideFeatureEnabled,
} from '../../../src/features/feature_registry.js';
import {IntegrationConnectorTool} from '../../../src/tools/application_integration_tool/integration_connector_tool.js';
import {RestApiTool} from '../../../src/tools/openapi/rest_api_tool.js';
import {OperationEndpoint} from '../../../src/tools/openapi/common.js';

describe('IntegrationConnectorTool', () => {
  const mockEndpoint: OperationEndpoint = {
    baseUrl: 'https://connectors.googleapis.com',
    path: '/v1/connections/{connection_name}/entityTypes/{entity}/entities',
    method: 'post',
  };

  const mockOperation: OpenAPIV3.OperationObject = {
    operationId: 'createEntity',
    summary: 'Create an entity',
    parameters: [
      {
        name: 'connection_name',
        in: 'path',
        required: true,
        schema: {type: 'string'},
      },
      {
        name: 'entity',
        in: 'path',
        required: true,
        schema: {type: 'string'},
      },
      {
        name: 'service_name',
        in: 'query',
        required: true,
        schema: {type: 'string'},
      },
      {
        name: 'host',
        in: 'query',
        required: true,
        schema: {type: 'string'},
      },
      {
        name: 'operation',
        in: 'query',
        required: true,
        schema: {type: 'string'},
      },
      {
        name: 'action',
        in: 'query',
        required: false,
        schema: {type: 'string'},
      },
      {
        name: 'dynamic_auth_config',
        in: 'query',
        required: false,
        schema: {type: 'object'},
      },
      {
        name: 'page_size',
        in: 'query',
        required: false,
        schema: {type: 'integer'},
      },
      {
        name: 'page_token',
        in: 'query',
        required: false,
        schema: {type: 'string'},
      },
      {
        name: 'filter',
        in: 'query',
        required: false,
        schema: {type: 'string'},
      },
      {
        name: 'data_field',
        in: 'query',
        required: true,
        schema: {type: 'string'},
        description: 'User-facing data field',
      },
    ],
    responses: {
      '200': {
        description: 'Success',
      },
    },
  };

  let restApiTool: RestApiTool;

  beforeEach(() => {
    clearAllFeatureOverrides();
    restApiTool = new RestApiTool({
      name: 'create_entity',
      description: 'Create an entity',
      endpoint: mockEndpoint,
      operation: mockOperation,
    });
  });

  afterEach(() => {
    clearAllFeatureOverrides();
  });

  describe('_getDeclaration', () => {
    it('should return declaration with parameters when JSON_SCHEMA_FOR_FUNC_DECL is disabled', () => {
      overrideFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL, false);

      const tool = new IntegrationConnectorTool({
        name: 'integration_create_entity',
        description: 'Create an entity via Integration Connector',
        connectionName: 'my-connection',
        connectionHost: 'my-host.example.com',
        connectionServiceName: 'my-service',
        entity: 'users',
        operation: 'CREATE',
        restApiTool,
      });

      const declaration = tool._getDeclaration();

      expect(declaration.name).toBe('integration_create_entity');
      expect(declaration.description).toBe('Create an entity via Integration Connector');
      expect(declaration.parameters).toBeDefined();
      expect(declaration.parametersJsonSchema).toBeUndefined();
    });

    it('should return declaration with parametersJsonSchema when JSON_SCHEMA_FOR_FUNC_DECL is enabled', () => {
      overrideFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL, true);

      const tool = new IntegrationConnectorTool({
        name: 'integration_create_entity',
        description: 'Create an entity via Integration Connector',
        connectionName: 'my-connection',
        connectionHost: 'my-host.example.com',
        connectionServiceName: 'my-service',
        entity: 'users',
        operation: 'CREATE',
        restApiTool,
      });

      const declaration = tool._getDeclaration();

      expect(declaration.name).toBe('integration_create_entity');
      expect(declaration.description).toBe('Create an entity via Integration Connector');
      expect(declaration.parametersJsonSchema).toBeDefined();
      expect(declaration.parameters).toBeUndefined();
    });

    it('should exclude internal fields from the declaration', () => {
      overrideFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL, true);

      const tool = new IntegrationConnectorTool({
        name: 'integration_create_entity',
        description: 'Create an entity via Integration Connector',
        connectionName: 'my-connection',
        connectionHost: 'my-host.example.com',
        connectionServiceName: 'my-service',
        entity: 'users',
        operation: 'CREATE',
        restApiTool,
      });

      const declaration = tool._getDeclaration();
      const jsonSchema = declaration.parametersJsonSchema as Record<string, unknown>;
      const properties = jsonSchema.properties as Record<string, unknown>;

      // These fields should be excluded
      expect(properties['connection_name']).toBeUndefined();
      expect(properties['service_name']).toBeUndefined();
      expect(properties['host']).toBeUndefined();
      expect(properties['entity']).toBeUndefined();
      expect(properties['operation']).toBeUndefined();
      expect(properties['action']).toBeUndefined();
      expect(properties['dynamic_auth_config']).toBeUndefined();

      // User-facing fields should be present
      expect(properties['data_field']).toBeDefined();
    });

    it('should remove optional fields from required array', () => {
      overrideFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL, true);

      const tool = new IntegrationConnectorTool({
        name: 'integration_create_entity',
        description: 'Create an entity via Integration Connector',
        connectionName: 'my-connection',
        connectionHost: 'my-host.example.com',
        connectionServiceName: 'my-service',
        entity: 'users',
        operation: 'CREATE',
        restApiTool,
      });

      const declaration = tool._getDeclaration();
      const jsonSchema = declaration.parametersJsonSchema as Record<string, unknown>;
      const required = jsonSchema.required as string[] | undefined;

      // Optional fields should not be in required
      if (required) {
        expect(required).not.toContain('page_size');
        expect(required).not.toContain('page_token');
        expect(required).not.toContain('filter');
        // Excluded fields should also not be in required
        expect(required).not.toContain('connection_name');
        expect(required).not.toContain('service_name');
        expect(required).not.toContain('host');
        expect(required).not.toContain('entity');
        expect(required).not.toContain('operation');
        expect(required).not.toContain('action');
      }
    });
  });

  describe('runAsync', () => {
    it('should add connection context to args', async () => {
      const callSpy = vi.spyOn(restApiTool, 'call').mockResolvedValue({success: true});

      const tool = new IntegrationConnectorTool({
        name: 'integration_create_entity',
        description: 'Create an entity via Integration Connector',
        connectionName: 'my-connection',
        connectionHost: 'my-host.example.com',
        connectionServiceName: 'my-service',
        entity: 'users',
        operation: 'CREATE',
        action: 'execute',
        restApiTool,
      });

      const mockToolContext = {
        invocationContext: {
          invocationId: 'test-id',
          session: {
            id: 'session-id',
            appName: 'test-app',
            state: {value: {}},
          },
        },
      } as any;

      await tool.runAsync({
        args: {data_field: 'test-value'},
        toolContext: mockToolContext,
      });

      expect(callSpy).toHaveBeenCalled();
      const callArgs = callSpy.mock.calls[0][0];
      expect(callArgs.args.connection_name).toBe('my-connection');
      expect(callArgs.args.service_name).toBe('my-service');
      expect(callArgs.args.host).toBe('my-host.example.com');
      expect(callArgs.args.entity).toBe('users');
      expect(callArgs.args.operation).toBe('CREATE');
      expect(callArgs.args.action).toBe('execute');
    });
  });
});
