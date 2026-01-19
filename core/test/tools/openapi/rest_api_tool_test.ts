/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {OpenAPIV3} from 'openapi-types';

import {
  clearAllFeatureOverrides,
  FeatureName,
  overrideFeatureEnabled,
} from '../../../src/features/feature_registry.js';
import {RestApiTool} from '../../../src/tools/openapi/rest_api_tool.js';
import {OperationEndpoint} from '../../../src/tools/openapi/common.js';

describe('RestApiTool', () => {
  const mockEndpoint: OperationEndpoint = {
    baseUrl: 'https://api.example.com',
    path: '/users/{user_id}',
    method: 'get',
  };

  const mockOperation: OpenAPIV3.OperationObject = {
    operationId: 'getUser',
    summary: 'Get a user by ID',
    parameters: [
      {
        name: 'user_id',
        in: 'path',
        required: true,
        schema: {type: 'string'},
        description: 'The user ID',
      },
      {
        name: 'include_details',
        in: 'query',
        required: false,
        schema: {type: 'boolean'},
        description: 'Whether to include additional details',
      },
    ],
    responses: {
      '200': {
        description: 'Success',
      },
    },
  };

  beforeEach(() => {
    clearAllFeatureOverrides();
  });

  afterEach(() => {
    clearAllFeatureOverrides();
  });

  describe('_getDeclaration', () => {
    it('should return declaration with parameters when JSON_SCHEMA_FOR_FUNC_DECL is disabled', () => {
      // Ensure feature is disabled
      overrideFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL, false);

      const tool = new RestApiTool({
        name: 'get_user',
        description: 'Get a user by ID',
        endpoint: mockEndpoint,
        operation: mockOperation,
      });

      const declaration = tool._getDeclaration();

      expect(declaration.name).toBe('get_user');
      expect(declaration.description).toBe('Get a user by ID');
      expect(declaration.parameters).toBeDefined();
      expect(declaration.parametersJsonSchema).toBeUndefined();
    });

    it('should return declaration with parametersJsonSchema when JSON_SCHEMA_FOR_FUNC_DECL is enabled', () => {
      // Enable the feature
      overrideFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL, true);

      const tool = new RestApiTool({
        name: 'get_user',
        description: 'Get a user by ID',
        endpoint: mockEndpoint,
        operation: mockOperation,
      });

      const declaration = tool._getDeclaration();

      expect(declaration.name).toBe('get_user');
      expect(declaration.description).toBe('Get a user by ID');
      expect(declaration.parametersJsonSchema).toBeDefined();
      expect(declaration.parameters).toBeUndefined();

      // Verify the JSON schema structure
      const jsonSchema = declaration.parametersJsonSchema as Record<string, unknown>;
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.properties).toBeDefined();
    });

    it('should include all parameters in the JSON schema', () => {
      overrideFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL, true);

      const tool = new RestApiTool({
        name: 'get_user',
        description: 'Get a user by ID',
        endpoint: mockEndpoint,
        operation: mockOperation,
      });

      const declaration = tool._getDeclaration();
      const jsonSchema = declaration.parametersJsonSchema as Record<string, unknown>;
      const properties = jsonSchema.properties as Record<string, unknown>;

      expect(properties['user_id']).toBeDefined();
      expect(properties['include_details']).toBeDefined();
    });
  });

  describe('operationParser access', () => {
    it('should expose operationParser for internal use', () => {
      const tool = new RestApiTool({
        name: 'get_user',
        description: 'Get a user by ID',
        endpoint: mockEndpoint,
        operation: mockOperation,
      });

      expect(tool.operationParser).toBeDefined();
      expect(typeof tool.operationParser.getJsonSchema).toBe('function');
    });
  });
});
