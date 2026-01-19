/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  GKECodeExecutor,
  resetGKEExperimentalWarning,
} from '../../src/code_executors/gke_code_executor.js';

// Mock Kubernetes client functions
const mockLoadFromFile = vi.fn();
const mockLoadFromDefault = vi.fn();
const mockLoadFromCluster = vi.fn();
const mockSetCurrentContext = vi.fn();
const mockMakeApiClient = vi.fn();
const mockCreateNamespacedConfigMap = vi.fn();
const mockPatchNamespacedConfigMap = vi.fn();
const mockCreateNamespacedJob = vi.fn();
const mockReadNamespacedJob = vi.fn();
const mockListNamespacedPod = vi.fn();
const mockReadNamespacedPodLog = vi.fn();
const mockWatch = vi.fn();

// Mock API clients
const mockCoreV1Api = {
  createNamespacedConfigMap: mockCreateNamespacedConfigMap,
  patchNamespacedConfigMap: mockPatchNamespacedConfigMap,
  listNamespacedPod: mockListNamespacedPod,
  readNamespacedPodLog: mockReadNamespacedPodLog,
};

const mockBatchV1Api = {
  createNamespacedJob: mockCreateNamespacedJob,
  readNamespacedJob: mockReadNamespacedJob,
};

const MockKubeConfig = vi.fn().mockImplementation(() => ({
  loadFromFile: mockLoadFromFile,
  loadFromDefault: mockLoadFromDefault,
  loadFromCluster: mockLoadFromCluster,
  setCurrentContext: mockSetCurrentContext,
  makeApiClient: mockMakeApiClient,
}));

const MockWatch = vi.fn().mockImplementation(() => ({
  watch: mockWatch,
}));

// Mock the dynamic_imports module
vi.mock('../../src/code_executors/dynamic_imports.js', () => ({
  importDocker: vi.fn(),
  importKubernetes: vi.fn(),
}));

// Import the mocked function to control it
import {importKubernetes} from '../../src/code_executors/dynamic_imports.js';

// Create named mock classes so makeApiClient can identify them
const MockCoreV1Api = vi.fn();
Object.defineProperty(MockCoreV1Api, 'name', {value: 'CoreV1Api'});

const MockBatchV1Api = vi.fn();
Object.defineProperty(MockBatchV1Api, 'name', {value: 'BatchV1Api'});

describe('GKECodeExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGKEExperimentalWarning();

    // Setup mock for importKubernetes
    vi.mocked(importKubernetes).mockResolvedValue({
      KubeConfig: MockKubeConfig,
      CoreV1Api: MockCoreV1Api,
      BatchV1Api: MockBatchV1Api,
      Watch: MockWatch,
    });

    // Default mock implementations
    mockMakeApiClient.mockImplementation((ApiClass: any) => {
      if (ApiClass.name === 'CoreV1Api') {
        return mockCoreV1Api;
      }
      return mockBatchV1Api;
    });

    mockCreateNamespacedConfigMap.mockResolvedValue({body: {}});
    mockPatchNamespacedConfigMap.mockResolvedValue({body: {}});
    mockCreateNamespacedJob.mockResolvedValue({
      body: {
        metadata: {
          name: 'adk-exec-test123',
          uid: 'job-uid-123',
        },
      },
    });
    mockListNamespacedPod.mockResolvedValue({
      body: {
        items: [{metadata: {name: 'adk-exec-test123-pod'}}],
      },
    });
    mockReadNamespacedPodLog.mockResolvedValue({
      body: 'Hello, World!',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('create()', () => {
    it('should create executor with default options', async () => {
      const executor = await GKECodeExecutor.create();

      expect(executor).toBeInstanceOf(GKECodeExecutor);
    });

    it('should load kubeconfig from file when kubeconfigPath is provided', async () => {
      await GKECodeExecutor.create({
        kubeconfigPath: '/path/to/kubeconfig',
      });

      expect(mockLoadFromFile).toHaveBeenCalledWith('/path/to/kubeconfig');
    });

    it('should set context when kubeconfigContext is provided', async () => {
      await GKECodeExecutor.create({
        kubeconfigPath: '/path/to/kubeconfig',
        kubeconfigContext: 'my-cluster',
      });

      expect(mockSetCurrentContext).toHaveBeenCalledWith('my-cluster');
    });

    it('should try in-cluster config first when no kubeconfig path', async () => {
      mockLoadFromCluster.mockImplementation(() => {
        // Simulate successful in-cluster config
      });

      await GKECodeExecutor.create();

      expect(mockLoadFromCluster).toHaveBeenCalled();
    });

    it('should fall back to default kubeconfig on in-cluster failure', async () => {
      mockLoadFromCluster.mockImplementation(() => {
        throw new Error('Not running in cluster');
      });

      await GKECodeExecutor.create();

      expect(mockLoadFromCluster).toHaveBeenCalled();
      expect(mockLoadFromDefault).toHaveBeenCalled();
    });

    it('should create executor with custom options', async () => {
      const executor = await GKECodeExecutor.create({
        namespace: 'custom-namespace',
        image: 'custom-image:latest',
        timeoutSeconds: 600,
        cpuRequested: '500m',
        memRequested: '512Mi',
        cpuLimit: '1000m',
        memLimit: '1Gi',
        errorRetryAttempts: 5,
      });

      expect(executor).toBeInstanceOf(GKECodeExecutor);
      expect(executor.errorRetryAttempts).toBe(5);
    });

    it('should throw error if kubernetes client is not installed', async () => {
      vi.mocked(importKubernetes).mockRejectedValue(
        new Error('Module not found')
      );

      await expect(GKECodeExecutor.create()).rejects.toThrow(
        '@kubernetes/client-node package is required'
      );
    });
  });

  describe('executeCode()', () => {
    it('should create ConfigMap with code', async () => {
      mockWatch.mockImplementation(
        (
          _path: string,
          _queryParams: Record<string, string>,
          callback: (type: string, apiObj: object, watchObj: object) => void,
          _done: (err: Error | null) => void
        ) => {
          // Simulate immediate job completion
          setTimeout(() => {
            callback('MODIFIED', {status: {succeeded: 1}}, {});
          }, 10);
          return Promise.resolve({abort: vi.fn()});
        }
      );

      const executor = await GKECodeExecutor.create({
        namespace: 'test-namespace',
      });

      await executor.executeCode({
        invocationContext: {invocationId: 'test-inv-123'} as any,
        codeExecutionInput: {
          code: 'print("Hello")',
          inputFiles: [],
        },
      });

      expect(mockCreateNamespacedConfigMap).toHaveBeenCalledWith(
        'test-namespace',
        expect.objectContaining({
          data: {'code.py': 'print("Hello")'},
        })
      );
    });

    it('should return stdout on successful execution', async () => {
      mockWatch.mockImplementation(
        (
          _path: string,
          _queryParams: Record<string, string>,
          callback: (type: string, apiObj: object, watchObj: object) => void,
          _done: (err: Error | null) => void
        ) => {
          setTimeout(() => {
            callback('MODIFIED', {status: {succeeded: 1}}, {});
          }, 10);
          return Promise.resolve({abort: vi.fn()});
        }
      );

      const executor = await GKECodeExecutor.create();

      const result = await executor.executeCode({
        invocationContext: {invocationId: 'test-inv-123'} as any,
        codeExecutionInput: {
          code: 'print("Hello, World!")',
          inputFiles: [],
        },
      });

      expect(result.stdout).toBe('Hello, World!');
      expect(result.stderr).toBe('');
      expect(result.outputFiles).toEqual([]);
    });

    it('should return stderr on job failure', async () => {
      mockReadNamespacedPodLog.mockResolvedValue({
        body: 'Error: Module not found',
      });

      mockWatch.mockImplementation(
        (
          _path: string,
          _queryParams: Record<string, string>,
          callback: (type: string, apiObj: object, watchObj: object) => void,
          _done: (err: Error | null) => void
        ) => {
          setTimeout(() => {
            callback('MODIFIED', {status: {failed: 1}}, {});
          }, 10);
          return Promise.resolve({abort: vi.fn()});
        }
      );

      const executor = await GKECodeExecutor.create();

      const result = await executor.executeCode({
        invocationContext: {invocationId: 'test-inv-123'} as any,
        codeExecutionInput: {
          code: 'import nonexistent_module',
          inputFiles: [],
        },
      });

      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('Error: Module not found');
    });

    it('should handle API errors gracefully', async () => {
      mockCreateNamespacedConfigMap.mockRejectedValue(
        new Error('API connection failed')
      );

      const executor = await GKECodeExecutor.create();

      const result = await executor.executeCode({
        invocationContext: {invocationId: 'test-inv-123'} as any,
        codeExecutionInput: {
          code: 'print("test")',
          inputFiles: [],
        },
      });

      expect(result.stderr).toContain('Error executing code');
      expect(result.stderr).toContain('API connection failed');
    });
  });

  describe('BaseCodeExecutor properties', () => {
    it('should have stateful set to false', async () => {
      const executor = await GKECodeExecutor.create();

      expect(executor.stateful).toBe(false);
    });

    it('should have optimizeDataFile set to false', async () => {
      const executor = await GKECodeExecutor.create();

      expect(executor.optimizeDataFile).toBe(false);
    });

    it('should have default errorRetryAttempts of 2', async () => {
      const executor = await GKECodeExecutor.create();

      expect(executor.errorRetryAttempts).toBe(2);
    });
  });
});
