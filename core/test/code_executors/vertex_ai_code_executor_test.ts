/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  VertexAICodeExecutor,
  resetVertexAIExperimentalWarning,
} from '../../src/code_executors/vertex_ai_code_executor.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock google-auth-library
vi.mock('google-auth-library', () => ({
  GoogleAuth: vi.fn().mockImplementation(() => ({
    getClient: vi.fn().mockResolvedValue({
      getAccessToken: vi.fn().mockResolvedValue({token: 'mock-access-token'}),
    }),
  })),
}));

describe('VertexAICodeExecutor', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    resetVertexAIExperimentalWarning();
    process.env = {...originalEnv};
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env = originalEnv;
  });

  describe('create()', () => {
    it('should create executor with valid resource name', async () => {
      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      expect(executor).toBeInstanceOf(VertexAICodeExecutor);
    });

    it('should throw error for invalid resource name format', async () => {
      await expect(
        VertexAICodeExecutor.create({
          resourceName: 'invalid-resource-name',
        })
      ).rejects.toThrow('Resource name invalid-resource-name is not valid.');
    });

    it('should use environment variable when resourceName not provided', async () => {
      process.env['CODE_INTERPRETER_EXTENSION_NAME'] =
        'projects/env-project/locations/europe-west1/extensions/456';

      const executor = await VertexAICodeExecutor.create();

      expect(executor).toBeInstanceOf(VertexAICodeExecutor);
    });

    it('should create new extension when projectId is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            name: 'projects/my-project/locations/us-central1/extensions/789',
          }),
      });

      const executor = await VertexAICodeExecutor.create({
        projectId: 'my-project',
        location: 'us-central1',
      });

      expect(executor).toBeInstanceOf(VertexAICodeExecutor);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/extensions');
      expect(options.method).toBe('POST');
    });

    it('should throw error when no options provided', async () => {
      await expect(VertexAICodeExecutor.create()).rejects.toThrow(
        'Either resourceName, CODE_INTERPRETER_EXTENSION_NAME environment variable, or projectId must be provided.'
      );
    });

    it('should use default location us-central1', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            name: 'projects/my-project/locations/us-central1/extensions/789',
          }),
      });

      await VertexAICodeExecutor.create({
        projectId: 'my-project',
      });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('us-central1');
    });

    it('should create executor with custom errorRetryAttempts', async () => {
      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
        errorRetryAttempts: 5,
      });

      expect(executor.errorRetryAttempts).toBe(5);
    });
  });

  describe('executeCode()', () => {
    it('should execute code and return stdout', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            output: {
              execution_result: 'Hello, World!',
              execution_error: '',
              output_files: [],
            },
          }),
      });

      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      const result = await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: 'print("Hello, World!")',
          inputFiles: [],
        },
      });

      expect(result.stdout).toBe('Hello, World!');
      expect(result.stderr).toBe('');
      expect(result.outputFiles).toEqual([]);
    });

    it('should return stderr on execution error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            output: {
              execution_result: '',
              execution_error: 'NameError: name "undefined_var" is not defined',
              output_files: [],
            },
          }),
      });

      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      const result = await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: 'print(undefined_var)',
          inputFiles: [],
        },
      });

      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('NameError');
    });

    it('should prepend standard imports to code', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            output: {
              execution_result: '',
              execution_error: '',
              output_files: [],
            },
          }),
      });

      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: 'x = np.array([1, 2, 3])',
          inputFiles: [],
        },
      });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      const code = body.operation_params.code;

      expect(code).toContain('import numpy as np');
      expect(code).toContain('import pandas as pd');
      expect(code).toContain('import matplotlib.pyplot as plt');
      expect(code).toContain('def crop(');
      expect(code).toContain('def explore_df(');
      expect(code).toContain('x = np.array([1, 2, 3])');
    });

    it('should include input files in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            output: {
              execution_result: '',
              execution_error: '',
              output_files: [],
            },
          }),
      });

      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: 'pd.read_csv("data.csv")',
          inputFiles: [
            {
              name: 'data.csv',
              content: 'YSxiLGMKMSwyLDM=', // base64 for "a,b,c\n1,2,3"
              mimeType: 'text/csv',
            },
          ],
        },
      });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.operation_params.input_files).toEqual([
        {
          name: 'data.csv',
          contents: 'YSxiLGMKMSwyLDM=',
        },
      ]);
    });

    it('should handle output files', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            output: {
              execution_result: '',
              execution_error: '',
              output_files: [
                {
                  name: 'output.png',
                  contents:
                    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                },
                {
                  name: 'results.csv',
                  contents: 'YSxiLGMKMSwyLDM=',
                },
              ],
            },
          }),
      });

      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      const result = await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: 'plt.savefig("output.png")',
          inputFiles: [],
        },
      });

      expect(result.outputFiles).toHaveLength(2);
      expect(result.outputFiles[0].name).toBe('output.png');
      expect(result.outputFiles[0].mimeType).toBe('image/png');
      expect(result.outputFiles[1].name).toBe('results.csv');
      expect(result.outputFiles[1].mimeType).toBe('text/csv');
    });

    it('should use session_id for stateful execution', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            output: {
              execution_result: '',
              execution_error: '',
              output_files: [],
            },
          }),
      });

      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: 'x = 1',
          inputFiles: [],
          executionId: 'session-abc-123',
        },
      });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);

      expect(body.operation_params.session_id).toBe('session-abc-123');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      await expect(
        executor.executeCode({
          invocationContext: {invocationId: 'test-123'} as any,
          codeExecutionInput: {
            code: 'print("test")',
            inputFiles: [],
          },
        })
      ).rejects.toThrow('API request failed: 500');
    });
  });

  describe('MIME type detection', () => {
    it('should detect image MIME types correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            output: {
              execution_result: '',
              execution_error: '',
              output_files: [
                {name: 'chart.png', contents: 'data'},
                {name: 'photo.jpg', contents: 'data'},
                {name: 'image.jpeg', contents: 'data'},
                {name: 'icon.gif', contents: 'data'},
                {name: 'logo.svg', contents: 'data'},
              ],
            },
          }),
      });

      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      const result = await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: '',
          inputFiles: [],
        },
      });

      expect(result.outputFiles[0].mimeType).toBe('image/png');
      expect(result.outputFiles[1].mimeType).toBe('image/jpeg');
      expect(result.outputFiles[2].mimeType).toBe('image/jpeg');
      expect(result.outputFiles[3].mimeType).toBe('image/gif');
      expect(result.outputFiles[4].mimeType).toBe('image/svg+xml');
    });

    it('should detect data file MIME types correctly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            output: {
              execution_result: '',
              execution_error: '',
              output_files: [
                {name: 'data.csv', contents: 'data'},
                {name: 'config.json', contents: 'data'},
                {name: 'readme.txt', contents: 'data'},
                {name: 'page.html', contents: 'data'},
              ],
            },
          }),
      });

      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      const result = await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: '',
          inputFiles: [],
        },
      });

      expect(result.outputFiles[0].mimeType).toBe('text/csv');
      expect(result.outputFiles[1].mimeType).toBe('application/json');
      expect(result.outputFiles[2].mimeType).toBe('text/plain');
      expect(result.outputFiles[3].mimeType).toBe('text/html');
    });

    it('should use octet-stream for unknown extensions', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            output: {
              execution_result: '',
              execution_error: '',
              output_files: [{name: 'data.xyz', contents: 'data'}],
            },
          }),
      });

      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      const result = await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: '',
          inputFiles: [],
        },
      });

      expect(result.outputFiles[0].mimeType).toBe('application/octet-stream');
    });
  });

  describe('BaseCodeExecutor properties', () => {
    it('should have stateful set to true', async () => {
      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      expect(executor.stateful).toBe(true);
    });

    it('should have optimizeDataFile set to false', async () => {
      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      expect(executor.optimizeDataFile).toBe(false);
    });

    it('should have default errorRetryAttempts of 2', async () => {
      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-project/locations/us-central1/extensions/123',
      });

      expect(executor.errorRetryAttempts).toBe(2);
    });
  });

  describe('resource name patterns', () => {
    it('should accept resource names with hyphens in project ID', async () => {
      const executor = await VertexAICodeExecutor.create({
        resourceName:
          'projects/my-test-project-123/locations/us-central1/extensions/456',
      });

      expect(executor).toBeInstanceOf(VertexAICodeExecutor);
    });

    it('should accept various location formats', async () => {
      const locations = [
        'us-central1',
        'europe-west1',
        'asia-northeast1',
        'australia-southeast1',
      ];

      for (const location of locations) {
        const executor = await VertexAICodeExecutor.create({
          resourceName: `projects/my-project/locations/${location}/extensions/123`,
        });

        expect(executor).toBeInstanceOf(VertexAICodeExecutor);
      }
    });
  });
});
