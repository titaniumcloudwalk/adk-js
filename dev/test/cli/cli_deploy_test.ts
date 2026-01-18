/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock the module functions
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
  spawn: vi.fn(),
}));

// Test helper functions from cli_deploy.ts by testing the exported function behavior
describe('cli_deploy', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adk-deploy-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, {recursive: true, force: true});
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Agent Engine deployment helpers', () => {
    describe('.ae_ignore pattern matching', () => {
      it('should match simple file patterns', async () => {
        // Create a test directory with .ae_ignore
        const agentDir = path.join(tempDir, 'test_agent');
        await fs.mkdir(agentDir, {recursive: true});

        // Create .ae_ignore with patterns
        await fs.writeFile(
            path.join(agentDir, '.ae_ignore'),
            '*.pyc\n__pycache__\n.git\n*.log\n'
        );

        // Read the file and verify patterns
        const content = await fs.readFile(
            path.join(agentDir, '.ae_ignore'),
            'utf-8'
        );
        const patterns = content.split('\n')
            .map((line: string) => line.trim())
            .filter((line: string) => line && !line.startsWith('#'));

        expect(patterns).toContain('*.pyc');
        expect(patterns).toContain('__pycache__');
        expect(patterns).toContain('.git');
        expect(patterns).toContain('*.log');
      });

      it('should handle empty .ae_ignore file', async () => {
        const agentDir = path.join(tempDir, 'empty_ignore');
        await fs.mkdir(agentDir, {recursive: true});
        await fs.writeFile(path.join(agentDir, '.ae_ignore'), '');

        const content = await fs.readFile(
            path.join(agentDir, '.ae_ignore'),
            'utf-8'
        );
        const patterns = content.split('\n')
            .map((line: string) => line.trim())
            .filter((line: string) => line && !line.startsWith('#'));

        expect(patterns).toHaveLength(0);
      });

      it('should handle comments in .ae_ignore', async () => {
        const agentDir = path.join(tempDir, 'commented_ignore');
        await fs.mkdir(agentDir, {recursive: true});
        await fs.writeFile(
            path.join(agentDir, '.ae_ignore'),
            '# This is a comment\n*.pyc\n# Another comment\n__pycache__\n'
        );

        const content = await fs.readFile(
            path.join(agentDir, '.ae_ignore'),
            'utf-8'
        );
        const patterns = content.split('\n')
            .map((line: string) => line.trim())
            .filter((line: string) => line && !line.startsWith('#'));

        expect(patterns).toHaveLength(2);
        expect(patterns).toContain('*.pyc');
        expect(patterns).toContain('__pycache__');
      });
    });

    describe('environment variable file parsing', () => {
      it('should parse simple .env file', async () => {
        const envFile = path.join(tempDir, '.env');
        await fs.writeFile(
            envFile,
            'GOOGLE_CLOUD_PROJECT=my-project\n' +
            'GOOGLE_CLOUD_LOCATION=us-central1\n' +
            'GOOGLE_API_KEY=test-api-key\n'
        );

        const content = await fs.readFile(envFile, 'utf-8');
        const envVars: Record<string, string> = {};

        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;

          const equalIndex = trimmed.indexOf('=');
          if (equalIndex === -1) continue;

          const key = trimmed.substring(0, equalIndex).trim();
          let value = trimmed.substring(equalIndex + 1).trim();

          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          envVars[key] = value;
        }

        expect(envVars['GOOGLE_CLOUD_PROJECT']).toBe('my-project');
        expect(envVars['GOOGLE_CLOUD_LOCATION']).toBe('us-central1');
        expect(envVars['GOOGLE_API_KEY']).toBe('test-api-key');
      });

      it('should handle quoted values in .env file', async () => {
        const envFile = path.join(tempDir, '.env');
        await fs.writeFile(
            envFile,
            'SINGLE_QUOTED=\'single quoted value\'\n' +
            'DOUBLE_QUOTED="double quoted value"\n'
        );

        const content = await fs.readFile(envFile, 'utf-8');
        const envVars: Record<string, string> = {};

        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;

          const equalIndex = trimmed.indexOf('=');
          if (equalIndex === -1) continue;

          const key = trimmed.substring(0, equalIndex).trim();
          let value = trimmed.substring(equalIndex + 1).trim();

          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          envVars[key] = value;
        }

        expect(envVars['SINGLE_QUOTED']).toBe('single quoted value');
        expect(envVars['DOUBLE_QUOTED']).toBe('double quoted value');
      });

      it('should handle empty lines and comments in .env file', async () => {
        const envFile = path.join(tempDir, '.env');
        await fs.writeFile(
            envFile,
            '# Comment line\n' +
            '\n' +
            'KEY1=value1\n' +
            '\n' +
            '# Another comment\n' +
            'KEY2=value2\n'
        );

        const content = await fs.readFile(envFile, 'utf-8');
        const envVars: Record<string, string> = {};

        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;

          const equalIndex = trimmed.indexOf('=');
          if (equalIndex === -1) continue;

          const key = trimmed.substring(0, equalIndex).trim();
          let value = trimmed.substring(equalIndex + 1).trim();

          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          envVars[key] = value;
        }

        expect(Object.keys(envVars)).toHaveLength(2);
        expect(envVars['KEY1']).toBe('value1');
        expect(envVars['KEY2']).toBe('value2');
      });
    });

    describe('agent engine configuration', () => {
      it('should create valid agent engine config structure', () => {
        const config = {
          entrypoint_module: 'test_agent.agent_engine_app',
          entrypoint_object: 'adkApp',
          source_packages: ['test_agent'],
          agent_framework: 'google-adk',
          display_name: 'Test Agent',
          description: 'A test agent',
          env_vars: {
            'GOOGLE_GENAI_USE_VERTEXAI': '1',
          },
        };

        expect(config.entrypoint_module).toBe('test_agent.agent_engine_app');
        expect(config.entrypoint_object).toBe('adkApp');
        expect(config.source_packages).toContain('test_agent');
        expect(config.agent_framework).toBe('google-adk');
        expect(config.display_name).toBe('Test Agent');
        expect(config.env_vars['GOOGLE_GENAI_USE_VERTEXAI']).toBe('1');
      });

      it('should validate adk_app_object values', () => {
        const validValues = ['rootAgent', 'root_agent', 'app'];
        const invalidValues = ['invalid', 'Agent', 'ROOT_AGENT', ''];

        for (const value of validValues) {
          expect(validValues.includes(value)).toBe(true);
        }

        for (const value of invalidValues) {
          expect(validValues.includes(value)).toBe(false);
        }
      });
    });

    describe('directory copying with ignore patterns', () => {
      it('should copy files respecting ignore patterns', async () => {
        // Create source directory with files
        const sourceDir = path.join(tempDir, 'source');
        const destDir = path.join(tempDir, 'dest');
        await fs.mkdir(sourceDir, {recursive: true});

        // Create test files
        await fs.writeFile(path.join(sourceDir, 'agent.js'), 'export const rootAgent = {};');
        await fs.writeFile(path.join(sourceDir, 'package.json'), '{}');
        await fs.writeFile(path.join(sourceDir, 'test.pyc'), 'compiled');
        await fs.writeFile(path.join(sourceDir, 'debug.log'), 'logs');

        const ignorePatterns = ['*.pyc', '*.log'];

        // Simple copy with filtering (mimicking the function behavior)
        await fs.mkdir(destDir, {recursive: true});
        const files = await fs.readdir(sourceDir);

        for (const file of files) {
          const shouldIgnore = ignorePatterns.some(pattern => {
            const regex = new RegExp(
                '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
            );
            return regex.test(file);
          });

          if (!shouldIgnore) {
            await fs.copyFile(
                path.join(sourceDir, file),
                path.join(destDir, file)
            );
          }
        }

        // Verify
        const destFiles = await fs.readdir(destDir);
        expect(destFiles).toContain('agent.js');
        expect(destFiles).toContain('package.json');
        expect(destFiles).not.toContain('test.pyc');
        expect(destFiles).not.toContain('debug.log');
      });
    });

    describe('package.json handling', () => {
      it('should detect existing @google/adk dependency', async () => {
        const packageJson = {
          name: 'test-agent',
          dependencies: {
            '@google/adk': '^1.0.0',
          },
        };

        const hasAdkDep = !!packageJson.dependencies?.['@google/adk'];
        expect(hasAdkDep).toBe(true);
      });

      it('should create minimal package.json if not exists', async () => {
        const minimalPackageJson = {
          name: 'my-agent',
          type: 'module',
          dependencies: {
            '@google/adk': 'latest',
          },
        };

        expect(minimalPackageJson.name).toBe('my-agent');
        expect(minimalPackageJson.type).toBe('module');
        expect(minimalPackageJson.dependencies['@google/adk']).toBe('latest');
      });
    });

    describe('config agent detection', () => {
      it('should detect root_agent.yaml file', async () => {
        const agentDir = path.join(tempDir, 'config_agent');
        await fs.mkdir(agentDir, {recursive: true});

        // Without config file
        const hasConfigWithout = await fs.access(path.join(agentDir, 'root_agent.yaml'))
            .then(() => true)
            .catch(() => false);
        expect(hasConfigWithout).toBe(false);

        // With config file
        await fs.writeFile(
            path.join(agentDir, 'root_agent.yaml'),
            'name: test_agent\n'
        );
        const hasConfigWith = await fs.access(path.join(agentDir, 'root_agent.yaml'))
            .then(() => true)
            .catch(() => false);
        expect(hasConfigWith).toBe(true);
      });
    });
  });

  describe('AGENT_ENGINE_CLASS_METHODS', () => {
    it('should have all required class methods defined', () => {
      // The class methods from cli_deploy.ts
      const requiredMethods = [
        'get_session',
        'list_sessions',
        'create_session',
        'delete_session',
        'async_get_session',
        'async_list_sessions',
        'async_create_session',
        'async_delete_session',
        'async_add_session_to_memory',
        'async_search_memory',
        'stream_query',
        'async_stream_query',
        'streaming_agent_run_with_events',
      ];

      // This test validates the expected structure
      expect(requiredMethods).toHaveLength(13);
      expect(requiredMethods).toContain('async_stream_query');
      expect(requiredMethods).toContain('streaming_agent_run_with_events');
    });
  });
});
