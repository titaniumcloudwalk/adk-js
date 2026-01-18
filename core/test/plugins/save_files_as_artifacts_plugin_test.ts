/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {InvocationContext, SaveFilesAsArtifactsPlugin} from '@google/adk';
import {
  BaseArtifactService,
  ArtifactVersion,
  SaveArtifactRequest,
  LoadArtifactRequest,
  ListArtifactKeysRequest,
  DeleteArtifactRequest,
  ListVersionsRequest,
  GetArtifactVersionRequest,
} from '@google/adk';
import {Content, Part} from '@google/genai';

describe('SaveFilesAsArtifactsPlugin', () => {
  /**
   * Mock artifact service for testing.
   */
  class MockArtifactService implements BaseArtifactService {
    savedArtifacts: Map<string, Part[]> = new Map();
    versions: Map<string, number> = new Map();
    canonicalUris: Map<string, string> = new Map();
    shouldFailSave = false;
    shouldFailGetVersion = false;

    async saveArtifact(request: SaveArtifactRequest): Promise<number> {
      if (this.shouldFailSave) {
        throw new Error('Mock save failure');
      }
      const key = `${request.appName}/${request.userId}/${request.sessionId}/${request.filename}`;
      const existing = this.savedArtifacts.get(key) || [];
      existing.push(request.artifact);
      this.savedArtifacts.set(key, existing);
      const version = this.versions.get(key) ?? -1;
      const newVersion = version + 1;
      this.versions.set(key, newVersion);
      return newVersion;
    }

    async loadArtifact(request: LoadArtifactRequest): Promise<Part | undefined> {
      const key = `${request.appName}/${request.userId}/${request.sessionId}/${request.filename}`;
      const artifacts = this.savedArtifacts.get(key);
      if (!artifacts || artifacts.length === 0) {
        return undefined;
      }
      const version = request.version ?? artifacts.length - 1;
      return artifacts[version];
    }

    async listArtifactKeys(
      request: ListArtifactKeysRequest
    ): Promise<string[]> {
      const prefix = `${request.appName}/${request.userId}/${request.sessionId}/`;
      const keys: string[] = [];
      for (const key of this.savedArtifacts.keys()) {
        if (key.startsWith(prefix)) {
          keys.push(key.substring(prefix.length));
        }
      }
      return keys;
    }

    async deleteArtifact(request: DeleteArtifactRequest): Promise<void> {
      const key = `${request.appName}/${request.userId}/${request.sessionId}/${request.filename}`;
      this.savedArtifacts.delete(key);
      this.versions.delete(key);
    }

    async listVersions(request: ListVersionsRequest): Promise<number[]> {
      const key = `${request.appName}/${request.userId}/${request.sessionId}/${request.filename}`;
      const artifacts = this.savedArtifacts.get(key);
      if (!artifacts) {
        return [];
      }
      return artifacts.map((_, i) => i);
    }

    async getArtifactVersion(
      request: GetArtifactVersionRequest
    ): Promise<ArtifactVersion | undefined> {
      if (this.shouldFailGetVersion) {
        throw new Error('Mock getArtifactVersion failure');
      }
      const key = `${request.appName}/${request.userId}/${request.sessionId}/${request.filename}`;
      const version = request.version ?? this.versions.get(key) ?? 0;
      const canonicalUri = this.canonicalUris.get(key);

      if (canonicalUri !== undefined) {
        return {
          version,
          canonicalUri,
          createTime: Date.now(),
        };
      }
      return undefined;
    }

    setCanonicalUri(appName: string, userId: string, sessionId: string, filename: string, uri: string): void {
      const key = `${appName}/${userId}/${sessionId}/${filename}`;
      this.canonicalUris.set(key, uri);
    }
  }

  function createMockInvocationContext(
    artifactService?: BaseArtifactService
  ): InvocationContext {
    return {
      appName: 'test-app',
      userId: 'test-user',
      invocationId: 'inv-123',
      session: {id: 'session-456'},
      artifactService,
    } as unknown as InvocationContext;
  }

  describe('initialization', () => {
    it('should initialize with default name', () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      expect(plugin.name).toEqual('save_files_as_artifacts_plugin');
    });

    it('should initialize with custom name', () => {
      const plugin = new SaveFilesAsArtifactsPlugin({
        name: 'my_artifact_plugin',
      });
      expect(plugin.name).toEqual('my_artifact_plugin');
    });
  });

  describe('onUserMessageCallback', () => {
    it('should return undefined when artifact service is not set', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const context = createMockInvocationContext(undefined);
      const userMessage: Content = {
        role: 'user',
        parts: [{inlineData: {mimeType: 'text/plain', data: 'SGVsbG8='}}],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined when user message has no parts', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
        parts: [],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined when user message has undefined parts', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
      } as Content;

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeUndefined();
    });

    it('should return undefined when there are no inline_data parts', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
        parts: [{text: 'Hello world'}],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeUndefined();
    });

    it('should save inline_data as artifact and replace with placeholder', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'text/plain',
              data: 'SGVsbG8gV29ybGQ=', // "Hello World" in base64
              displayName: 'greeting.txt',
            },
          },
        ],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeDefined();
      expect(result!.role).toEqual('user');
      expect(result!.parts!.length).toEqual(1);
      expect(result!.parts![0].text).toEqual(
        '[Uploaded Artifact: "greeting.txt"]'
      );

      // Verify artifact was saved
      const savedArtifacts = artifactService.savedArtifacts;
      expect(savedArtifacts.size).toEqual(1);
      const key = 'test-app/test-user/session-456/greeting.txt';
      expect(savedArtifacts.has(key)).toBe(true);
    });

    it('should generate filename when displayName is not provided', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'image/png',
              data: 'iVBORw0KGgo=', // Minimal PNG header
            },
          },
        ],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeDefined();
      expect(result!.parts![0].text).toContain('[Uploaded Artifact: "artifact_inv-123_0"]');

      const key = 'test-app/test-user/session-456/artifact_inv-123_0';
      expect(artifactService.savedArtifacts.has(key)).toBe(true);
    });

    it('should preserve non-inline_data parts', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
        parts: [
          {text: 'Here is a file:'},
          {
            inlineData: {
              mimeType: 'text/plain',
              data: 'dGVzdA==',
              displayName: 'test.txt',
            },
          },
          {text: 'Please process it.'},
        ],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeDefined();
      expect(result!.parts!.length).toEqual(3);
      expect(result!.parts![0].text).toEqual('Here is a file:');
      expect(result!.parts![1].text).toEqual('[Uploaded Artifact: "test.txt"]');
      expect(result!.parts![2].text).toEqual('Please process it.');
    });

    it('should handle multiple inline_data parts', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'text/plain',
              data: 'ZmlsZTE=',
              displayName: 'file1.txt',
            },
          },
          {
            inlineData: {
              mimeType: 'text/plain',
              data: 'ZmlsZTI=',
              displayName: 'file2.txt',
            },
          },
        ],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeDefined();
      expect(result!.parts!.length).toEqual(2);
      expect(result!.parts![0].text).toEqual('[Uploaded Artifact: "file1.txt"]');
      expect(result!.parts![1].text).toEqual('[Uploaded Artifact: "file2.txt"]');
      expect(artifactService.savedArtifacts.size).toEqual(2);
    });

    it('should keep original part when save fails', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      artifactService.shouldFailSave = true;
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'text/plain',
              data: 'dGVzdA==',
              displayName: 'fail.txt',
            },
          },
        ],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeUndefined();
    });

    it('should add file reference when artifact has model-accessible URI', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      artifactService.setCanonicalUri(
        'test-app',
        'test-user',
        'session-456',
        'cloud-file.txt',
        'gs://my-bucket/artifacts/cloud-file.txt'
      );
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'text/plain',
              data: 'Y2xvdWQgZGF0YQ==',
              displayName: 'cloud-file.txt',
            },
          },
        ],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeDefined();
      expect(result!.parts!.length).toEqual(2);
      expect(result!.parts![0].text).toEqual(
        '[Uploaded Artifact: "cloud-file.txt"]'
      );
      expect(result!.parts![1].fileData).toBeDefined();
      expect(result!.parts![1].fileData!.fileUri).toEqual(
        'gs://my-bucket/artifacts/cloud-file.txt'
      );
      expect(result!.parts![1].fileData!.mimeType).toEqual('text/plain');
      expect(result!.parts![1].fileData!.displayName).toEqual('cloud-file.txt');
    });

    it('should handle HTTPS URIs as model-accessible', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      artifactService.setCanonicalUri(
        'test-app',
        'test-user',
        'session-456',
        'web-file.txt',
        'https://storage.example.com/artifacts/web-file.txt'
      );
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'application/json',
              data: 'eyJrZXkiOiAidmFsdWUifQ==',
              displayName: 'web-file.txt',
            },
          },
        ],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeDefined();
      expect(result!.parts!.length).toEqual(2);
      expect(result!.parts![1].fileData!.fileUri).toEqual(
        'https://storage.example.com/artifacts/web-file.txt'
      );
    });

    it('should not add file reference for non-accessible URIs', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      artifactService.setCanonicalUri(
        'test-app',
        'test-user',
        'session-456',
        'local-file.txt',
        'file:///local/path/local-file.txt'
      );
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'text/plain',
              data: 'bG9jYWw=',
              displayName: 'local-file.txt',
            },
          },
        ],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeDefined();
      // Should only have placeholder, no file reference for file:// URI
      expect(result!.parts!.length).toEqual(1);
      expect(result!.parts![0].text).toEqual(
        '[Uploaded Artifact: "local-file.txt"]'
      );
    });

    it('should handle getArtifactVersion failure gracefully', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      artifactService.shouldFailGetVersion = true;
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'text/plain',
              data: 'dGVzdA==',
              displayName: 'error-test.txt',
            },
          },
        ],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeDefined();
      // Should have placeholder but no file reference due to error
      expect(result!.parts!.length).toEqual(1);
      expect(result!.parts![0].text).toEqual(
        '[Uploaded Artifact: "error-test.txt"]'
      );
      // Artifact should still be saved
      expect(artifactService.savedArtifacts.size).toEqual(1);
    });

    it('should not add file reference when canonicalUri is undefined', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      // Don't set any canonicalUri
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'text/plain',
              data: 'dGVzdA==',
              displayName: 'no-uri.txt',
            },
          },
        ],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeDefined();
      // Should only have placeholder
      expect(result!.parts!.length).toEqual(1);
    });

    it('should use mimeType from inlineData over artifactVersion', async () => {
      const plugin = new SaveFilesAsArtifactsPlugin();
      const artifactService = new MockArtifactService();
      artifactService.setCanonicalUri(
        'test-app',
        'test-user',
        'session-456',
        'mime-test.json',
        'gs://bucket/mime-test.json'
      );
      const context = createMockInvocationContext(artifactService);
      const userMessage: Content = {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: 'application/json',
              data: 'e30=',
              displayName: 'mime-test.json',
            },
          },
        ],
      };

      const result = await plugin.onUserMessageCallback({
        invocationContext: context,
        userMessage,
      });

      expect(result).toBeDefined();
      expect(result!.parts![1].fileData!.mimeType).toEqual('application/json');
    });
  });
});
