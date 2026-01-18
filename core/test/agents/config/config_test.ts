/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {
  AgentConfigError,
  AgentRefConfigSchema,
  argsToRecord,
  ArgumentConfigSchema,
  clearModuleCache,
  CodeConfigSchema,
  fromConfig,
  getAgentClassFromConfig,
  isClass,
  isPlainObject,
  loadConfigFromPath,
  LlmAgentConfigYamlSchema,
  resolveAgentClass,
  resolveCodeReference,
  resolveFullyQualifiedName,
  ToolConfigSchema,
  validateAgentConfig,
} from '../../../src/agents/config/index.js';
import {LlmAgent} from '../../../src/agents/llm_agent.js';
import {LoopAgent} from '../../../src/agents/loop_agent.js';
import {ParallelAgent} from '../../../src/agents/parallel_agent.js';
import {SequentialAgent} from '../../../src/agents/sequential_agent.js';

// Test fixtures directory
const FIXTURES_DIR = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    'fixtures',
);

describe('ArgumentConfigSchema', () => {
  it('should validate named arguments', () => {
    const result = ArgumentConfigSchema.parse({
      name: 'api_key',
      value: 'secret123',
    });
    expect(result.name).toBe('api_key');
    expect(result.value).toBe('secret123');
  });

  it('should validate positional arguments (no name)', () => {
    const result = ArgumentConfigSchema.parse({
      value: 42,
    });
    expect(result.name).toBeUndefined();
    expect(result.value).toBe(42);
  });

  it('should allow any value type', () => {
    expect(ArgumentConfigSchema.parse({value: 'string'}).value).toBe('string');
    expect(ArgumentConfigSchema.parse({value: 123}).value).toBe(123);
    expect(ArgumentConfigSchema.parse({value: true}).value).toBe(true);
    expect(ArgumentConfigSchema.parse({value: null}).value).toBe(null);
    expect(ArgumentConfigSchema.parse({value: [1, 2, 3]}).value).toEqual([
      1, 2, 3,
    ]);
  });
});

describe('CodeConfigSchema', () => {
  it('should validate code reference without args', () => {
    const result = CodeConfigSchema.parse({
      name: 'my_package.my_module.my_function',
    });
    expect(result.name).toBe('my_package.my_module.my_function');
    expect(result.args).toBeUndefined();
  });

  it('should validate code reference with args', () => {
    const result = CodeConfigSchema.parse({
      name: 'my_package.models.create_model',
      args: [
        {name: 'api_base', value: 'https://api.example.com'},
        {name: 'temperature', value: 0.7},
      ],
    });
    expect(result.name).toBe('my_package.models.create_model');
    expect(result.args).toHaveLength(2);
    expect(result.args?.[0].name).toBe('api_base');
  });

  it('should allow empty name (Zod does not validate string content)', () => {
    // Note: Zod accepts empty strings by default. Additional validation
    // can be added via .min(1) if needed.
    const result = CodeConfigSchema.parse({name: ''});
    expect(result.name).toBe('');
  });
});

describe('AgentRefConfigSchema', () => {
  it('should validate config path reference', () => {
    const result = AgentRefConfigSchema.parse({
      configPath: './sub_agent.yaml',
    });
    expect(result.configPath).toBe('./sub_agent.yaml');
    expect(result.code).toBeUndefined();
  });

  it('should validate code reference', () => {
    const result = AgentRefConfigSchema.parse({
      code: 'my_package.agents.my_agent',
    });
    expect(result.code).toBe('my_package.agents.my_agent');
    expect(result.configPath).toBeUndefined();
  });

  it('should reject when both configPath and code are set', () => {
    expect(() =>
      AgentRefConfigSchema.parse({
        configPath: './agent.yaml',
        code: 'my_package.agent',
      }),
    ).toThrow('Exactly one of configPath or code must be specified');
  });

  it('should reject when neither configPath nor code is set', () => {
    expect(() => AgentRefConfigSchema.parse({})).toThrow(
        'Exactly one of configPath or code must be specified',
    );
  });
});

describe('ToolConfigSchema', () => {
  it('should validate simple tool name', () => {
    const result = ToolConfigSchema.parse({
      name: 'google_search',
    });
    expect(result.name).toBe('google_search');
    expect(result.args).toBeUndefined();
  });

  it('should validate tool with args', () => {
    const result = ToolConfigSchema.parse({
      name: 'my_package.tools.CustomTool',
      args: {api_key: 'secret', timeout: 30},
    });
    expect(result.name).toBe('my_package.tools.CustomTool');
    expect(result.args).toEqual({api_key: 'secret', timeout: 30});
  });
});

describe('LlmAgentConfigYamlSchema', () => {
  it('should validate minimal LlmAgent config', () => {
    const result = LlmAgentConfigYamlSchema.parse({
      name: 'my_agent',
      instruction: 'You are a helpful assistant.',
    });
    expect(result.name).toBe('my_agent');
    expect(result.instruction).toBe('You are a helpful assistant.');
    expect(result.agentClass).toBe('LlmAgent');
  });

  it('should validate full LlmAgent config', () => {
    const result = LlmAgentConfigYamlSchema.parse({
      agentClass: 'LlmAgent',
      name: 'advanced_agent',
      description: 'An advanced agent',
      model: 'gemini-2.5-flash',
      instruction: 'Be helpful.',
      disallowTransferToParent: true,
      disallowTransferToPeers: false,
      includeContents: 'default',
      outputKey: 'agent_output',
      tools: [{name: 'google_search'}],
    });
    expect(result.name).toBe('advanced_agent');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(result.disallowTransferToParent).toBe(true);
    expect(result.tools).toHaveLength(1);
  });

  it('should reject when both model and modelCode are set', () => {
    expect(() =>
      LlmAgentConfigYamlSchema.parse({
        name: 'agent',
        model: 'gemini-2.5-flash',
        modelCode: {name: 'my_package.custom_model'},
      }),
    ).toThrow('Only one of model or modelCode should be set');
  });
});

describe('argsToRecord', () => {
  it('should convert named arguments to record', () => {
    const result = argsToRecord([
      {name: 'a', value: 1},
      {name: 'b', value: 'two'},
    ]);
    expect(result).toEqual({a: 1, b: 'two'});
  });

  it('should convert positional arguments with index keys', () => {
    const result = argsToRecord([{value: 'first'}, {value: 'second'}]);
    expect(result).toEqual({'0': 'first', '1': 'second'});
  });

  it('should handle mixed named and positional', () => {
    const result = argsToRecord([
      {value: 'pos0'},
      {name: 'named', value: 'val'},
      {value: 'pos1'},
    ]);
    expect(result).toEqual({'0': 'pos0', named: 'val', '1': 'pos1'});
  });

  it('should return undefined for empty array', () => {
    expect(argsToRecord([])).toBeUndefined();
  });

  it('should return undefined for undefined input', () => {
    expect(argsToRecord(undefined)).toBeUndefined();
  });
});

describe('isPlainObject', () => {
  it('should return true for plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({a: 1})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it('should return false for non-plain objects', () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isPlainObject('string')).toBe(false);
    expect(isPlainObject(42)).toBe(false);
  });
});

describe('isClass', () => {
  it('should return true for ES6 classes', () => {
    class MyClass {}
    expect(isClass(MyClass)).toBe(true);
  });

  it('should return false for regular functions', () => {
    function myFunction() {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const arrowFn = () => {};
    expect(isClass(myFunction)).toBe(false);
    expect(isClass(arrowFn)).toBe(false);
  });

  it('should return false for non-functions', () => {
    expect(isClass(null)).toBe(false);
    expect(isClass(undefined)).toBe(false);
    expect(isClass({})).toBe(false);
    expect(isClass('string')).toBe(false);
  });
});

describe('getAgentClassFromConfig', () => {
  it('should return LlmAgent as default', () => {
    expect(getAgentClassFromConfig({})).toBe('LlmAgent');
    expect(getAgentClassFromConfig({name: 'agent'})).toBe('LlmAgent');
  });

  it('should return specified agent class', () => {
    expect(getAgentClassFromConfig({agentClass: 'LoopAgent'})).toBe(
        'LoopAgent',
    );
    expect(getAgentClassFromConfig({agentClass: 'ParallelAgent'})).toBe(
        'ParallelAgent',
    );
    expect(getAgentClassFromConfig({agentClass: 'SequentialAgent'})).toBe(
        'SequentialAgent',
    );
  });

  it('should return BaseAgent for unknown classes', () => {
    expect(getAgentClassFromConfig({agentClass: 'CustomAgent'})).toBe(
        'BaseAgent',
    );
  });

  it('should handle non-object input', () => {
    expect(getAgentClassFromConfig(null)).toBe('LlmAgent');
    expect(getAgentClassFromConfig('string')).toBe('LlmAgent');
  });
});

describe('validateAgentConfig', () => {
  it('should validate LlmAgent config', () => {
    const config = validateAgentConfig({
      name: 'test_agent',
      model: 'gemini-2.5-flash',
      instruction: 'Be helpful',
    });
    expect(config.name).toBe('test_agent');
    expect(config.agentClass).toBe('LlmAgent');
  });

  it('should throw on invalid config', () => {
    expect(() => validateAgentConfig({agentClass: 'LlmAgent'})).toThrow();
  });
});

describe('resolveAgentClass', () => {
  it('should resolve LlmAgent class', async () => {
    const AgentClass = await resolveAgentClass('LlmAgent');
    expect(AgentClass).toBe(LlmAgent);
  });

  it('should resolve LoopAgent class', async () => {
    const AgentClass = await resolveAgentClass('LoopAgent');
    expect(AgentClass).toBe(LoopAgent);
  });

  it('should resolve ParallelAgent class', async () => {
    const AgentClass = await resolveAgentClass('ParallelAgent');
    expect(AgentClass).toBe(ParallelAgent);
  });

  it('should resolve SequentialAgent class', async () => {
    const AgentClass = await resolveAgentClass('SequentialAgent');
    expect(AgentClass).toBe(SequentialAgent);
  });
});

describe('resolveFullyQualifiedName', () => {
  beforeEach(() => {
    clearModuleCache();
  });

  it('should resolve built-in google_search tool', async () => {
    const tool = await resolveFullyQualifiedName('google_search');
    expect(tool).toBeDefined();
  });

  it('should throw for unknown built-in tool', async () => {
    await expect(
        resolveFullyQualifiedName('unknown_tool'),
    ).rejects.toThrow('Unknown built-in tool');
  });
});

describe('resolveCodeReference', () => {
  beforeEach(() => {
    clearModuleCache();
  });

  it('should resolve and return built-in tool class', async () => {
    const tool = await resolveCodeReference({name: 'google_search'});
    expect(tool).toBeDefined();
  });
});

describe('loadConfigFromPath', () => {
  const tempDir = path.join(FIXTURES_DIR);

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, {recursive: true});
    }
  });

  afterEach(() => {
    // Clean up test files
    const testFile = path.join(tempDir, 'test_config.yaml');
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it('should load and parse YAML file', () => {
    const yamlContent = `
name: test_agent
model: gemini-2.5-flash
instruction: Be helpful
`;
    const testFile = path.join(tempDir, 'test_config.yaml');
    fs.writeFileSync(testFile, yamlContent);

    const config = loadConfigFromPath(testFile);
    expect(config).toEqual({
      name: 'test_agent',
      model: 'gemini-2.5-flash',
      instruction: 'Be helpful',
    });
  });

  it('should throw for non-existent file', () => {
    expect(() => loadConfigFromPath('/nonexistent/file.yaml')).toThrow(
        AgentConfigError,
    );
  });
});

describe('fromConfig', () => {
  const tempDir = path.join(FIXTURES_DIR);

  beforeEach(() => {
    clearModuleCache();
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, {recursive: true});
    }
  });

  afterEach(() => {
    // Clean up test files
    const files = ['simple_agent.yaml', 'loop_agent.yaml'];
    for (const file of files) {
      const testFile = path.join(tempDir, file);
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  it('should load LlmAgent from YAML file', async () => {
    const yamlContent = `
name: my_assistant
model: gemini-2.5-flash
instruction: You are a helpful assistant.
description: A simple assistant agent
`;
    const testFile = path.join(tempDir, 'simple_agent.yaml');
    fs.writeFileSync(testFile, yamlContent);

    const agent = await fromConfig(testFile);
    expect(agent).toBeInstanceOf(LlmAgent);
    expect(agent.name).toBe('my_assistant');
    expect(agent.description).toBe('A simple assistant agent');
  });

  it('should load LoopAgent from YAML file', async () => {
    const yamlContent = `
agentClass: LoopAgent
name: loop_agent
description: A loop agent
`;
    const testFile = path.join(tempDir, 'loop_agent.yaml');
    fs.writeFileSync(testFile, yamlContent);

    const agent = await fromConfig(testFile);
    expect(agent).toBeInstanceOf(LoopAgent);
    expect(agent.name).toBe('loop_agent');
  });

  it('should handle tools configuration', async () => {
    const yamlContent = `
name: agent_with_tools
model: gemini-2.5-flash
instruction: Use tools wisely.
tools:
  - name: google_search
`;
    const testFile = path.join(tempDir, 'simple_agent.yaml');
    fs.writeFileSync(testFile, yamlContent);

    const agent = (await fromConfig(testFile)) as LlmAgent;
    expect(agent).toBeInstanceOf(LlmAgent);
    expect(agent.name).toBe('agent_with_tools');
    // Tools are resolved
    expect(agent.tools).toBeDefined();
  });

  it('should throw for invalid YAML', async () => {
    const yamlContent = `
name: test
invalid yaml: [
`;
    const testFile = path.join(tempDir, 'simple_agent.yaml');
    fs.writeFileSync(testFile, yamlContent);

    await expect(fromConfig(testFile)).rejects.toThrow(AgentConfigError);
  });

  it('should throw for missing required fields', async () => {
    const yamlContent = `
model: gemini-2.5-flash
`;
    const testFile = path.join(tempDir, 'simple_agent.yaml');
    fs.writeFileSync(testFile, yamlContent);

    // Missing 'name' field
    await expect(fromConfig(testFile)).rejects.toThrow();
  });
});

describe('LlmAgent config fields', () => {
  const tempDir = path.join(FIXTURES_DIR);

  beforeEach(() => {
    clearModuleCache();
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, {recursive: true});
    }
  });

  afterEach(() => {
    const testFile = path.join(tempDir, 'test_agent.yaml');
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  });

  it('should handle disallowTransferToParent', async () => {
    const yamlContent = `
name: restricted_agent
model: gemini-2.5-flash
instruction: Stay focused.
disallowTransferToParent: true
`;
    const testFile = path.join(tempDir, 'test_agent.yaml');
    fs.writeFileSync(testFile, yamlContent);

    const agent = (await fromConfig(testFile)) as LlmAgent;
    expect(agent.disallowTransferToParent).toBe(true);
  });

  it('should handle disallowTransferToPeers', async () => {
    const yamlContent = `
name: isolated_agent
model: gemini-2.5-flash
instruction: Work alone.
disallowTransferToPeers: true
`;
    const testFile = path.join(tempDir, 'test_agent.yaml');
    fs.writeFileSync(testFile, yamlContent);

    const agent = (await fromConfig(testFile)) as LlmAgent;
    expect(agent.disallowTransferToPeers).toBe(true);
  });

  it('should handle includeContents', async () => {
    const yamlContent = `
name: fresh_agent
model: gemini-2.5-flash
instruction: No history.
includeContents: none
`;
    const testFile = path.join(tempDir, 'test_agent.yaml');
    fs.writeFileSync(testFile, yamlContent);

    const agent = (await fromConfig(testFile)) as LlmAgent;
    expect(agent.includeContents).toBe('none');
  });

  it('should handle outputKey', async () => {
    const yamlContent = `
name: output_agent
model: gemini-2.5-flash
instruction: Store output.
outputKey: my_output
`;
    const testFile = path.join(tempDir, 'test_agent.yaml');
    fs.writeFileSync(testFile, yamlContent);

    const agent = (await fromConfig(testFile)) as LlmAgent;
    expect(agent.outputKey).toBe('my_output');
  });

  it('should handle generateContentConfig', async () => {
    const yamlContent = `
name: config_agent
model: gemini-2.5-flash
instruction: Be creative.
generateContentConfig:
  temperature: 0.9
  maxOutputTokens: 1000
`;
    const testFile = path.join(tempDir, 'test_agent.yaml');
    fs.writeFileSync(testFile, yamlContent);

    const agent = (await fromConfig(testFile)) as LlmAgent;
    expect(agent.generateContentConfig?.temperature).toBe(0.9);
    expect(agent.generateContentConfig?.maxOutputTokens).toBe(1000);
  });
});
