/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  migrateSession,
  MigrateSessionOptions,
  MigrationResult,
} from '../../src/cli/cli_migrate.js';
import {
  InMemorySessionService,
  createEvent,
  LlmAgent,
  Gemini,
} from '@google/adk';

describe('cli_migrate', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adk-migrate-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, {recursive: true, force: true});
  });

  describe('migrateSession', () => {
    it('validates that source and destination URIs are different', async () => {
      await expect(migrateSession({
        sourceUri: 'memory://',
        destUri: 'memory://',
        appName: 'test-app',
        userId: 'test-user',
      })).rejects.toThrow('Source and destination URIs must be different');
    });

    it('validates source URI format', async () => {
      await expect(migrateSession({
        sourceUri: 'invalid://path',
        destUri: 'memory://',
        appName: 'test-app',
        userId: 'test-user',
      })).rejects.toThrow('Invalid source URI');
    });

    it('validates destination URI format', async () => {
      await expect(migrateSession({
        sourceUri: 'memory://',
        destUri: 'invalid://path',
        appName: 'test-app',
        userId: 'test-user',
      })).rejects.toThrow('Invalid destination URI');
    });

    it('requires appName and userId for migration', async () => {
      const sourcePath = path.join(tempDir, 'source.db');
      const destPath = path.join(tempDir, 'dest.db');

      await expect(migrateSession({
        sourceUri: `sqlite:///${sourcePath}`,
        destUri: `sqlite:///${destPath}`,
        // Missing appName and userId
      })).rejects.toThrow('Both --app_name and --user_id are required');
    });

    it('migrates sessions between SQLite databases', async () => {
      const sourcePath = path.join(tempDir, 'source.db');
      const destPath = path.join(tempDir, 'dest.db');

      // Create source database with some sessions
      const {DatabaseSessionService} = await import('@google/adk');
      const sourceService = new DatabaseSessionService({
        dbUrl: `sqlite:///${sourcePath}`,
      });
      await sourceService.initialize();

      // Create a test session with events
      const session = await sourceService.createSession({
        appName: 'test-app',
        userId: 'test-user',
        sessionId: 'session-1',
        state: {counter: 0},
      });

      // Add some events
      const event1 = createEvent({
        author: 'user',
        invocationId: 'inv-1',
        content: {role: 'user', parts: [{text: 'Hello'}]},
      });
      await sourceService.appendEvent({session, event: event1});

      const event2 = createEvent({
        author: 'agent',
        invocationId: 'inv-1',
        content: {role: 'model', parts: [{text: 'Hi there!'}]},
      });
      await sourceService.appendEvent({session, event: event2});

      await sourceService.close();

      // Migrate
      const result = await migrateSession({
        sourceUri: `sqlite:///${sourcePath}`,
        destUri: `sqlite:///${destPath}`,
        appName: 'test-app',
        userId: 'test-user',
      });

      expect(result.totalSessions).toBe(1);
      expect(result.migratedSessions).toBe(1);
      expect(result.skippedSessions).toBe(0);
      expect(result.failedSessions).toBe(0);
      expect(result.totalEvents).toBe(2);
      expect(result.errors).toHaveLength(0);

      // Verify destination has the data
      const destService = new DatabaseSessionService({
        dbUrl: `sqlite:///${destPath}`,
      });
      await destService.initialize();

      const migratedSession = await destService.getSession({
        appName: 'test-app',
        userId: 'test-user',
        sessionId: 'session-1',
      });

      expect(migratedSession).toBeDefined();
      expect(migratedSession!.events).toHaveLength(2);
      expect(migratedSession!.events[0].content?.parts?.[0]).toEqual({text: 'Hello'});
      expect(migratedSession!.events[1].content?.parts?.[0]).toEqual({text: 'Hi there!'});

      await destService.close();
    });

    it('skips existing sessions by default', async () => {
      const sourcePath = path.join(tempDir, 'source.db');
      const destPath = path.join(tempDir, 'dest.db');

      const {DatabaseSessionService} = await import('@google/adk');

      // Create source with a session
      const sourceService = new DatabaseSessionService({
        dbUrl: `sqlite:///${sourcePath}`,
      });
      await sourceService.initialize();
      await sourceService.createSession({
        appName: 'test-app',
        userId: 'test-user',
        sessionId: 'existing-session',
        state: {},
      });
      await sourceService.close();

      // Create destination with the same session already present
      const destService = new DatabaseSessionService({
        dbUrl: `sqlite:///${destPath}`,
      });
      await destService.initialize();
      await destService.createSession({
        appName: 'test-app',
        userId: 'test-user',
        sessionId: 'existing-session',
        state: {},
      });
      await destService.close();

      // Migrate - should skip the existing session
      const result = await migrateSession({
        sourceUri: `sqlite:///${sourcePath}`,
        destUri: `sqlite:///${destPath}`,
        appName: 'test-app',
        userId: 'test-user',
        skipExisting: true,
      });

      expect(result.totalSessions).toBe(1);
      expect(result.migratedSessions).toBe(0);
      expect(result.skippedSessions).toBe(1);
      expect(result.failedSessions).toBe(0);
    });

    it('supports dry run mode', async () => {
      const sourcePath = path.join(tempDir, 'source.db');
      const destPath = path.join(tempDir, 'dest.db');

      const {DatabaseSessionService} = await import('@google/adk');

      // Create source with a session
      const sourceService = new DatabaseSessionService({
        dbUrl: `sqlite:///${sourcePath}`,
      });
      await sourceService.initialize();
      await sourceService.createSession({
        appName: 'test-app',
        userId: 'test-user',
        sessionId: 'session-1',
        state: {value: 42},
      });
      await sourceService.close();

      // Migrate in dry run mode
      const result = await migrateSession({
        sourceUri: `sqlite:///${sourcePath}`,
        destUri: `sqlite:///${destPath}`,
        appName: 'test-app',
        userId: 'test-user',
        dryRun: true,
      });

      expect(result.migratedSessions).toBe(1);

      // Verify destination is empty (dry run should not write)
      const destService = new DatabaseSessionService({
        dbUrl: `sqlite:///${destPath}`,
      });
      await destService.initialize();

      const {sessions} = await destService.listSessions({
        appName: 'test-app',
        userId: 'test-user',
      });

      expect(sessions).toHaveLength(0);
      await destService.close();
    });

    it('respects limit option', async () => {
      const sourcePath = path.join(tempDir, 'source.db');
      const destPath = path.join(tempDir, 'dest.db');

      const {DatabaseSessionService} = await import('@google/adk');

      // Create source with multiple sessions
      const sourceService = new DatabaseSessionService({
        dbUrl: `sqlite:///${sourcePath}`,
      });
      await sourceService.initialize();

      for (let i = 0; i < 5; i++) {
        await sourceService.createSession({
          appName: 'test-app',
          userId: 'test-user',
          sessionId: `session-${i}`,
          state: {},
        });
      }
      await sourceService.close();

      // Migrate with limit
      const result = await migrateSession({
        sourceUri: `sqlite:///${sourcePath}`,
        destUri: `sqlite:///${destPath}`,
        appName: 'test-app',
        userId: 'test-user',
        limit: 2,
      });

      expect(result.totalSessions).toBe(5);
      expect(result.migratedSessions).toBe(2);

      // Verify only 2 sessions in destination
      const destService = new DatabaseSessionService({
        dbUrl: `sqlite:///${destPath}`,
      });
      await destService.initialize();

      const {sessions} = await destService.listSessions({
        appName: 'test-app',
        userId: 'test-user',
      });

      expect(sessions).toHaveLength(2);
      await destService.close();
    });

    it('calls progress callback during migration', async () => {
      const sourcePath = path.join(tempDir, 'source.db');
      const destPath = path.join(tempDir, 'dest.db');

      const {DatabaseSessionService} = await import('@google/adk');

      // Create source with sessions
      const sourceService = new DatabaseSessionService({
        dbUrl: `sqlite:///${sourcePath}`,
      });
      await sourceService.initialize();
      await sourceService.createSession({
        appName: 'test-app',
        userId: 'test-user',
        sessionId: 'session-1',
        state: {},
      });
      await sourceService.createSession({
        appName: 'test-app',
        userId: 'test-user',
        sessionId: 'session-2',
        state: {},
      });
      await sourceService.close();

      // Track progress calls
      const progressCalls: Array<{
        current: number;
        total: number;
        sessionId: string;
        status: string;
      }> = [];

      await migrateSession({
        sourceUri: `sqlite:///${sourcePath}`,
        destUri: `sqlite:///${destPath}`,
        appName: 'test-app',
        userId: 'test-user',
      }, (progress) => {
        progressCalls.push({
          current: progress.current,
          total: progress.total,
          sessionId: progress.sessionId,
          status: progress.status,
        });
      });

      // Should have at least one progress call per session (status change)
      expect(progressCalls.length).toBeGreaterThanOrEqual(2);

      // Check that all status values are valid
      for (const call of progressCalls) {
        expect(['migrating', 'skipped', 'failed', 'success']).toContain(call.status);
      }

      // Should have at least one success callback
      const successCalls = progressCalls.filter(c => c.status === 'success');
      expect(successCalls.length).toBe(2);
    });

    it('migrates session state correctly', async () => {
      const sourcePath = path.join(tempDir, 'source.db');
      const destPath = path.join(tempDir, 'dest.db');

      const {DatabaseSessionService} = await import('@google/adk');

      // Create source with a session containing state
      const sourceService = new DatabaseSessionService({
        dbUrl: `sqlite:///${sourcePath}`,
      });
      await sourceService.initialize();

      await sourceService.createSession({
        appName: 'test-app',
        userId: 'test-user',
        sessionId: 'stateful-session',
        state: {
          counter: 42,
          name: 'Test Session',
          nested: {value: 'deep'},
        },
      });
      await sourceService.close();

      // Migrate
      await migrateSession({
        sourceUri: `sqlite:///${sourcePath}`,
        destUri: `sqlite:///${destPath}`,
        appName: 'test-app',
        userId: 'test-user',
      });

      // Verify state was migrated
      const destService = new DatabaseSessionService({
        dbUrl: `sqlite:///${destPath}`,
      });
      await destService.initialize();

      const migratedSession = await destService.getSession({
        appName: 'test-app',
        userId: 'test-user',
        sessionId: 'stateful-session',
      });

      expect(migratedSession).toBeDefined();
      // Note: Session.state is Record<string, unknown>, not State object
      expect(migratedSession!.state['counter']).toBe(42);
      expect(migratedSession!.state['name']).toBe('Test Session');
      expect(migratedSession!.state['nested']).toEqual({value: 'deep'});

      await destService.close();
    });

    it('handles empty source (no sessions)', async () => {
      const sourcePath = path.join(tempDir, 'empty-source.db');
      const destPath = path.join(tempDir, 'dest.db');

      const {DatabaseSessionService} = await import('@google/adk');

      // Create empty source database
      const sourceService = new DatabaseSessionService({
        dbUrl: `sqlite:///${sourcePath}`,
      });
      await sourceService.initialize();
      await sourceService.close();

      // Migrate
      const result = await migrateSession({
        sourceUri: `sqlite:///${sourcePath}`,
        destUri: `sqlite:///${destPath}`,
        appName: 'test-app',
        userId: 'test-user',
      });

      expect(result.totalSessions).toBe(0);
      expect(result.migratedSessions).toBe(0);
      expect(result.skippedSessions).toBe(0);
      expect(result.failedSessions).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('createServiceFromUri (via migrateSession)', () => {
    it('supports memory:// URI', async () => {
      // memory:// to sqlite:// migration test
      const destPath = path.join(tempDir, 'dest.db');

      // Since we can't pre-populate memory:// easily, just verify URI is valid
      const result = await migrateSession({
        sourceUri: 'memory://',
        destUri: `sqlite:///${destPath}`,
        appName: 'test-app',
        userId: 'test-user',
      });

      // Empty source should succeed
      expect(result.totalSessions).toBe(0);
    });

    it('supports sqlite:// URI', async () => {
      const sourcePath = path.join(tempDir, 'source.db');
      const destPath = path.join(tempDir, 'dest.db');

      const {DatabaseSessionService} = await import('@google/adk');

      // Create source
      const sourceService = new DatabaseSessionService({
        dbUrl: `sqlite:///${sourcePath}`,
      });
      await sourceService.initialize();
      await sourceService.createSession({
        appName: 'test-app',
        userId: 'test-user',
        state: {},
      });
      await sourceService.close();

      const result = await migrateSession({
        sourceUri: `sqlite:///${sourcePath}`,
        destUri: `sqlite:///${destPath}`,
        appName: 'test-app',
        userId: 'test-user',
      });

      expect(result.migratedSessions).toBe(1);
    });

    // Note: agentengine:// test skipped as it requires real Vertex AI credentials
  });
});
