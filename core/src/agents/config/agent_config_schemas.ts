/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {z} from 'zod';

import {AgentRefConfigSchema, CodeConfigSchema, ToolConfigSchema} from './common_configs.js';

/**
 * Base agent configuration schema for YAML-based configs.
 *
 * This schema represents the common fields shared by all agent types.
 */
export const BaseAgentConfigYamlSchema = z.object({
  /**
   * The type of agent class to instantiate.
   * Defaults to "LlmAgent" if not specified.
   */
  agentClass: z.string().optional().default('LlmAgent'),

  /**
   * The unique name of the agent.
   * Must be a valid identifier and unique within the agent tree.
   * Cannot be "user" (reserved).
   */
  name: z.string(),

  /**
   * Description of the agent's capabilities.
   * Used by the model to determine when to delegate to this agent.
   */
  description: z.string().optional(),

  /**
   * Sub-agents that this agent can delegate to.
   */
  subAgents: z.array(AgentRefConfigSchema).optional(),

  /**
   * Callbacks to run before the agent executes.
   */
  beforeAgentCallbacks: z.array(CodeConfigSchema).optional(),

  /**
   * Callbacks to run after the agent executes.
   */
  afterAgentCallbacks: z.array(CodeConfigSchema).optional(),
});

/**
 * Base agent YAML configuration type.
 */
export type BaseAgentConfigYaml = z.infer<typeof BaseAgentConfigYamlSchema>;

/**
 * LlmAgent-specific configuration schema for YAML-based configs.
 *
 * Extends BaseAgentConfigYaml with LLM-specific fields.
 */
export const LlmAgentConfigYamlSchema = BaseAgentConfigYamlSchema.extend({
  /**
   * The model to use (e.g., "gemini-2.5-flash").
   * Mutually exclusive with modelCode.
   */
  model: z.string().optional(),

  /**
   * Code reference for custom model instantiation.
   * Use when you need a custom model implementation.
   * Mutually exclusive with model.
   */
  modelCode: CodeConfigSchema.optional(),

  /**
   * Instructions for the LLM model.
   * Can include placeholders for state injection (e.g., {user_name}).
   */
  instruction: z.string().optional(),

  /**
   * Static instruction content for context caching optimization.
   * Sent literally without any processing.
   */
  staticInstruction: z.unknown().optional(),

  /**
   * Global instructions for all agents in the tree.
   * Only effective when set on the root agent.
   */
  globalInstruction: z.string().optional(),

  /**
   * Disallow LLM-controlled transfer to parent agent.
   */
  disallowTransferToParent: z.boolean().optional(),

  /**
   * Disallow LLM-controlled transfer to peer agents.
   */
  disallowTransferToPeers: z.boolean().optional(),

  /**
   * Controls content inclusion in model requests.
   * - 'default': Include relevant conversation history
   * - 'none': No prior history, only current instruction and input
   */
  includeContents: z.enum(['default', 'none']).optional(),

  /**
   * Tools available to this agent.
   */
  tools: z.array(ToolConfigSchema).optional(),

  /**
   * Callbacks to run before calling the LLM.
   */
  beforeModelCallbacks: z.array(CodeConfigSchema).optional(),

  /**
   * Callbacks to run after calling the LLM.
   */
  afterModelCallbacks: z.array(CodeConfigSchema).optional(),

  /**
   * Callbacks to run before calling a tool.
   */
  beforeToolCallbacks: z.array(CodeConfigSchema).optional(),

  /**
   * Callbacks to run after calling a tool.
   */
  afterToolCallbacks: z.array(CodeConfigSchema).optional(),

  /**
   * Input schema when agent is used as a tool.
   * Code reference to a Schema object.
   */
  inputSchema: CodeConfigSchema.optional(),

  /**
   * Output schema for agent replies.
   * Code reference to a Schema object.
   * Note: When set, agent can ONLY reply (no tools, RAGs, transfers).
   */
  outputSchema: CodeConfigSchema.optional(),

  /**
   * Key in session state to store agent output.
   */
  outputKey: z.string().optional(),

  /**
   * Additional content generation configuration.
   * Supports temperature, safety settings, etc.
   */
  generateContentConfig: z.record(z.unknown()).optional(),
}).refine(
    (data) => !(data.model && data.modelCode),
    {
      message: 'Only one of model or modelCode should be set',
      path: ['model'],
    },
);

/**
 * LlmAgent YAML configuration type.
 */
export type LlmAgentConfigYaml = z.infer<typeof LlmAgentConfigYamlSchema>;

/**
 * LoopAgent-specific configuration schema.
 */
export const LoopAgentConfigYamlSchema = BaseAgentConfigYamlSchema.extend({
  /**
   * Maximum number of iterations for the loop.
   */
  maxIterations: z.number().int().positive().optional(),
});

/**
 * LoopAgent YAML configuration type.
 */
export type LoopAgentConfigYaml = z.infer<typeof LoopAgentConfigYamlSchema>;

/**
 * ParallelAgent-specific configuration schema.
 */
export const ParallelAgentConfigYamlSchema = BaseAgentConfigYamlSchema.extend({
  // ParallelAgent-specific fields can be added here
});

/**
 * ParallelAgent YAML configuration type.
 */
export type ParallelAgentConfigYaml = z.infer<typeof ParallelAgentConfigYamlSchema>;

/**
 * SequentialAgent-specific configuration schema.
 */
export const SequentialAgentConfigYamlSchema = BaseAgentConfigYamlSchema.extend({
  // SequentialAgent-specific fields can be added here
});

/**
 * SequentialAgent YAML configuration type.
 */
export type SequentialAgentConfigYaml = z.infer<typeof SequentialAgentConfigYamlSchema>;

/**
 * Map of agent class names to their schema validators.
 */
export const AGENT_CONFIG_SCHEMAS: Record<string, z.ZodType> = {
  LlmAgent: LlmAgentConfigYamlSchema,
  LoopAgent: LoopAgentConfigYamlSchema,
  ParallelAgent: ParallelAgentConfigYamlSchema,
  SequentialAgent: SequentialAgentConfigYamlSchema,
  BaseAgent: BaseAgentConfigYamlSchema,
};

/**
 * List of known ADK agent classes.
 */
export const ADK_AGENT_CLASSES = [
  'LlmAgent',
  'LoopAgent',
  'ParallelAgent',
  'SequentialAgent',
];

/**
 * Determines the agent class from a config object.
 *
 * @param config The raw config object from YAML.
 * @returns The agent class name.
 */
export function getAgentClassFromConfig(config: unknown): string {
  if (typeof config !== 'object' || config === null) {
    return 'LlmAgent';
  }

  const agentClass = (config as Record<string, unknown>).agentClass;
  if (typeof agentClass === 'string') {
    return ADK_AGENT_CLASSES.includes(agentClass) ? agentClass : 'BaseAgent';
  }

  return 'LlmAgent';
}

/**
 * Validates a config object against the appropriate schema.
 *
 * @param config The raw config object from YAML.
 * @returns The validated config object.
 * @throws ZodError if validation fails.
 */
export function validateAgentConfig(config: unknown): BaseAgentConfigYaml {
  const agentClass = getAgentClassFromConfig(config);
  const schema = AGENT_CONFIG_SCHEMAS[agentClass] || BaseAgentConfigYamlSchema;
  return schema.parse(config);
}

/**
 * Union type for all agent config types.
 */
export type AgentConfigYaml =
    |LlmAgentConfigYaml
    |LoopAgentConfigYaml
    |ParallelAgentConfigYaml
    |SequentialAgentConfigYaml
    |BaseAgentConfigYaml;
