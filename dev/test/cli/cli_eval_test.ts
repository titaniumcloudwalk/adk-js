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
  runEvaluation,
  createEvalSetCommand,
  addEvalCaseCommand,
  listEvalSetsCommand,
  showEvalSetCommand,
  deleteEvalSetCommand,
} from '../../src/cli/cli_eval.js';

describe('cli_eval', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temp directory for test eval sets
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'adk-eval-test-'));
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, {recursive: true, force: true});
  });

  describe('parseEvalSetSpec', () => {
    // These are internal functions tested via integration
    it('handles eval set ID without filter', async () => {
      // Create a mock agent file
      const agentPath = path.join(tempDir, 'test_agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = {
          name: 'test_agent',
        };
      `);

      // Create an eval set
      await createEvalSetCommand({
        agentPath,
        evalSetId: 'test_eval_set',
        name: 'Test Eval Set',
        evalStorageUri: tempDir,
      });

      // Verify it was created
      const evalSetPath = path.join(tempDir, 'test_agent', 'eval_sets', 'test_eval_set.json');
      const content = await fs.readFile(evalSetPath, 'utf-8');
      const evalSet = JSON.parse(content);

      expect(evalSet.evalSetId).toBe('test_eval_set');
      expect(evalSet.name).toBe('Test Eval Set');
      expect(evalSet.evalCases).toHaveLength(0);
    });
  });

  describe('createEvalSetCommand', () => {
    it('creates an empty eval set', async () => {
      const agentPath = path.join(tempDir, 'agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = { name: 'agent' };
      `);

      await createEvalSetCommand({
        agentPath,
        evalSetId: 'my_eval_set',
        name: 'My Eval Set',
        description: 'A test eval set',
        evalStorageUri: tempDir,
      });

      const evalSetPath = path.join(tempDir, 'agent', 'eval_sets', 'my_eval_set.json');
      const content = await fs.readFile(evalSetPath, 'utf-8');
      const evalSet = JSON.parse(content);

      expect(evalSet.evalSetId).toBe('my_eval_set');
      expect(evalSet.name).toBe('My Eval Set');
      expect(evalSet.description).toBe('A test eval set');
      expect(evalSet.evalCases).toHaveLength(0);
      expect(evalSet.creationTimestamp).toBeDefined();
    });

    it('throws error when eval set already exists', async () => {
      const agentPath = path.join(tempDir, 'agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = { name: 'agent' };
      `);

      await createEvalSetCommand({
        agentPath,
        evalSetId: 'duplicate_set',
        evalStorageUri: tempDir,
      });

      await expect(
        createEvalSetCommand({
          agentPath,
          evalSetId: 'duplicate_set',
          evalStorageUri: tempDir,
        })
      ).rejects.toThrow(/already exists/);
    });
  });

  describe('addEvalCaseCommand', () => {
    it('adds eval cases from scenarios file', async () => {
      const agentPath = path.join(tempDir, 'agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = { name: 'agent' };
      `);

      // First create the eval set
      await createEvalSetCommand({
        agentPath,
        evalSetId: 'scenarios_test',
        evalStorageUri: tempDir,
      });

      // Create a scenarios file
      const scenariosFile = path.join(tempDir, 'scenarios.json');
      await fs.writeFile(scenariosFile, JSON.stringify([
        {
          evalId: 'scenario_1',
          scenario: {
            scenarioDescription: 'Test user asking about weather',
            maxTurns: 3,
          },
        },
        {
          evalId: 'scenario_2',
          scenario: {
            scenarioDescription: 'Test user asking for help',
            initialMessage: {
              parts: [{text: 'Help me please'}],
              role: 'user',
            },
            maxTurns: 2,
          },
        },
      ]));

      // Add the cases
      await addEvalCaseCommand({
        agentPath,
        evalSetId: 'scenarios_test',
        scenariosFile,
        evalStorageUri: tempDir,
      });

      // Verify the cases were added
      const evalSetPath = path.join(tempDir, 'agent', 'eval_sets', 'scenarios_test.json');
      const content = await fs.readFile(evalSetPath, 'utf-8');
      const evalSet = JSON.parse(content);

      expect(evalSet.evalCases).toHaveLength(2);
      expect(evalSet.evalCases[0].evalId).toBe('scenario_1');
      expect(evalSet.evalCases[0].conversationScenario.scenarioDescription).toBe(
        'Test user asking about weather'
      );
      expect(evalSet.evalCases[1].evalId).toBe('scenario_2');
      expect(evalSet.evalCases[1].conversationScenario.initialMessage).toBeDefined();
    });

    it('adds eval cases from session input file', async () => {
      const agentPath = path.join(tempDir, 'agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = { name: 'agent' };
      `);

      await createEvalSetCommand({
        agentPath,
        evalSetId: 'session_input_test',
        evalStorageUri: tempDir,
      });

      // Create a session input file
      const sessionInputFile = path.join(tempDir, 'session_inputs.json');
      await fs.writeFile(sessionInputFile, JSON.stringify([
        {
          evalId: 'case_1',
          conversation: [
            {
              invocationId: 'inv_1',
              userContent: {parts: [{text: 'Hello'}], role: 'user'},
              finalResponse: {parts: [{text: 'Hi there!'}], role: 'model'},
              creationTimestamp: Date.now(),
            },
          ],
          sessionInput: {
            state: {key1: 'value1'},
          },
        },
      ]));

      await addEvalCaseCommand({
        agentPath,
        evalSetId: 'session_input_test',
        sessionInputFile,
        evalStorageUri: tempDir,
      });

      const evalSetPath = path.join(tempDir, 'agent', 'eval_sets', 'session_input_test.json');
      const content = await fs.readFile(evalSetPath, 'utf-8');
      const evalSet = JSON.parse(content);

      expect(evalSet.evalCases).toHaveLength(1);
      expect(evalSet.evalCases[0].evalId).toBe('case_1');
      expect(evalSet.evalCases[0].conversation).toHaveLength(1);
      expect(evalSet.evalCases[0].sessionInput?.state?.key1).toBe('value1');
    });

    it('throws error when eval set not found', async () => {
      const agentPath = path.join(tempDir, 'agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = { name: 'agent' };
      `);

      await expect(
        addEvalCaseCommand({
          agentPath,
          evalSetId: 'nonexistent',
          evalStorageUri: tempDir,
        })
      ).rejects.toThrow(/not found/);
    });
  });

  describe('deleteEvalSetCommand', () => {
    it('deletes an existing eval set', async () => {
      const agentPath = path.join(tempDir, 'agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = { name: 'agent' };
      `);

      await createEvalSetCommand({
        agentPath,
        evalSetId: 'to_delete',
        evalStorageUri: tempDir,
      });

      // Verify it exists
      const evalSetPath = path.join(tempDir, 'agent', 'eval_sets', 'to_delete.json');
      await expect(fs.access(evalSetPath)).resolves.toBeUndefined();

      // Delete it
      await deleteEvalSetCommand(agentPath, 'to_delete', tempDir);

      // Verify it's gone
      await expect(fs.access(evalSetPath)).rejects.toThrow();
    });

    it('throws error when eval set not found', async () => {
      const agentPath = path.join(tempDir, 'agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = { name: 'agent' };
      `);

      await expect(
        deleteEvalSetCommand(agentPath, 'nonexistent', tempDir)
      ).rejects.toThrow(/not found/);
    });
  });

  describe('loadEvalConfig', () => {
    it('uses default metrics when no config file provided', async () => {
      // This is tested indirectly via runEvaluation
      // Default config should include tool_trajectory_avg_score and response_match_score
      // We just verify the function doesn't throw
      const agentPath = path.join(tempDir, 'agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = { name: 'agent' };
      `);

      // No eval sets, so it should exit early but not crash
      const result = await runEvaluation({
        agentPath,
        evalSets: [],
        evalStorageUri: tempDir,
      });

      expect(result).toBe(0); // No cases = no failures = success
    });

    it('loads metrics from config file', async () => {
      const agentPath = path.join(tempDir, 'agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = { name: 'agent' };
      `);

      const configPath = path.join(tempDir, 'eval_config.json');
      await fs.writeFile(configPath, JSON.stringify({
        metrics: [
          {
            metricName: 'tool_trajectory_avg_score',
            threshold: 0.9,
            criterion: {
              type: 'tool_trajectory',
              matchType: 'EXACT',
            },
          },
        ],
        numRepeats: 1,
      }));

      // Just verify it doesn't crash with custom config
      const result = await runEvaluation({
        agentPath,
        evalSets: [],
        configFile: configPath,
        evalStorageUri: tempDir,
      });

      expect(result).toBe(0);
    });

    it('loads config with criteria format (Python pattern)', async () => {
      const agentPath = path.join(tempDir, 'agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = { name: 'agent' };
      `);

      // Use the Python-style criteria format
      const configPath = path.join(tempDir, 'eval_config.json');
      await fs.writeFile(configPath, JSON.stringify({
        criteria: {
          tool_trajectory_avg_score: 0.8,
          response_match_score: 0.7,
        },
      }));

      const result = await runEvaluation({
        agentPath,
        evalSets: [],
        configFile: configPath,
        evalStorageUri: tempDir,
      });

      expect(result).toBe(0);
    });

    it('loads config with custom metrics', async () => {
      const agentPath = path.join(tempDir, 'agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = { name: 'agent' };
      `);

      // Config with custom metrics
      const configPath = path.join(tempDir, 'eval_config.json');
      await fs.writeFile(configPath, JSON.stringify({
        criteria: {
          tool_trajectory_avg_score: 0.8,
          my_custom_metric: 0.5,
        },
        customMetrics: {
          my_custom_metric: {
            codeConfig: {
              name: 'my_module.my_function',
            },
          },
        },
      }));

      // Just verify it doesn't crash when loading the config
      // (the actual function loading will fail since the module doesn't exist)
      const result = await runEvaluation({
        agentPath,
        evalSets: [],
        configFile: configPath,
        evalStorageUri: tempDir,
      });

      expect(result).toBe(0);
    });

    it('loads config with customFunctionPath in metrics array', async () => {
      const agentPath = path.join(tempDir, 'agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = { name: 'agent' };
      `);

      // Config using the metrics array format with customFunctionPath
      const configPath = path.join(tempDir, 'eval_config.json');
      await fs.writeFile(configPath, JSON.stringify({
        metrics: [
          {
            metricName: 'tool_trajectory_avg_score',
            threshold: 0.8,
          },
          {
            metricName: 'my_custom_metric',
            threshold: 0.5,
            customFunctionPath: 'my_module.my_function',
          },
        ],
      }));

      const result = await runEvaluation({
        agentPath,
        evalSets: [],
        configFile: configPath,
        evalStorageUri: tempDir,
      });

      expect(result).toBe(0);
    });

    it('returns error exit code when no metrics found in config file', async () => {
      const agentPath = path.join(tempDir, 'agent.js');
      await fs.writeFile(agentPath, `
        export const rootAgent = { name: 'agent' };
      `);

      // Create an eval set first so we don't fail on that
      await createEvalSetCommand({
        agentPath,
        evalSetId: 'test_empty_config',
        evalStorageUri: tempDir,
      });

      // Empty config - no criteria and no metrics
      const configPath = path.join(tempDir, 'eval_config.json');
      await fs.writeFile(configPath, JSON.stringify({}));

      // Should return exit code 1 (failure) when config has no metrics
      const result = await runEvaluation({
        agentPath,
        evalSets: ['test_empty_config'],
        configFile: configPath,
        evalStorageUri: tempDir,
      });

      // runEvaluation returns exit codes: 0 for success, 1 for failure
      expect(result).toBe(1);
    });
  });
});
