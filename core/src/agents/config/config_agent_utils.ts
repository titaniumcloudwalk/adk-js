/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';

import * as yaml from 'js-yaml';

import {BaseAgent} from '../base_agent.js';
import {logger} from '../../utils/logger.js';

import {
  ADK_AGENT_CLASSES,
  AgentConfigYaml,
  BaseAgentConfigYaml,
  getAgentClassFromConfig,
  LlmAgentConfigYaml,
  validateAgentConfig,
} from './agent_config_schemas.js';
import {
  AgentRefConfig,
  argsToRecord,
  CodeConfig,
  isClass,
  isPlainObject,
  ToolConfig,
} from './common_configs.js';

/**
 * Error thrown when agent configuration loading fails.
 */
export class AgentConfigError extends Error {
  constructor(
      message: string,
      public readonly configPath?: string,
  ) {
    super(configPath ? `${message} (config: ${configPath})` : message);
    this.name = 'AgentConfigError';
  }
}

/**
 * Cache for resolved modules to avoid repeated dynamic imports.
 */
const moduleCache = new Map<string, unknown>();

/**
 * Clears the module cache. Useful for testing.
 */
export function clearModuleCache(): void {
  moduleCache.clear();
}

/**
 * Loads an agent from a YAML configuration file.
 *
 * This is the main entry point for creating agents from YAML configs.
 *
 * @param configPath Path to the YAML configuration file.
 * @returns The constructed agent instance.
 * @throws AgentConfigError if loading or validation fails.
 *
 * @example
 * ```typescript
 * // Load agent from YAML file
 * const agent = await fromConfig('./my_agent.yaml');
 *
 * // Use the agent
 * const runner = new Runner({ appName: 'my_app', agent });
 * ```
 */
export async function fromConfig(configPath: string): Promise<BaseAgent> {
  const absolutePath = path.resolve(configPath);
  const configDir = path.dirname(absolutePath);

  logger.debug(`Loading agent config from: ${absolutePath}`);

  // Load and parse YAML
  const rawConfig = loadConfigFromPath(absolutePath);

  // Validate config
  const config = validateAgentConfig(rawConfig);

  // Resolve agent class
  const agentClass = await resolveAgentClass(config.agentClass || 'LlmAgent');

  // Build agent from config
  return buildAgentFromConfig(agentClass, config, configDir);
}

/**
 * Loads and parses a YAML configuration file.
 *
 * @param configPath Absolute path to the YAML file.
 * @returns The parsed config object.
 * @throws AgentConfigError if the file cannot be read or parsed.
 */
export function loadConfigFromPath(configPath: string): unknown {
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return yaml.load(content);
  } catch (error) {
    if (error instanceof Error) {
      throw new AgentConfigError(
          `Failed to load config: ${error.message}`,
          configPath,
      );
    }
    throw error;
  }
}

/**
 * Resolves an agent class by name.
 *
 * For ADK built-in agents, returns the class from the ADK package.
 * For custom agents, dynamically imports from the specified module.
 *
 * @param agentClassName The agent class name or fully qualified path.
 * @returns The agent class constructor.
 */
export async function resolveAgentClass(
    agentClassName: string,
    ): Promise<new (config: unknown) => BaseAgent> {
  // Check if it's a built-in ADK agent
  if (ADK_AGENT_CLASSES.includes(agentClassName)) {
    return getBuiltInAgentClass(agentClassName);
  }

  // Custom agent class - resolve via dynamic import
  const resolved = await resolveFullyQualifiedName(agentClassName);

  if (!isClass(resolved)) {
    throw new AgentConfigError(
        `Resolved agent class is not a constructor: ${agentClassName}`,
    );
  }

  return resolved as new (config: unknown) => BaseAgent;
}

/**
 * Gets a built-in ADK agent class by name.
 *
 * @param className The class name (e.g., "LlmAgent", "LoopAgent").
 * @returns The agent class constructor.
 */
async function getBuiltInAgentClass(
    className: string,
    ): Promise<new (config: unknown) => BaseAgent> {
  // Dynamic import to avoid circular dependencies
  switch (className) {
    case 'LlmAgent': {
      const {LlmAgent} = await import('../llm_agent.js');
      return LlmAgent as unknown as new (config: unknown) => BaseAgent;
    }
    case 'LoopAgent': {
      const {LoopAgent} = await import('../loop_agent.js');
      return LoopAgent as unknown as new (config: unknown) => BaseAgent;
    }
    case 'ParallelAgent': {
      const {ParallelAgent} = await import('../parallel_agent.js');
      return ParallelAgent as unknown as new (config: unknown) => BaseAgent;
    }
    case 'SequentialAgent': {
      const {SequentialAgent} = await import('../sequential_agent.js');
      return SequentialAgent as unknown as new (config: unknown) => BaseAgent;
    }
    default:
      throw new AgentConfigError(`Unknown built-in agent class: ${className}`);
  }
}

/**
 * Builds an agent from validated config.
 *
 * @param AgentClass The agent class constructor.
 * @param config The validated config.
 * @param configDir The directory containing the config file.
 * @returns The constructed agent.
 */
async function buildAgentFromConfig(
    AgentClass: new (config: unknown) => BaseAgent,
    config: AgentConfigYaml,
    configDir: string,
    ): Promise<BaseAgent> {
  // Parse config to agent constructor kwargs
  const kwargs = await parseConfig(config, configDir);

  // Create and return the agent
  return new AgentClass(kwargs);
}

/**
 * Parses a config into agent constructor kwargs.
 *
 * @param config The validated config.
 * @param configDir The directory containing the config file.
 * @returns The constructor kwargs.
 */
async function parseConfig(
    config: AgentConfigYaml,
    configDir: string,
    ): Promise<Record<string, unknown>> {
  const kwargs: Record<string, unknown> = {
    name: config.name,
    description: config.description,
  };

  // Resolve sub-agents
  if (config.subAgents && config.subAgents.length > 0) {
    kwargs.subAgents = await resolveAgentReferences(
        config.subAgents,
        configDir,
    );
  }

  // Resolve before/after agent callbacks
  if (config.beforeAgentCallbacks && config.beforeAgentCallbacks.length > 0) {
    kwargs.beforeAgentCallback = await resolveCallbacks(
        config.beforeAgentCallbacks,
    );
  }
  if (config.afterAgentCallbacks && config.afterAgentCallbacks.length > 0) {
    kwargs.afterAgentCallback = await resolveCallbacks(
        config.afterAgentCallbacks,
    );
  }

  // Handle LlmAgent-specific fields
  const agentClass = getAgentClassFromConfig(config);
  if (agentClass === 'LlmAgent') {
    return parseLlmAgentConfig(config as LlmAgentConfigYaml, configDir, kwargs);
  }

  return kwargs;
}

/**
 * Parses LlmAgent-specific config fields.
 *
 * @param config The LlmAgent config.
 * @param configDir The directory containing the config file.
 * @param kwargs The base kwargs to extend.
 * @returns The complete constructor kwargs.
 */
async function parseLlmAgentConfig(
    config: LlmAgentConfigYaml,
    configDir: string,
    kwargs: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
  // Resolve model
  if (config.model) {
    kwargs.model = config.model;
  } else if (config.modelCode) {
    kwargs.model = await resolveCodeReference(config.modelCode);
  }

  // Set instruction
  if (config.instruction) {
    kwargs.instruction = config.instruction;
  }

  // Set static instruction
  if (config.staticInstruction) {
    kwargs.staticInstruction = config.staticInstruction;
  }

  // Set global instruction
  if (config.globalInstruction) {
    kwargs.globalInstruction = config.globalInstruction;
  }

  // Resolve tools
  if (config.tools && config.tools.length > 0) {
    kwargs.tools = await resolveTools(config.tools, configDir);
  }

  // Resolve input/output schemas
  if (config.inputSchema) {
    kwargs.inputSchema = await resolveCodeReference(config.inputSchema);
  }
  if (config.outputSchema) {
    kwargs.outputSchema = await resolveCodeReference(config.outputSchema);
  }

  // Resolve callbacks
  if (config.beforeModelCallbacks && config.beforeModelCallbacks.length > 0) {
    kwargs.beforeModelCallback = await resolveCallbacks(
        config.beforeModelCallbacks,
    );
  }
  if (config.afterModelCallbacks && config.afterModelCallbacks.length > 0) {
    kwargs.afterModelCallback = await resolveCallbacks(
        config.afterModelCallbacks,
    );
  }
  if (config.beforeToolCallbacks && config.beforeToolCallbacks.length > 0) {
    kwargs.beforeToolCallback = await resolveCallbacks(
        config.beforeToolCallbacks,
    );
  }
  if (config.afterToolCallbacks && config.afterToolCallbacks.length > 0) {
    kwargs.afterToolCallback = await resolveCallbacks(
        config.afterToolCallbacks,
    );
  }

  // Set simple fields
  if (config.disallowTransferToParent !== undefined) {
    kwargs.disallowTransferToParent = config.disallowTransferToParent;
  }
  if (config.disallowTransferToPeers !== undefined) {
    kwargs.disallowTransferToPeers = config.disallowTransferToPeers;
  }
  if (config.includeContents !== undefined) {
    kwargs.includeContents = config.includeContents;
  }
  if (config.outputKey !== undefined) {
    kwargs.outputKey = config.outputKey;
  }
  if (config.generateContentConfig !== undefined) {
    kwargs.generateContentConfig = config.generateContentConfig;
  }

  return kwargs;
}

/**
 * Resolves a fully qualified name to a module export.
 *
 * Supports both built-in tools (simple names like "google_search")
 * and user-defined exports (paths like "my_package.my_module.my_export").
 *
 * @param name The fully qualified name.
 * @returns The resolved export.
 *
 * @example
 * ```typescript
 * // Built-in tool
 * const tool = await resolveFullyQualifiedName('google_search');
 *
 * // User-defined function
 * const fn = await resolveFullyQualifiedName('my_lib.callbacks.validate');
 * ```
 */
export async function resolveFullyQualifiedName(name: string): Promise<unknown> {
  // Check cache first
  if (moduleCache.has(name)) {
    return moduleCache.get(name);
  }

  let resolved: unknown;

  if (!name.includes('.')) {
    // Simple name - try to resolve from ADK tools
    resolved = await resolveBuiltInTool(name);
  } else {
    // Fully qualified path - dynamic import
    resolved = await resolveDynamicImport(name);
  }

  // Cache the result
  moduleCache.set(name, resolved);
  return resolved;
}

/**
 * Resolves a built-in ADK tool by name.
 *
 * @param name The tool name (e.g., "google_search").
 * @returns The tool class or instance.
 */
async function resolveBuiltInTool(name: string): Promise<unknown> {
  // Map of simple tool names to their exports
  const toolMappings: Record<string, () => Promise<unknown>> = {
    google_search: async () => {
      const {GoogleSearchTool} = await import('../../tools/google_search_tool.js');
      return GoogleSearchTool;
    },
    code_execution: async () => {
      const {BuiltInCodeExecutor} = await import('../../code_executors/built_in_code_executor.js');
      return BuiltInCodeExecutor;
    },
    load_memory_tool: async () => {
      const {loadMemoryTool} = await import('../../tools/load_memory_tool.js');
      return loadMemoryTool;
    },
    preload_memory_tool: async () => {
      const {preloadMemoryTool} = await import('../../tools/preload_memory_tool.js');
      return preloadMemoryTool;
    },
  };

  const loader = toolMappings[name];
  if (loader) {
    return loader();
  }

  throw new AgentConfigError(`Unknown built-in tool: ${name}`);
}

/**
 * Resolves a fully qualified module path via dynamic import.
 *
 * @param fqn The fully qualified name (e.g., "my_package.my_module.export").
 * @returns The resolved export.
 */
async function resolveDynamicImport(fqn: string): Promise<unknown> {
  // Split into module path and export path
  const parts = fqn.split('.');

  // Try different module path lengths
  // e.g., for "a.b.c.d", try importing "a.b.c", then "a.b", then "a"
  for (let i = parts.length - 1; i >= 1; i--) {
    const modulePath = parts.slice(0, i).join('/');
    const exportPath = parts.slice(i);

    try {
      // Try to import the module
      const module = await import(modulePath);

      // Navigate to the export
      let obj = module;
      for (const part of exportPath) {
        if (obj === undefined || obj === null) {
          break;
        }
        obj = obj[part];
      }

      if (obj !== undefined) {
        return obj;
      }
    } catch {
      // Module not found at this path, try shorter
      continue;
    }
  }

  throw new AgentConfigError(
      `Could not resolve: ${fqn}. ` +
      'Make sure the module is installed and the path is correct.',
  );
}

/**
 * Resolves a code reference (CodeConfig) to its actual value.
 *
 * If the reference is a class, instantiates it with the provided args.
 * If the reference is a function, calls it with the provided args.
 * If the reference is an instance, returns it directly.
 *
 * @param codeConfig The code reference configuration.
 * @returns The resolved value.
 */
export async function resolveCodeReference(
    codeConfig: CodeConfig,
    ): Promise<unknown> {
  const resolved = await resolveFullyQualifiedName(codeConfig.name);
  const args = argsToRecord(codeConfig.args);

  // If no args, return as-is
  if (!args) {
    // If it's a class with no args, instantiate it
    if (isClass(resolved)) {
      return new resolved();
    }
    return resolved;
  }

  // If it's a class, instantiate with args
  if (isClass(resolved)) {
    return new resolved(args);
  }

  // If it's a function, call with args
  if (typeof resolved === 'function') {
    return resolved(args);
  }

  // Otherwise, return as-is
  return resolved;
}

/**
 * Resolves multiple callback references.
 *
 * @param callbacks Array of callback code configs.
 * @returns Array of resolved callback functions.
 */
export async function resolveCallbacks(
    callbacks: CodeConfig[],
    ): Promise<unknown[]> {
  const resolved: unknown[] = [];

  for (const callback of callbacks) {
    const fn = await resolveCodeReference(callback);
    if (typeof fn !== 'function') {
      throw new AgentConfigError(
          `Callback ${callback.name} is not a function`,
      );
    }
    resolved.push(fn);
  }

  return resolved;
}

/**
 * Resolves an agent reference to an agent instance.
 *
 * @param refConfig The agent reference config.
 * @param configDir The directory containing the parent config file.
 * @returns The resolved agent instance.
 */
export async function resolveAgentReference(
    refConfig: AgentRefConfig,
    configDir: string,
    ): Promise<BaseAgent> {
  if (refConfig.configPath) {
    // Load from config file
    const absolutePath = path.isAbsolute(refConfig.configPath) ?
        refConfig.configPath :
        path.resolve(configDir, refConfig.configPath);
    return fromConfig(absolutePath);
  }

  if (refConfig.code) {
    // Load from code reference
    const resolved = await resolveFullyQualifiedName(refConfig.code);
    if (!(resolved instanceof BaseAgent)) {
      throw new AgentConfigError(
          `Agent reference ${refConfig.code} is not a BaseAgent instance`,
      );
    }
    return resolved;
  }

  throw new AgentConfigError(
      'AgentRefConfig must have either configPath or code',
  );
}

/**
 * Resolves multiple agent references.
 *
 * @param refs Array of agent reference configs.
 * @param configDir The directory containing the parent config file.
 * @returns Array of resolved agent instances.
 */
export async function resolveAgentReferences(
    refs: AgentRefConfig[],
    configDir: string,
    ): Promise<BaseAgent[]> {
  const resolved: BaseAgent[] = [];

  for (const ref of refs) {
    const agent = await resolveAgentReference(ref, configDir);
    resolved.push(agent);
  }

  return resolved;
}

/**
 * Resolves tool configurations to tool instances.
 *
 * Supports 5 types of tools:
 * 1. Built-in tool instances (e.g., "google_search")
 * 2. User-defined tool instances (fully qualified path)
 * 3. User-defined tool classes with args
 * 4. Factory functions that return tools
 * 5. Regular functions to be wrapped as FunctionTools
 *
 * @param toolConfigs Array of tool configurations.
 * @param configDir The directory containing the config file.
 * @returns Array of resolved tool instances.
 */
export async function resolveTools(
    toolConfigs: ToolConfig[],
    configDir: string,
    ): Promise<unknown[]> {
  const resolved: unknown[] = [];

  for (const toolConfig of toolConfigs) {
    const tool = await resolveTool(toolConfig, configDir);
    resolved.push(tool);
  }

  return resolved;
}

/**
 * Resolves a single tool configuration.
 *
 * @param toolConfig The tool configuration.
 * @param configDir The directory containing the config file.
 * @returns The resolved tool instance.
 */
async function resolveTool(
    toolConfig: ToolConfig,
    configDir: string,
    ): Promise<unknown> {
  const resolved = await resolveFullyQualifiedName(toolConfig.name);

  // Import tool base classes for instanceof checks
  const {BaseTool} = await import('../../tools/base_tool.js');
  const {BaseToolset} = await import('../../tools/base_toolset.js');

  // Check if it's already a tool instance
  if (resolved instanceof BaseTool || resolved instanceof BaseToolset) {
    if (toolConfig.args) {
      logger.warn(
          `Tool ${toolConfig.name} is already an instance, ignoring args`,
      );
    }
    return resolved;
  }

  // Check if it's a tool class
  if (isClass(resolved)) {
    // Check if it has a fromConfig method
    const ResolvedClass = resolved as unknown as {
      fromConfig?: (args: unknown, path: string) => unknown;
    };

    if (typeof ResolvedClass.fromConfig === 'function') {
      return ResolvedClass.fromConfig(toolConfig.args || {}, configDir);
    }

    // Otherwise, instantiate with args
    return new resolved(toolConfig.args || {});
  }

  // Check if it's a function
  if (typeof resolved === 'function') {
    if (toolConfig.args) {
      // Call with args (factory function pattern)
      return resolved(toolConfig.args);
    }

    // Check if the result is a tool-like object
    // It could be a function tool or a tool-generating function
    const {FunctionTool} = await import('../../tools/function_tool.js');

    // Wrap as FunctionTool
    return new FunctionTool({
      name: toolConfig.name.split('.').pop() || toolConfig.name,
      description: `Function tool: ${toolConfig.name}`,
      execute: resolved as (args: unknown) => unknown,
    });
  }

  throw new AgentConfigError(
      `Could not resolve tool: ${toolConfig.name}. ` +
      'Expected a BaseTool, BaseToolset, class, or function.',
  );
}
