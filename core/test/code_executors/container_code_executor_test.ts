/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  ContainerCodeExecutor,
  resetContainerExperimentalWarning,
} from '../../src/code_executors/container_code_executor.js';

// Mock Docker container and client
const mockExec = vi.fn();
const mockStop = vi.fn();
const mockRemove = vi.fn();
const mockCreateContainer = vi.fn();
const mockBuildImage = vi.fn();
const mockGetImage = vi.fn();
const mockFollowProgress = vi.fn();

const mockContainer = {
  exec: mockExec,
  stop: mockStop,
  remove: mockRemove,
};

const MockDocker = vi.fn().mockImplementation(() => ({
  createContainer: mockCreateContainer,
  buildImage: mockBuildImage,
  getImage: mockGetImage,
  modem: {
    followProgress: mockFollowProgress,
  },
}));

// Mock the dynamic_imports module
vi.mock('../../src/code_executors/dynamic_imports.js', () => ({
  importDocker: vi.fn(),
  importKubernetes: vi.fn(),
}));

// Import the mocked function to control it
import {importDocker} from '../../src/code_executors/dynamic_imports.js';

describe('ContainerCodeExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetContainerExperimentalWarning();

    // Setup mock for importDocker
    vi.mocked(importDocker).mockResolvedValue(MockDocker);

    // Default mock implementations
    mockCreateContainer.mockResolvedValue(mockContainer);
    mockExec.mockResolvedValue({
      start: vi.fn().mockResolvedValue({
        output: {
          on: vi.fn((event: string, callback: (data?: Buffer) => void) => {
            if (event === 'data') {
              callback(Buffer.from('python3\n'));
            }
            if (event === 'end') {
              callback();
            }
          }),
        },
      }),
    });
    mockStop.mockResolvedValue(undefined);
    mockRemove.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('create()', () => {
    it('should create executor with image', async () => {
      const executor = await ContainerCodeExecutor.create({
        image: 'python:3.11-slim',
      });

      expect(executor).toBeInstanceOf(ContainerCodeExecutor);
    });

    it('should create executor with dockerfilePath', async () => {
      mockBuildImage.mockResolvedValue({});
      mockFollowProgress.mockImplementation(
        (
          _stream: NodeJS.ReadableStream,
          callback: (err: Error | null) => void
        ) => {
          callback(null);
        }
      );

      const executor = await ContainerCodeExecutor.create({
        dockerfilePath: '/path/to/dockerfile',
      });

      expect(executor).toBeInstanceOf(ContainerCodeExecutor);
    });

    it('should throw error if neither image nor dockerfilePath is provided', async () => {
      await expect(ContainerCodeExecutor.create({})).rejects.toThrow(
        'Either image or dockerfilePath must be set.'
      );
    });

    it('should use default image tag when only dockerfilePath is provided', async () => {
      mockBuildImage.mockResolvedValue({});
      mockFollowProgress.mockImplementation(
        (
          _stream: NodeJS.ReadableStream,
          callback: (err: Error | null) => void
        ) => {
          callback(null);
        }
      );

      const executor = await ContainerCodeExecutor.create({
        dockerfilePath: '/path/to/dockerfile',
      });

      expect(executor).toBeInstanceOf(ContainerCodeExecutor);
    });

    it('should create executor with custom base URL', async () => {
      const executor = await ContainerCodeExecutor.create({
        image: 'python:3.11-slim',
        baseUrl: 'http://localhost:2375',
      });

      expect(executor).toBeInstanceOf(ContainerCodeExecutor);
    });

    it('should create executor with custom errorRetryAttempts', async () => {
      const executor = await ContainerCodeExecutor.create({
        image: 'python:3.11-slim',
        errorRetryAttempts: 5,
      });

      expect(executor.errorRetryAttempts).toBe(5);
    });

    it('should throw error if dockerode is not installed', async () => {
      vi.mocked(importDocker).mockRejectedValue(new Error('Module not found'));

      await expect(
        ContainerCodeExecutor.create({image: 'python:3.11-slim'})
      ).rejects.toThrow('dockerode package is required');
    });
  });

  describe('executeCode()', () => {
    it('should execute code and return stdout', async () => {
      const executor = await ContainerCodeExecutor.create({
        image: 'python:3.11-slim',
      });

      // Mock: first call is Python verification (returns 'python3'), second is code execution
      mockExec
        .mockResolvedValueOnce({
          start: vi.fn().mockResolvedValue({
            output: {
              on: vi.fn((event: string, callback: (data?: Buffer) => void) => {
                if (event === 'data') {
                  callback(Buffer.from('python3\n'));
                }
                if (event === 'end') {
                  callback();
                }
              }),
            },
          }),
        })
        .mockResolvedValueOnce({
          start: vi.fn().mockResolvedValue({
            output: {
              on: vi.fn((event: string, callback: (data?: Buffer) => void) => {
                if (event === 'data') {
                  callback(Buffer.from('Hello, World!'));
                }
                if (event === 'end') {
                  callback();
                }
              }),
            },
          }),
        });

      const result = await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: 'print("Hello, World!")',
          inputFiles: [],
        },
      });

      expect(result.stdout).toContain('Hello, World!');
      expect(result.stderr).toBe('');
      expect(result.outputFiles).toEqual([]);
    });

    it('should handle empty output', async () => {
      const executor = await ContainerCodeExecutor.create({
        image: 'python:3.11-slim',
      });

      // Mock: first call is Python verification (returns 'python3'), second is code execution
      mockExec
        .mockResolvedValueOnce({
          start: vi.fn().mockResolvedValue({
            output: {
              on: vi.fn((event: string, callback: (data?: Buffer) => void) => {
                if (event === 'data') {
                  callback(Buffer.from('python3\n'));
                }
                if (event === 'end') {
                  callback();
                }
              }),
            },
          }),
        })
        .mockResolvedValueOnce({
          start: vi.fn().mockResolvedValue({
            output: {
              on: vi.fn((event: string, callback: (data?: Buffer) => void) => {
                if (event === 'end') {
                  callback();
                }
              }),
            },
          }),
        });

      const result = await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: 'x = 1',
          inputFiles: [],
        },
      });

      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
      expect(result.outputFiles).toEqual([]);
    });

    it('should use python3 -c to execute code', async () => {
      const executor = await ContainerCodeExecutor.create({
        image: 'python:3.11-slim',
      });

      await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: 'print("test")',
          inputFiles: [],
        },
      });

      // Second exec call should be for code execution
      const execCalls = mockExec.mock.calls;
      const codeExecCall = execCalls.find(
        (call) => call[0].Cmd && call[0].Cmd.includes('print("test")')
      );
      expect(codeExecCall).toBeDefined();
      expect(codeExecCall[0].Cmd).toEqual(['python3', '-c', 'print("test")']);
    });
  });

  describe('cleanup()', () => {
    it('should stop and remove container', async () => {
      const executor = await ContainerCodeExecutor.create({
        image: 'python:3.11-slim',
      });

      // Initialize container by executing code
      await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: 'print("test")',
          inputFiles: [],
        },
      });

      await executor.cleanup();

      expect(mockStop).toHaveBeenCalled();
      expect(mockRemove).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      const executor = await ContainerCodeExecutor.create({
        image: 'python:3.11-slim',
      });

      // Initialize container
      await executor.executeCode({
        invocationContext: {invocationId: 'test-123'} as any,
        codeExecutionInput: {
          code: 'print("test")',
          inputFiles: [],
        },
      });

      // Mock stop failure
      mockStop.mockRejectedValue(new Error('Container already stopped'));

      // Should not throw
      await expect(executor.cleanup()).resolves.not.toThrow();
    });
  });

  describe('BaseCodeExecutor properties', () => {
    it('should have stateful set to false', async () => {
      const executor = await ContainerCodeExecutor.create({
        image: 'python:3.11-slim',
      });

      expect(executor.stateful).toBe(false);
    });

    it('should have optimizeDataFile set to false', async () => {
      const executor = await ContainerCodeExecutor.create({
        image: 'python:3.11-slim',
      });

      expect(executor.optimizeDataFile).toBe(false);
    });

    it('should have default errorRetryAttempts of 2', async () => {
      const executor = await ContainerCodeExecutor.create({
        image: 'python:3.11-slim',
      });

      expect(executor.errorRetryAttempts).toBe(2);
    });
  });
});
