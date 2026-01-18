/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import * as fs from 'node:fs/promises';
import * as fsSyncModule from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  createSessionServiceFromOptions,
  createArtifactServiceFromOptions,
  createMemoryServiceFromOptions,
  getServiceRegistry,
  isCloudRun,
  isKubernetes,
  isDirWritable,
  resolveUseLocalStorage,
  parseAgentEngineParams,
} from '../../src/cli/service_factory.js';
import {
  InMemorySessionService,
  InMemoryArtifactService,
  InMemoryMemoryService,
} from '@google/adk';

describe('service_factory', () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adk-service-test-'));
    // Save original environment
    originalEnv = {...process.env};
  });

  afterEach(async () => {
    // Restore original environment
    process.env = originalEnv;
    try {
      await fs.rm(tempDir, {recursive: true, force: true});
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('environment detection', () => {
    it('should detect Cloud Run environment', () => {
      delete process.env['K_SERVICE'];
      expect(isCloudRun()).toBe(false);

      process.env['K_SERVICE'] = 'my-service';
      expect(isCloudRun()).toBe(true);
    });

    it('should detect Kubernetes environment', () => {
      delete process.env['KUBERNETES_SERVICE_HOST'];
      expect(isKubernetes()).toBe(false);

      process.env['KUBERNETES_SERVICE_HOST'] = '10.0.0.1';
      expect(isKubernetes()).toBe(true);
    });

    it('should check directory writability', () => {
      // Temp directory should be writable
      expect(isDirWritable(tempDir)).toBe(true);

      // Non-existent directory should not be writable
      expect(isDirWritable('/nonexistent/path')).toBe(false);
    });
  });

  describe('resolveUseLocalStorage', () => {
    it('should respect ADK_DISABLE_LOCAL_STORAGE env', () => {
      process.env['ADK_DISABLE_LOCAL_STORAGE'] = '1';
      const result = resolveUseLocalStorage(tempDir, true);
      expect(result.useLocalStorage).toBe(false);
      expect(result.warningMessage).toContain('ADK_DISABLE_LOCAL_STORAGE');
    });

    it('should respect ADK_FORCE_LOCAL_STORAGE env when writable', () => {
      process.env['ADK_FORCE_LOCAL_STORAGE'] = '1';
      const result = resolveUseLocalStorage(tempDir, false);
      expect(result.useLocalStorage).toBe(true);
      expect(result.warningMessage).toBeUndefined();
    });

    it('should warn when forced but not writable', () => {
      process.env['ADK_FORCE_LOCAL_STORAGE'] = '1';
      const result = resolveUseLocalStorage('/nonexistent/path', false);
      expect(result.useLocalStorage).toBe(false);
      expect(result.warningMessage).toContain('not writable');
    });

    it('should use in-memory in Cloud Run/Kubernetes', () => {
      process.env['K_SERVICE'] = 'my-service';
      const result = resolveUseLocalStorage(tempDir, true);
      expect(result.useLocalStorage).toBe(false);
      expect(result.warningMessage).toContain('Cloud Run/Kubernetes');
    });

    it('should allow local storage when requested and writable', () => {
      delete process.env['K_SERVICE'];
      delete process.env['KUBERNETES_SERVICE_HOST'];
      delete process.env['ADK_DISABLE_LOCAL_STORAGE'];
      delete process.env['ADK_FORCE_LOCAL_STORAGE'];
      const result = resolveUseLocalStorage(tempDir, true);
      expect(result.useLocalStorage).toBe(true);
      expect(result.warningMessage).toBeUndefined();
    });

    it('should not use local storage when not requested', () => {
      const result = resolveUseLocalStorage(tempDir, false);
      expect(result.useLocalStorage).toBe(false);
      expect(result.warningMessage).toBeUndefined();
    });
  });

  describe('parseAgentEngineParams', () => {
    it('should parse short-form ID with env variables', () => {
      process.env['GOOGLE_CLOUD_PROJECT'] = 'my-project';
      process.env['GOOGLE_CLOUD_LOCATION'] = 'us-central1';

      const result = parseAgentEngineParams('my-agent-engine-id');
      expect(result.project).toBe('my-project');
      expect(result.location).toBe('us-central1');
      expect(result.agentEngineId).toBe('my-agent-engine-id');
    });

    it('should throw when env variables are missing for short-form ID', () => {
      delete process.env['GOOGLE_CLOUD_PROJECT'];
      delete process.env['GOOGLE_CLOUD_LOCATION'];

      expect(() => parseAgentEngineParams('my-id')).toThrow(
          'GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION must be set',
      );
    });

    it('should parse full resource name', () => {
      const resourceName =
          'projects/my-project/locations/us-central1/reasoningEngines/my-engine';
      const result = parseAgentEngineParams(resourceName);
      expect(result.project).toBe('my-project');
      expect(result.location).toBe('us-central1');
      expect(result.agentEngineId).toBe('my-engine');
    });

    it('should throw for malformed resource name', () => {
      expect(() => parseAgentEngineParams('invalid/resource/name')).toThrow(
          'mal-formatted',
      );
    });

    it('should throw for empty uri part', () => {
      expect(() => parseAgentEngineParams('')).toThrow('cannot be empty');
    });
  });

  describe('getServiceRegistry', () => {
    it('should return singleton instance', () => {
      const registry1 = getServiceRegistry();
      const registry2 = getServiceRegistry();
      expect(registry1).toBe(registry2);
    });

    it('should have built-in session service factories', async () => {
      const registry = getServiceRegistry();

      // memory:// should create InMemorySessionService
      const memoryService = await registry.createSessionService('memory://');
      expect(memoryService).toBeInstanceOf(InMemorySessionService);
    });

    it('should have built-in artifact service factories', async () => {
      const registry = getServiceRegistry();

      // memory:// should create InMemoryArtifactService
      const memoryService = await registry.createArtifactService('memory://');
      expect(memoryService).toBeInstanceOf(InMemoryArtifactService);
    });

    it('should have built-in memory service factories', async () => {
      const registry = getServiceRegistry();

      // memory:// should create InMemoryMemoryService
      const memoryService = await registry.createMemoryService('memory://');
      expect(memoryService).toBeInstanceOf(InMemoryMemoryService);
    });

    it('should return undefined for unknown scheme', async () => {
      const registry = getServiceRegistry();
      const service = await registry.createSessionService('unknown://foo');
      expect(service).toBeUndefined();
    });
  });

  describe('createSessionServiceFromOptions', () => {
    it('should create InMemorySessionService when useLocalStorage is false', async () => {
      const service = await createSessionServiceFromOptions({
        baseDir: tempDir,
        useLocalStorage: false,
      });
      expect(service).toBeInstanceOf(InMemorySessionService);
    });

    it('should create InMemorySessionService with memory:// URI', async () => {
      const service = await createSessionServiceFromOptions({
        baseDir: tempDir,
        sessionServiceUri: 'memory://',
        useLocalStorage: false,
      });
      expect(service).toBeInstanceOf(InMemorySessionService);
    });

    it('should create service from sqlite:// URI with no path (in-memory)', async () => {
      const service = await createSessionServiceFromOptions({
        baseDir: tempDir,
        sessionServiceUri: 'sqlite://',
        useLocalStorage: false,
      });
      expect(service).toBeInstanceOf(InMemorySessionService);
    });

    it('should use in-memory when Cloud Run is detected', async () => {
      process.env['K_SERVICE'] = 'my-service';
      const service = await createSessionServiceFromOptions({
        baseDir: tempDir,
        useLocalStorage: true,
      });
      expect(service).toBeInstanceOf(InMemorySessionService);
    });

    it('should use in-memory when Kubernetes is detected', async () => {
      process.env['KUBERNETES_SERVICE_HOST'] = '10.0.0.1';
      const service = await createSessionServiceFromOptions({
        baseDir: tempDir,
        useLocalStorage: true,
      });
      expect(service).toBeInstanceOf(InMemorySessionService);
    });
  });

  describe('createArtifactServiceFromOptions', () => {
    it('should create InMemoryArtifactService when useLocalStorage is false', async () => {
      const service = await createArtifactServiceFromOptions({
        baseDir: tempDir,
        useLocalStorage: false,
      });
      expect(service).toBeInstanceOf(InMemoryArtifactService);
    });

    it('should create InMemoryArtifactService with memory:// URI', async () => {
      const service = await createArtifactServiceFromOptions({
        baseDir: tempDir,
        artifactServiceUri: 'memory://',
        useLocalStorage: false,
      });
      expect(service).toBeInstanceOf(InMemoryArtifactService);
    });

    it('should throw for unsupported URI with strictUri', async () => {
      await expect(
          createArtifactServiceFromOptions({
            baseDir: tempDir,
            artifactServiceUri: 'unknown://foo',
            strictUri: true,
          }),
      ).rejects.toThrow('Unsupported artifact service URI');
    });

    it('should fallback to in-memory for unsupported URI without strictUri', async () => {
      const service = await createArtifactServiceFromOptions({
        baseDir: tempDir,
        artifactServiceUri: 'unknown://foo',
        strictUri: false,
      });
      expect(service).toBeInstanceOf(InMemoryArtifactService);
    });
  });

  describe('createMemoryServiceFromOptions', () => {
    it('should create InMemoryMemoryService without URI', async () => {
      const service = await createMemoryServiceFromOptions({
        baseDir: tempDir,
      });
      expect(service).toBeInstanceOf(InMemoryMemoryService);
    });

    it('should throw for unsupported URI', async () => {
      await expect(
          createMemoryServiceFromOptions({
            baseDir: tempDir,
            memoryServiceUri: 'unknown://foo',
          }),
      ).rejects.toThrow('Unsupported memory service URI');
    });
  });

  describe('URI scheme parsing', () => {
    it('should parse gs:// URI correctly', async () => {
      const registry = getServiceRegistry();
      // Note: This will try to create a GcsArtifactService which requires GCS
      // so we just verify the scheme is recognized
      const result = await registry.createArtifactService('gs://my-bucket');
      // GcsArtifactService should be instantiated
      expect(result).toBeDefined();
    });
  });
});
