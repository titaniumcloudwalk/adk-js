/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, beforeEach} from 'vitest';
import {createPartFromText, Part} from '@google/genai';

import {CallbackContext} from '../../src/agents/callback_context.js';
import {InvocationContext} from '../../src/agents/invocation_context.js';
import {InMemoryArtifactService} from '../../src/artifacts/in_memory_artifact_service.js';
import {ArtifactVersion} from '../../src/artifacts/base_artifact_service.js';
import {InMemoryMemoryService} from '../../src/memory/in_memory_memory_service.js';
import {InMemorySessionService} from '../../src/sessions/in_memory_session_service.js';
import {Session} from '../../src/sessions/session.js';
import {PluginManager} from '../../src/plugins/plugin_manager.js';

describe('CallbackContext', () => {
  let invocationContext: InvocationContext;
  let callbackContext: CallbackContext;
  let artifactService: InMemoryArtifactService;
  let memoryService: InMemoryMemoryService;
  let session: Session;

  beforeEach(() => {
    artifactService = new InMemoryArtifactService();
    memoryService = new InMemoryMemoryService();
    session = {
      id: 'test-session',
      state: {},
      events: [],
      history: [],
    };

    invocationContext = {
      appName: 'test-app',
      userId: 'test-user',
      session,
      artifactService,
      memoryService,
      pluginManager: new PluginManager([]),
    } as InvocationContext;

    callbackContext = new CallbackContext({invocationContext});
  });

  describe('getArtifactVersion', () => {
    it('should get artifact version metadata', async () => {
      // Save an artifact
      const artifact = createPartFromText('test content');
      await callbackContext.saveArtifact('test.txt', artifact);

      // Get the artifact version
      const version = await callbackContext.getArtifactVersion('test.txt');

      expect(version).toBeDefined();
      expect(version?.version).toBe(0);
      expect(version?.canonicalUri).toContain('test.txt');
      expect(version?.createTime).toBeGreaterThan(0);
      expect(version?.customMetadata).toBeDefined();
    });

    it('should get specific version of artifact', async () => {
      // Save multiple versions
      await callbackContext.saveArtifact('test.txt', createPartFromText('v1'));
      await callbackContext.saveArtifact('test.txt', createPartFromText('v2'));
      await callbackContext.saveArtifact('test.txt', createPartFromText('v3'));

      // Get version 1
      const version1 = await callbackContext.getArtifactVersion('test.txt', 1);
      expect(version1?.version).toBe(1);

      // Get latest version (default)
      const latestVersion = await callbackContext.getArtifactVersion('test.txt');
      expect(latestVersion?.version).toBe(2);
    });

    it('should return undefined for non-existent artifact', async () => {
      const version = await callbackContext.getArtifactVersion('nonexistent.txt');
      expect(version).toBeUndefined();
    });

    it('should return undefined for invalid version', async () => {
      await callbackContext.saveArtifact('test.txt', createPartFromText('v1'));

      const version = await callbackContext.getArtifactVersion('test.txt', 999);
      expect(version).toBeUndefined();
    });

    it('should throw error when artifact service is not initialized', () => {
      const contextWithoutService = new CallbackContext({
        invocationContext: {
          ...invocationContext,
          artifactService: undefined,
        } as InvocationContext,
      });

      expect(() => {
        contextWithoutService.getArtifactVersion('test.txt');
      }).toThrow('Artifact service is not initialized.');
    });

    it('should extract MIME type from inline data', async () => {
      const artifact: Part = {
        inlineData: {
          data: 'base64data',
          mimeType: 'image/png',
        },
      };
      await callbackContext.saveArtifact('image.png', artifact);

      const version = await callbackContext.getArtifactVersion('image.png');
      expect(version?.mimeType).toBe('image/png');
    });
  });

  describe('listArtifacts', () => {
    it('should list all artifacts in session', async () => {
      // Save multiple artifacts
      await callbackContext.saveArtifact('file1.txt', createPartFromText('content1'));
      await callbackContext.saveArtifact('file2.txt', createPartFromText('content2'));
      await callbackContext.saveArtifact('file3.txt', createPartFromText('content3'));

      const artifacts = await callbackContext.listArtifacts();

      expect(artifacts).toHaveLength(3);
      expect(artifacts).toContain('file1.txt');
      expect(artifacts).toContain('file2.txt');
      expect(artifacts).toContain('file3.txt');
    });

    it('should return empty array when no artifacts exist', async () => {
      const artifacts = await callbackContext.listArtifacts();
      expect(artifacts).toEqual([]);
    });

    it('should return sorted artifact list', async () => {
      await callbackContext.saveArtifact('zebra.txt', createPartFromText('z'));
      await callbackContext.saveArtifact('apple.txt', createPartFromText('a'));
      await callbackContext.saveArtifact('banana.txt', createPartFromText('b'));

      const artifacts = await callbackContext.listArtifacts();

      expect(artifacts).toEqual(['apple.txt', 'banana.txt', 'zebra.txt']);
    });

    it('should include user-scoped artifacts', async () => {
      // Save session-scoped artifact
      await callbackContext.saveArtifact('session.txt', createPartFromText('session'));
      // Save user-scoped artifact (with user: prefix)
      await callbackContext.saveArtifact('user:profile.txt', createPartFromText('user'));

      const artifacts = await callbackContext.listArtifacts();

      expect(artifacts).toContain('session.txt');
      expect(artifacts).toContain('user:profile.txt');
    });

    it('should throw error when artifact service is not initialized', () => {
      const contextWithoutService = new CallbackContext({
        invocationContext: {
          ...invocationContext,
          artifactService: undefined,
        } as InvocationContext,
      });

      expect(() => {
        contextWithoutService.listArtifacts();
      }).toThrow('Artifact service is not initialized.');
    });
  });

  describe('addSessionToMemory', () => {
    it('should add session to memory service', async () => {
      // Add some events to the session
      session.events = [
        {
          role: 'user',
          parts: [{text: 'Hello, agent!'}],
        },
        {
          role: 'model',
          parts: [{text: 'Hello! How can I help you today?'}],
        },
      ];

      // Should not throw an error when adding to memory
      await expect(callbackContext.addSessionToMemory()).resolves.toBeUndefined();

      // Verify that memory service was called (memory was added)
      // Note: InMemoryMemoryService stores sessions in memory, so we can verify
      // by checking that a subsequent search doesn't error
      const result = await memoryService.searchMemory({
        appName: 'test-app',
        userId: 'test-user',
        query: 'Hello',
      });

      // Result should be defined even if empty
      expect(result.memories).toBeDefined();
    });

    it('should throw error when memory service is not available', async () => {
      const contextWithoutMemory = new CallbackContext({
        invocationContext: {
          ...invocationContext,
          memoryService: undefined,
        } as InvocationContext,
      });

      await expect(contextWithoutMemory.addSessionToMemory()).rejects.toThrow(
          'Cannot add session to memory: memory service is not available.'
      );
    });

    it('should handle empty session', async () => {
      session.events = [];

      await callbackContext.addSessionToMemory();

      // Should not throw error, just process empty session
      const result = await memoryService.searchMemory({
        appName: 'test-app',
        userId: 'test-user',
        query: 'anything',
      });

      // Memory may or may not have entries depending on implementation
      expect(result.memories).toBeDefined();
    });
  });

  describe('existing methods compatibility', () => {
    it('should still support loadArtifact', async () => {
      const artifact = createPartFromText('test content');
      await callbackContext.saveArtifact('test.txt', artifact);

      const loaded = await callbackContext.loadArtifact('test.txt');
      expect(loaded?.text).toBe('test content');
    });

    it('should still support saveArtifact', async () => {
      const artifact = createPartFromText('test content');
      const version = await callbackContext.saveArtifact('test.txt', artifact);

      expect(version).toBe(0);
      expect(callbackContext.eventActions.artifactDelta['test.txt']).toBe(0);
    });
  });

  describe('integration between methods', () => {
    it('should work together: save, list, get version', async () => {
      // Save artifacts
      await callbackContext.saveArtifact('file1.txt', createPartFromText('content1'));
      await callbackContext.saveArtifact('file2.txt', createPartFromText('content2'));

      // List artifacts
      const artifacts = await callbackContext.listArtifacts();
      expect(artifacts).toHaveLength(2);

      // Get version for each artifact
      for (const filename of artifacts) {
        const version = await callbackContext.getArtifactVersion(filename);
        expect(version).toBeDefined();
        expect(version?.version).toBe(0);
      }
    });

    it('should handle multiple versions correctly', async () => {
      // Save multiple versions of same file
      const versions = [];
      for (let i = 0; i < 5; i++) {
        const v = await callbackContext.saveArtifact(
            'document.txt',
            createPartFromText(`version ${i}`)
        );
        versions.push(v);
      }

      // List should show only one file
      const artifacts = await callbackContext.listArtifacts();
      expect(artifacts).toEqual(['document.txt']);

      // Get version should return latest by default
      const latestVersion = await callbackContext.getArtifactVersion('document.txt');
      expect(latestVersion?.version).toBe(4);

      // Get specific versions
      for (let i = 0; i < 5; i++) {
        const version = await callbackContext.getArtifactVersion('document.txt', i);
        expect(version?.version).toBe(i);
      }
    });
  });
});
