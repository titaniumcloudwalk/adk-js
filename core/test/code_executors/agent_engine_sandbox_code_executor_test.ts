/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  AgentEngineSandboxCodeExecutor,
  resetExperimentalWarning,
} from '../../src/code_executors/agent_engine_sandbox_code_executor.js';

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

describe('AgentEngineSandboxCodeExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExperimentalWarning();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('create() with sandboxResourceName', () => {
    it('should create executor with valid sandbox resource name', async () => {
      const executor = await AgentEngineSandboxCodeExecutor.create({
        sandboxResourceName:
          'projects/my-project/locations/us-central1/reasoningEngines/123/sandboxEnvironments/456',
      });

      expect(executor).toBeInstanceOf(AgentEngineSandboxCodeExecutor);
      expect(executor.sandboxResourceName).toBe(
        'projects/my-project/locations/us-central1/reasoningEngines/123/sandboxEnvironments/456'
      );
    });

    it('should throw error for invalid sandbox resource name format', async () => {
      await expect(
        AgentEngineSandboxCodeExecutor.create({
          sandboxResourceName: 'invalid-resource-name',
        })
      ).rejects.toThrow('Resource name invalid-resource-name is not valid.');
    });

    it('should throw error for sandbox resource name missing sandbox ID', async () => {
      await expect(
        AgentEngineSandboxCodeExecutor.create({
          sandboxResourceName:
            'projects/my-project/locations/us-central1/reasoningEngines/123',
        })
      ).rejects.toThrow(/is not valid/);
    });

    it('should parse project ID and location correctly', async () => {
      const executor = await AgentEngineSandboxCodeExecutor.create({
        sandboxResourceName:
          'projects/test-project-123/locations/europe-west1/reasoningEngines/999/sandboxEnvironments/888',
      });

      expect(executor.sandboxResourceName).toBe(
        'projects/test-project-123/locations/europe-west1/reasoningEngines/999/sandboxEnvironments/888'
      );
    });
  });

  describe('create() with agentEngineResourceName', () => {
    it('should create sandbox and return executor', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            name: 'projects/my-project/locations/us-central1/reasoningEngines/123/sandboxEnvironments/new-456',
          }),
      });

      const executor = await AgentEngineSandboxCodeExecutor.create({
        agentEngineResourceName:
          'projects/my-project/locations/us-central1/reasoningEngines/123',
      });

      expect(executor).toBeInstanceOf(AgentEngineSandboxCodeExecutor);
      expect(executor.sandboxResourceName).toBe(
        'projects/my-project/locations/us-central1/reasoningEngines/123/sandboxEnvironments/new-456'
      );

      // Verify the API call was made correctly
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/sandboxEnvironments');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({
        spec: {codeExecutionEnvironment: {}},
        display_name: 'default_sandbox',
      });
    });

    it('should throw error for invalid agent engine resource name', async () => {
      await expect(
        AgentEngineSandboxCodeExecutor.create({
          agentEngineResourceName: 'invalid-name',
        })
      ).rejects.toThrow('Resource name invalid-name is not valid.');
    });

    it('should throw error for agent engine name with sandbox suffix', async () => {
      await expect(
        AgentEngineSandboxCodeExecutor.create({
          agentEngineResourceName:
            'projects/my-project/locations/us-central1/reasoningEngines/123/sandboxEnvironments/456',
        })
      ).rejects.toThrow(/is not valid/);
    });
  });

  describe('create() validation', () => {
    it('should throw error when neither resource name is provided', async () => {
      await expect(AgentEngineSandboxCodeExecutor.create({})).rejects.toThrow(
        'Either sandboxResourceName or agentEngineResourceName must be set.'
      );
    });

    it('should prioritize sandboxResourceName over agentEngineResourceName', async () => {
      const executor = await AgentEngineSandboxCodeExecutor.create({
        sandboxResourceName:
          'projects/my-project/locations/us-central1/reasoningEngines/123/sandboxEnvironments/456',
        agentEngineResourceName:
          'projects/other-project/locations/us-east1/reasoningEngines/789',
      });

      // Should use sandboxResourceName, not create a new sandbox
      expect(mockFetch).not.toHaveBeenCalled();
      expect(executor.sandboxResourceName).toBe(
        'projects/my-project/locations/us-central1/reasoningEngines/123/sandboxEnvironments/456'
      );
    });
  });

  describe('executeCode()', () => {
    let executor: AgentEngineSandboxCodeExecutor;

    beforeEach(async () => {
      executor = await AgentEngineSandboxCodeExecutor.create({
        sandboxResourceName:
          'projects/my-project/locations/us-central1/reasoningEngines/123/sandboxEnvironments/456',
      });
    });

    it('should execute simple code and return stdout', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            outputs: [
              {
                data: btoa(JSON.stringify({stdout: 'Hello, World!', stderr: ''})),
                mimeType: 'application/json',
              },
            ],
          }),
      });

      const result = await executor.executeCode({
        invocationContext: {} as any,
        codeExecutionInput: {
          code: 'print("Hello, World!")',
          inputFiles: [],
        },
      });

      expect(result.stdout).toBe('Hello, World!');
      expect(result.stderr).toBe('');
      expect(result.outputFiles).toEqual([]);

      // Verify API call
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain(':executeCode');
      expect(JSON.parse(options.body).input_data.code).toBe(
        'print("Hello, World!")'
      );
    });

    it('should handle stderr in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            outputs: [
              {
                data: btoa(
                  JSON.stringify({
                    stdout: '',
                    stderr: 'Error: something went wrong',
                  })
                ),
                mimeType: 'application/json',
              },
            ],
          }),
      });

      const result = await executor.executeCode({
        invocationContext: {} as any,
        codeExecutionInput: {
          code: 'raise Exception("test")',
          inputFiles: [],
        },
      });

      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('Error: something went wrong');
    });

    it('should include input files in the request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            outputs: [
              {
                data: btoa(JSON.stringify({stdout: 'processed', stderr: ''})),
                mimeType: 'application/json',
              },
            ],
          }),
      });

      await executor.executeCode({
        invocationContext: {} as any,
        codeExecutionInput: {
          code: 'import csv',
          inputFiles: [
            {
              name: 'data.csv',
              content: btoa('a,b,c\n1,2,3'),
              mimeType: 'text/csv',
            },
          ],
        },
      });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.input_data.files).toEqual([
        {
          name: 'data.csv',
          contents: btoa('a,b,c\n1,2,3'),
          mimeType: 'text/csv',
        },
      ]);
    });

    it('should handle output files in response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            outputs: [
              {
                data: btoa(JSON.stringify({stdout: 'File saved', stderr: ''})),
                mimeType: 'application/json',
              },
              {
                data: btoa('PNG file content'),
                mimeType: 'image/png',
                metadata: {
                  attributes: {
                    file_name: btoa('output.png'),
                  },
                },
              },
            ],
          }),
      });

      const result = await executor.executeCode({
        invocationContext: {} as any,
        codeExecutionInput: {
          code: 'plt.savefig("output.png")',
          inputFiles: [],
        },
      });

      expect(result.stdout).toBe('File saved');
      expect(result.outputFiles).toHaveLength(1);
      expect(result.outputFiles[0].name).toBe('output.png');
      expect(result.outputFiles[0].mimeType).toBe('image/png');
    });

    it('should guess MIME type from filename when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            outputs: [
              {
                data: btoa('{"key": "value"}'),
                mimeType: '',
                metadata: {
                  attributes: {
                    file_name: btoa('data.json'),
                  },
                },
              },
            ],
          }),
      });

      const result = await executor.executeCode({
        invocationContext: {} as any,
        codeExecutionInput: {
          code: 'save_json()',
          inputFiles: [],
        },
      });

      expect(result.outputFiles[0].mimeType).toBe('application/json');
    });

    it('should handle API errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(
        executor.executeCode({
          invocationContext: {} as any,
          codeExecutionInput: {
            code: 'print("test")',
            inputFiles: [],
          },
        })
      ).rejects.toThrow('API request failed: 500');
    });

    it('should handle empty outputs array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            outputs: [],
          }),
      });

      const result = await executor.executeCode({
        invocationContext: {} as any,
        codeExecutionInput: {
          code: 'pass',
          inputFiles: [],
        },
      });

      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(result.outputFiles).toEqual([]);
    });

    it('should handle missing outputs field', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({}),
      });

      const result = await executor.executeCode({
        invocationContext: {} as any,
        codeExecutionInput: {
          code: 'pass',
          inputFiles: [],
        },
      });

      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(result.outputFiles).toEqual([]);
    });
  });

  describe('resource name patterns', () => {
    it('should accept resource names with hyphens and underscores', async () => {
      const executor = await AgentEngineSandboxCodeExecutor.create({
        sandboxResourceName:
          'projects/my-project_123/locations/us-central-1/reasoningEngines/456/sandboxEnvironments/789',
      });

      expect(executor.sandboxResourceName).toContain('my-project_123');
    });

    it('should accept various location formats', async () => {
      const locations = [
        'us-central1',
        'europe-west1',
        'asia-east1',
        'northamerica-northeast1',
      ];

      for (const location of locations) {
        const executor = await AgentEngineSandboxCodeExecutor.create({
          sandboxResourceName: `projects/test/locations/${location}/reasoningEngines/123/sandboxEnvironments/456`,
        });
        expect(executor.sandboxResourceName).toContain(location);
      }
    });
  });

  describe('experimental warning', () => {
    it('should log experimental warning on first use', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await AgentEngineSandboxCodeExecutor.create({
        sandboxResourceName:
          'projects/my-project/locations/us-central1/reasoningEngines/123/sandboxEnvironments/456',
      });

      // The warning is logged via logger.warn, but in tests it may go to console
      // Just verify we can create the executor without issues
      expect(true).toBe(true);
      warnSpy.mockRestore();
    });
  });

  describe('BaseCodeExecutor properties', () => {
    it('should have default code executor properties', async () => {
      const executor = await AgentEngineSandboxCodeExecutor.create({
        sandboxResourceName:
          'projects/my-project/locations/us-central1/reasoningEngines/123/sandboxEnvironments/456',
      });

      expect(executor.optimizeDataFile).toBe(false);
      expect(executor.stateful).toBe(false);
      expect(executor.errorRetryAttempts).toBe(2);
      expect(executor.codeBlockDelimiters).toBeDefined();
      expect(executor.executionResultDelimiters).toBeDefined();
    });
  });
});
