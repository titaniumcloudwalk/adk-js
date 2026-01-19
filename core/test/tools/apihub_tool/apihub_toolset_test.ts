/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, beforeEach} from 'vitest';

import {
  APIHubToolset,
  APIHubClient,
  BaseAPIHubClient,
} from '../../../src/tools/apihub_tool/index.js';

// Sample OpenAPI spec for testing
const SAMPLE_OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: {
    title: 'Test API',
    description: 'A test API for unit testing',
    version: '1.0.0',
  },
  servers: [
    {
      url: 'https://api.example.com',
    },
  ],
  paths: {
    '/users': {
      get: {
        operationId: 'getUsers',
        summary: 'Get all users',
        description: 'Returns a list of users',
        responses: {
          '200': {
            description: 'Successful response',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: {type: 'string'},
                      name: {type: 'string'},
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'createUser',
        summary: 'Create a user',
        description: 'Creates a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: {type: 'string'},
                  email: {type: 'string'},
                },
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'User created',
          },
        },
      },
    },
    '/users/{userId}': {
      get: {
        operationId: 'getUser',
        summary: 'Get a user by ID',
        parameters: [
          {
            name: 'userId',
            in: 'path',
            required: true,
            schema: {type: 'string'},
          },
        ],
        responses: {
          '200': {
            description: 'Successful response',
          },
        },
      },
    },
  },
};

/**
 * Mock API Hub client for testing.
 */
class MockAPIHubClient implements BaseAPIHubClient {
  private specContent: string;
  public getSpecContentCalled = false;
  public lastResourceName?: string;

  constructor(specContent: string = JSON.stringify(SAMPLE_OPENAPI_SPEC)) {
    this.specContent = specContent;
  }

  async getSpecContent(resourceName: string): Promise<string> {
    this.getSpecContentCalled = true;
    this.lastResourceName = resourceName;
    return this.specContent;
  }

  setSpecContent(content: string): void {
    this.specContent = content;
  }
}

describe('APIHubToolset', () => {
  describe('constructor', () => {
    it('should create an APIHubToolset with required options', () => {
      const mockClient = new MockAPIHubClient();
      const toolset = new APIHubToolset({
        apihubResourceName:
          'projects/test-project/locations/us-central1/apis/test-api',
        apihubClient: mockClient,
      });

      expect(toolset).toBeDefined();
      expect(toolset.name).toBe('');
      expect(toolset.description).toBe('');
    });

    it('should accept custom name and description', () => {
      const mockClient = new MockAPIHubClient();
      const toolset = new APIHubToolset({
        apihubResourceName:
          'projects/test-project/locations/us-central1/apis/test-api',
        apihubClient: mockClient,
        name: 'custom_name',
        description: 'Custom description',
      });

      expect(toolset.name).toBe('custom_name');
      expect(toolset.description).toBe('Custom description');
    });
  });

  describe('initialize', () => {
    it('should load spec and derive name/description from spec info', async () => {
      const mockClient = new MockAPIHubClient();
      const toolset = new APIHubToolset({
        apihubResourceName:
          'projects/test-project/locations/us-central1/apis/test-api',
        apihubClient: mockClient,
      });

      await toolset.initialize();

      expect(mockClient.getSpecContentCalled).toBe(true);
      expect(toolset.name).toBe('test_api');
      expect(toolset.description).toBe('A test API for unit testing');
    });

    it('should not override custom name and description', async () => {
      const mockClient = new MockAPIHubClient();
      const toolset = new APIHubToolset({
        apihubResourceName:
          'projects/test-project/locations/us-central1/apis/test-api',
        apihubClient: mockClient,
        name: 'my_custom_name',
        description: 'My custom description',
      });

      await toolset.initialize();

      expect(toolset.name).toBe('my_custom_name');
      expect(toolset.description).toBe('My custom description');
    });

    it('should only initialize once', async () => {
      const mockClient = new MockAPIHubClient();
      const toolset = new APIHubToolset({
        apihubResourceName:
          'projects/test-project/locations/us-central1/apis/test-api',
        apihubClient: mockClient,
      });

      await toolset.initialize();
      mockClient.getSpecContentCalled = false;
      await toolset.initialize();

      expect(mockClient.getSpecContentCalled).toBe(false);
    });
  });

  describe('getTools', () => {
    it('should return tools generated from the OpenAPI spec', async () => {
      const mockClient = new MockAPIHubClient();
      const toolset = new APIHubToolset({
        apihubResourceName:
          'projects/test-project/locations/us-central1/apis/test-api',
        apihubClient: mockClient,
      });

      const tools = await toolset.getTools();

      // The sample spec defines 3 operations: getUsers, createUser, getUser
      expect(tools.length).toBe(3);
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('get_users');
      expect(toolNames).toContain('create_user');
      expect(toolNames).toContain('get_user');
    });

    it('should automatically initialize on first getTools call', async () => {
      const mockClient = new MockAPIHubClient();
      const toolset = new APIHubToolset({
        apihubResourceName:
          'projects/test-project/locations/us-central1/apis/test-api',
        apihubClient: mockClient,
      });

      expect(mockClient.getSpecContentCalled).toBe(false);
      await toolset.getTools();
      expect(mockClient.getSpecContentCalled).toBe(true);
    });

    it('should filter tools by name when toolFilter is provided', async () => {
      const mockClient = new MockAPIHubClient();
      const toolset = new APIHubToolset({
        apihubResourceName:
          'projects/test-project/locations/us-central1/apis/test-api',
        apihubClient: mockClient,
        toolFilter: ['get_users'],
      });

      const tools = await toolset.getTools();

      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('get_users');
    });

    it('should filter tools by predicate when toolFilter is a function', async () => {
      const mockClient = new MockAPIHubClient();
      const toolset = new APIHubToolset({
        apihubResourceName:
          'projects/test-project/locations/us-central1/apis/test-api',
        apihubClient: mockClient,
        toolFilter: (tool) => tool.name.startsWith('get'),
      });

      const tools = await toolset.getTools();

      expect(tools.length).toBe(2);
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('get_users');
      expect(toolNames).toContain('get_user');
      expect(toolNames).not.toContain('create_user');
    });

    it('should return empty array if spec is empty', async () => {
      const mockClient = new MockAPIHubClient('');
      const toolset = new APIHubToolset({
        apihubResourceName:
          'projects/test-project/locations/us-central1/apis/test-api',
        apihubClient: mockClient,
      });

      const tools = await toolset.getTools();

      expect(tools.length).toBe(0);
    });
  });

  describe('close', () => {
    it('should reset the toolset state', async () => {
      const mockClient = new MockAPIHubClient();
      const toolset = new APIHubToolset({
        apihubResourceName:
          'projects/test-project/locations/us-central1/apis/test-api',
        apihubClient: mockClient,
      });

      await toolset.getTools();
      expect(mockClient.getSpecContentCalled).toBe(true);

      await toolset.close();
      mockClient.getSpecContentCalled = false;

      // After close, getTools should re-initialize
      await toolset.getTools();
      expect(mockClient.getSpecContentCalled).toBe(true);
    });
  });

  describe('YAML spec support', () => {
    it('should parse YAML OpenAPI spec', async () => {
      const yamlSpec = `
openapi: '3.0.0'
info:
  title: YAML Test API
  description: Test API in YAML format
  version: '1.0.0'
servers:
  - url: https://api.example.com
paths:
  /items:
    get:
      operationId: listItems
      summary: List all items
      responses:
        '200':
          description: OK
`;
      const mockClient = new MockAPIHubClient(yamlSpec);
      const toolset = new APIHubToolset({
        apihubResourceName:
          'projects/test-project/locations/us-central1/apis/yaml-api',
        apihubClient: mockClient,
      });

      const tools = await toolset.getTools();

      expect(tools.length).toBe(1);
      expect(tools[0].name).toBe('list_items');
      expect(toolset.name).toBe('yaml_test_api');
    });
  });
});

describe('APIHubClient', () => {
  describe('extractResourceName', () => {
    let client: APIHubClient;

    beforeEach(() => {
      client = new APIHubClient({});
    });

    it('should extract resource names from a full resource path', () => {
      const result = client.extractResourceName(
        'projects/my-project/locations/us-central1/apis/my-api'
      );

      expect(result.apiResourceName).toBe(
        'projects/my-project/locations/us-central1/apis/my-api'
      );
      expect(result.apiVersionResourceName).toBeNull();
      expect(result.apiSpecResourceName).toBeNull();
    });

    it('should extract resource names including version', () => {
      const result = client.extractResourceName(
        'projects/my-project/locations/us-central1/apis/my-api/versions/v1'
      );

      expect(result.apiResourceName).toBe(
        'projects/my-project/locations/us-central1/apis/my-api'
      );
      expect(result.apiVersionResourceName).toBe(
        'projects/my-project/locations/us-central1/apis/my-api/versions/v1'
      );
      expect(result.apiSpecResourceName).toBeNull();
    });

    it('should extract resource names including version and spec', () => {
      const result = client.extractResourceName(
        'projects/my-project/locations/us-central1/apis/my-api/versions/v1/specs/openapi'
      );

      expect(result.apiResourceName).toBe(
        'projects/my-project/locations/us-central1/apis/my-api'
      );
      expect(result.apiVersionResourceName).toBe(
        'projects/my-project/locations/us-central1/apis/my-api/versions/v1'
      );
      expect(result.apiSpecResourceName).toBe(
        'projects/my-project/locations/us-central1/apis/my-api/versions/v1/specs/openapi'
      );
    });

    it('should throw error for Console URL without location', () => {
      // Console URLs typically don't include location in the path
      expect(() =>
        client.extractResourceName(
          'https://console.cloud.google.com/apigee/api-hub/apis/my-api?project=my-project'
        )
      ).toThrow(/Location not found/);
    });

    it('should extract resource names from a Console URL with location', () => {
      const result = client.extractResourceName(
        'https://console.cloud.google.com/apigee/api-hub/locations/us-central1/apis/my-api?project=my-project'
      );

      expect(result.apiResourceName).toBe(
        'projects/my-project/locations/us-central1/apis/my-api'
      );
    });

    it('should throw error if project is missing', () => {
      expect(() =>
        client.extractResourceName('locations/us-central1/apis/my-api')
      ).toThrow(/Project ID not found/);
    });

    it('should throw error if location is missing', () => {
      expect(() =>
        client.extractResourceName('projects/my-project/apis/my-api')
      ).toThrow(/Location not found/);
    });

    it('should throw error if API ID is missing', () => {
      expect(() =>
        client.extractResourceName(
          'projects/my-project/locations/us-central1/versions/v1'
        )
      ).toThrow(/API id not found/);
    });

    it('should extract project from query params', () => {
      const result = client.extractResourceName(
        'https://example.com/locations/us-central1/apis/my-api?project=query-project'
      );

      expect(result.apiResourceName).toBe(
        'projects/query-project/locations/us-central1/apis/my-api'
      );
    });
  });

  describe('constructor', () => {
    it('should create a client with access token', () => {
      const client = new APIHubClient({
        accessToken: 'test-token',
      });

      expect(client).toBeDefined();
    });

    it('should create a client with service account JSON', () => {
      const client = new APIHubClient({
        serviceAccountJson: JSON.stringify({
          type: 'service_account',
          project_id: 'test-project',
        }),
      });

      expect(client).toBeDefined();
    });

    it('should create a client without credentials (uses default)', () => {
      const client = new APIHubClient({});

      expect(client).toBeDefined();
    });
  });
});
