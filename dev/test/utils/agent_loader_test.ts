/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import esbuild from 'esbuild';
import {exec} from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {promisify} from 'node:util';
import {afterEach, beforeEach, describe, expect, it, Mock, vi} from 'vitest';

import {AgentFile, AgentLoader} from '../../src/utils/agent_loader';
import * as fileUtils from '../../src/utils/file_utils.js';

const execAsync = promisify(exec);

vi.mock('../../src/utils/file_utils.js', () => ({
                                           getTempDir: vi.fn(),
                                           isFile: vi.fn(),
                                         }));

vi.mock('esbuild', () => ({
                     default: {
                       build: vi.fn(),
                     }
                   }));

const agent1JsContent = `
import {BaseAgent} from '@google/adk';

class FakeAgent1 extends BaseAgent {
  constructor(name) {
    super({ name });
  }
}
exports.rootAgent = new FakeAgent1('agent1');`;

const agent2TsContent = `
import {BaseAgent} from '@google/adk';

class FakeAgent2 extends BaseAgent {
  constructor(public name: string) {
    super({ name });
  }
}
export const rootAgent = new FakeAgent2('agent2');`;

const agent2CjsContentMocked = `
"use strict";
const {BaseAgent} = require('@google/adk');

class FakeAgent2 extends BaseAgent {
    constructor(name) {
      super({ name });
    }
}
exports.rootAgent = new FakeAgent2('agent2');
`;

const agent3JsContent = `
const {BaseAgent} = require('@google/adk');

class FakeAgent3 extends BaseAgent {
  constructor(name) {
    super({ name });
  }
}
exports.rootAgent = new FakeAgent3('agent3');`;

describe('AgentLoader', () => {
  let tempAgentsDir: string;

  beforeEach(async () => {
    tempAgentsDir =
        await fs.mkdtemp(path.join(os.tmpdir(), 'adk-test-agents-'));
    (fileUtils.getTempDir as Mock).mockImplementation(() => tempAgentsDir);
    await initNpmProject();
  });

  afterEach(async () => {
    await fs.rm(tempAgentsDir, {recursive: true, force: true});
    vi.clearAllMocks();
  });

  async function initNpmProject() {
    await fs.writeFile(
        path.join(tempAgentsDir, 'package.json'),
        JSON.stringify({
          name: 'test-agents',
          version: '1.0.0',
          dependencies: {
            '@google/adk':
                `file:${path.dirname(require.resolve('@google/adk'))}`,
          }
        }),
    );

    await execAsync('npm install', {cwd: tempAgentsDir});
  }

  describe('AgentFile', () => {
    it('loads .js agent file', async () => {
      const agentPath = path.join(tempAgentsDir, 'agent1.js');
      await fs.writeFile(agentPath, agent1JsContent);

      const agentFile = new AgentFile(agentPath);
      const agent = await agentFile.load();

      expect(agent.name).toEqual('agent1');
      await agentFile.dispose();
    });

    it('loads .ts agent file and compiles it', async () => {
      const agentPath = path.join(tempAgentsDir, 'agent2.ts');
      const compiledAgentPath = path.join(tempAgentsDir, 'agent2.cjs');
      await fs.writeFile(agentPath, agent2TsContent);

      (esbuild.build as Mock).mockImplementation(async () => {
        await fs.writeFile(compiledAgentPath, agent2CjsContentMocked);
        return Promise.resolve();
      });

      const agentFile = new AgentFile(agentPath);
      const agent = await agentFile.load();

      expect(agent.name).toEqual('agent2');
      expect(esbuild.build).toHaveBeenCalledWith({
        entryPoints: [agentPath],
        outfile: compiledAgentPath,
        target: 'node10.4',
        platform: 'node',
        format: 'cjs',
        packages: 'bundle',
        bundle: true,
        minify: true,
        allowOverwrite: true,
        external: [
          'litellm',
          '@anthropic-ai/sdk',
          '@google-cloud/bigquery',
          '@google-cloud/pubsub',
          '@google-cloud/spanner',
          '@google-cloud/storage',
          '@google-cloud/opentelemetry-cloud-monitoring-exporter',
          '@google-cloud/opentelemetry-cloud-trace-exporter',
          '@kubernetes/client-node',
          '@opentelemetry/api-logs',
          '@opentelemetry/exporter-logs-otlp-http',
          '@opentelemetry/exporter-metrics-otlp-http',
          '@opentelemetry/exporter-trace-otlp-http',
          '@opentelemetry/resource-detector-gcp',
          '@opentelemetry/resources',
          '@opentelemetry/sdk-logs',
          '@opentelemetry/sdk-metrics',
          '@opentelemetry/sdk-trace-base',
          '@opentelemetry/sdk-trace-node',
          'better-sqlite3',
          'dockerode',
        ],
      });

      await agentFile.dispose();
      await expect(fs.access(compiledAgentPath)).rejects.toThrow();
    });

    it('throws if rootAgent is not found', async () => {
      const agentPath = path.join(tempAgentsDir, 'bad_agent.js');
      await fs.writeFile(agentPath, 'exports.someOther = 1;');

      const agentFile = new AgentFile(agentPath);
      await expect(agentFile.load())
          .rejects.toThrow(
              `Failed to load agent ${
                  agentPath}: No @google/adk BaseAgent class instance found. Please check that file is not empty and it has export of @google/adk BaseAgent class (e.g. LlmAgent) instance.`,
          );
      await agentFile.dispose();
    });
  });

  describe('AgentLoader', () => {
    beforeEach(async () => {
      await fs.writeFile(
          path.join(tempAgentsDir, 'agent1.js'),
          agent1JsContent,
      );

      const agent2Path = path.join(tempAgentsDir, 'agent2.ts');
      const compiledAgent2Path = path.join(tempAgentsDir, 'agent2.cjs');
      await fs.writeFile(agent2Path, agent2TsContent);

      await fs.mkdir(path.join(tempAgentsDir, 'agent3'));
      await fs.writeFile(
          path.join(tempAgentsDir, 'agent3', 'agent.js'),
          agent3JsContent,
      );

      (esbuild.build as Mock).mockImplementation(async (options: any) => {
        if (options.entryPoints[0].includes('agent2.ts')) {
          await fs.writeFile(compiledAgent2Path, agent2CjsContentMocked);
        }
        return Promise.resolve();
      });
    });

    it('lists all agents', async () => {
      const agentLoader = new AgentLoader(tempAgentsDir);
      const agents = await agentLoader.listAgents();
      expect(agents).toEqual(['agent1', 'agent2', 'agent3']);
      await agentLoader.disposeAll();
    });

    it('gets agent file', async () => {
      const agentLoader = new AgentLoader(tempAgentsDir);
      const agentFile = await agentLoader.getAgentFile('agent1');
      const agent = await agentFile.load();
      expect(agent.name).toEqual('agent1');
      await agentLoader.disposeAll();
    });

    it('disposes all agent files', async () => {
      const agentLoader = new AgentLoader(tempAgentsDir);
      await agentLoader.listAgents();

      const agent2File = await agentLoader.getAgentFile('agent2');
      await agent2File.load();
      const compiledAgent2Path = path.join(tempAgentsDir, 'agent2.cjs');
      await fs.access(compiledAgent2Path);

      await agentLoader.disposeAll();
      await expect(fs.access(compiledAgent2Path)).rejects.toThrow();
    });

    it('can load agent when agentDir is the filepath', async () => {
      (fileUtils.isFile as Mock).mockReturnValue(true);
      const loader = new AgentLoader(path.join(tempAgentsDir, 'agent1.js'));
      const agents = await loader.listAgents();
      expect(agents).toEqual(['agent1']);
      const agentFile = await loader.getAgentFile('agent1');
      const agent = await agentFile.load();
      expect(agent.name).toBe('agent1');
      await loader.disposeAll();
    });

    it('lists agents with detailed information', async () => {
      // Reset isFile mock in case previous tests set it
      (fileUtils.isFile as Mock).mockReturnValue(false);
      const agentLoader = new AgentLoader(tempAgentsDir);
      const appsInfo = await agentLoader.listAgentsDetailed();

      expect(appsInfo).toHaveLength(3);
      expect(appsInfo.map((a) => a.name)).toEqual([
        'agent1',
        'agent2',
        'agent3',
      ]);

      // Check agent1 (JavaScript file)
      const agent1Info = appsInfo.find((a) => a.name === 'agent1');
      expect(agent1Info).toBeDefined();
      expect(agent1Info!.rootAgentName).toBe('agent1');
      expect(agent1Info!.language).toBe('javascript');
      expect(agent1Info!.isComputerUse).toBe(false);
      expect(agent1Info!.description).toBe('');

      // Check agent2 (TypeScript file - compiled to .cjs)
      const agent2Info = appsInfo.find((a) => a.name === 'agent2');
      expect(agent2Info).toBeDefined();
      expect(agent2Info!.rootAgentName).toBe('agent2');
      // After compilation, getFilePath returns the .cjs file
      expect(agent2Info!.language).toBe('javascript');
      expect(agent2Info!.isComputerUse).toBe(false);

      // Check agent3 (directory-based agent)
      const agent3Info = appsInfo.find((a) => a.name === 'agent3');
      expect(agent3Info).toBeDefined();
      expect(agent3Info!.rootAgentName).toBe('agent3');
      expect(agent3Info!.language).toBe('javascript');
      expect(agent3Info!.isComputerUse).toBe(false);

      await agentLoader.disposeAll();
    });
  });
});