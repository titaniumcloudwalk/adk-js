/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Builder class for creating A2A agent cards from ADK agents.
 *
 * This class provides functionality to convert ADK agents into A2A agent cards,
 * including extracting skills, capabilities, and metadata from various agent types.
 */

import {BaseAgent} from '../../agents/base_agent.js';
import {LlmAgent} from '../../agents/llm_agent.js';
import {LoopAgent} from '../../agents/loop_agent.js';
import {ParallelAgent} from '../../agents/parallel_agent.js';
import {SequentialAgent} from '../../agents/sequential_agent.js';
import {a2aExperimental, logA2aExperimentalWarning} from '../experimental.js';

// Type guards for agent types
function isLlmAgent(agent: BaseAgent): agent is LlmAgent {
  return agent instanceof LlmAgent;
}

function isLoopAgent(agent: BaseAgent): agent is LoopAgent {
  return agent instanceof LoopAgent;
}

function isParallelAgent(agent: BaseAgent): agent is ParallelAgent {
  return agent instanceof ParallelAgent;
}

function isSequentialAgent(agent: BaseAgent): agent is SequentialAgent {
  return agent instanceof SequentialAgent;
}

/**
 * A2A Agent Capabilities interface.
 */
export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
}

/**
 * A2A Agent Provider interface.
 */
export interface AgentProvider {
  organization?: string;
  url?: string;
}

/**
 * A2A Security Scheme interface.
 */
export interface SecurityScheme {
  type: string;
  description?: string;
  name?: string;
  in?: string;
  scheme?: string;
  bearerFormat?: string;
  flows?: Record<string, unknown>;
  openIdConnectUrl?: string;
}

/**
 * A2A Agent Skill interface.
 */
export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
  tags?: string[];
}

/**
 * A2A Agent Card interface.
 */
export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities?: AgentCapabilities;
  skills?: AgentSkill[];
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  supportsAuthenticatedExtendedCard?: boolean;
  provider?: AgentProvider;
  securitySchemes?: Record<string, SecurityScheme>;
  docUrl?: string;
}

/**
 * Configuration options for AgentCardBuilder.
 */
export interface AgentCardBuilderOptions {
  agent: BaseAgent;
  rpcUrl?: string;
  capabilities?: AgentCapabilities;
  docUrl?: string;
  provider?: AgentProvider;
  agentVersion?: string;
  securitySchemes?: Record<string, SecurityScheme>;
}

/**
 * Builder class for creating agent cards from ADK agents.
 *
 * This class provides functionality to convert ADK agents into A2A agent cards,
 * including extracting skills, capabilities, and metadata from various agent
 * types.
 */
@a2aExperimental
export class AgentCardBuilder {
  private readonly _agent: BaseAgent;
  private readonly _rpcUrl: string;
  private readonly _capabilities: AgentCapabilities;
  private readonly _docUrl?: string;
  private readonly _provider?: AgentProvider;
  private readonly _securitySchemes?: Record<string, SecurityScheme>;
  private readonly _agentVersion: string;

  constructor(options: AgentCardBuilderOptions) {
    if (!options.agent) {
      throw new Error('Agent cannot be None or empty.');
    }

    this._agent = options.agent;
    this._rpcUrl = options.rpcUrl ?? 'http://localhost:80/a2a';
    this._capabilities = options.capabilities ?? {};
    this._docUrl = options.docUrl;
    this._provider = options.provider;
    this._securitySchemes = options.securitySchemes;
    this._agentVersion = options.agentVersion ?? '0.0.1';
  }

  /**
   * Build and return the complete agent card.
   */
  async build(): Promise<AgentCard> {
    logA2aExperimentalWarning();

    try {
      const primarySkills = await buildPrimarySkills(this._agent);
      const subAgentSkills = await buildSubAgentSkills(this._agent);
      const allSkills = [...primarySkills, ...subAgentSkills];

      return {
        name: this._agent.name,
        description: this._agent.description ?? 'An ADK Agent',
        docUrl: this._docUrl,
        url: this._rpcUrl.replace(/\/+$/, ''),
        version: this._agentVersion,
        capabilities: this._capabilities,
        skills: allSkills,
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
        supportsAuthenticatedExtendedCard: false,
        provider: this._provider,
        securitySchemes: this._securitySchemes,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to build agent card for ${this._agent.name}: ${errorMessage}`
      );
    }
  }
}

// Module-level helper functions

/**
 * Build skills for any agent type.
 */
async function buildPrimarySkills(agent: BaseAgent): Promise<AgentSkill[]> {
  if (isLlmAgent(agent)) {
    return await buildLlmAgentSkills(agent);
  } else {
    return await buildNonLlmAgentSkills(agent);
  }
}

/**
 * Build skills for LLM agent.
 */
async function buildLlmAgentSkills(agent: LlmAgent): Promise<AgentSkill[]> {
  const skills: AgentSkill[] = [];

  // 1. Agent skill (main model skill)
  const agentDescription = buildLlmAgentDescriptionWithInstructions(agent);
  const agentExamples = await extractExamplesFromAgent(agent);

  skills.push({
    id: agent.name,
    name: 'model',
    description: agentDescription,
    examples: extractInputsFromExamples(agentExamples),
    inputModes: getInputModes(agent),
    outputModes: getOutputModes(agent),
    tags: ['llm'],
  });

  // 2. Tool skills
  if (agent.tools && agent.tools.length > 0) {
    const toolSkills = await buildToolSkills(agent);
    skills.push(...toolSkills);
  }

  // 3. Planner skill
  if (agent.planner) {
    skills.push(buildPlannerSkill(agent));
  }

  // 4. Code executor skill
  if (agent.codeExecutor) {
    skills.push(buildCodeExecutorSkill(agent));
  }

  return skills;
}

/**
 * Build skills for all sub-agents.
 */
async function buildSubAgentSkills(agent: BaseAgent): Promise<AgentSkill[]> {
  const subAgentSkills: AgentSkill[] = [];

  for (const subAgent of agent.subAgents) {
    try {
      const subSkills = await buildPrimarySkills(subAgent);
      for (const skill of subSkills) {
        // Create a new skill instance to avoid modifying original if shared
        const aggregatedSkill: AgentSkill = {
          id: `${subAgent.name}_${skill.id}`,
          name: `${subAgent.name}: ${skill.name}`,
          description: skill.description,
          examples: skill.examples,
          inputModes: skill.inputModes,
          outputModes: skill.outputModes,
          tags: [`sub_agent:${subAgent.name}`, ...(skill.tags ?? [])],
        };
        subAgentSkills.push(aggregatedSkill);
      }
    } catch (error) {
      // Log warning but continue with other sub-agents
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(
        `Warning: Failed to build skills for sub-agent ${subAgent.name}: ${errorMessage}`
      );
      continue;
    }
  }

  return subAgentSkills;
}

/**
 * Build skills for agent tools.
 */
async function buildToolSkills(agent: LlmAgent): Promise<AgentSkill[]> {
  const toolSkills: AgentSkill[] = [];
  const canonicalTools = await agent.canonicalTools();

  for (const tool of canonicalTools) {
    const toolName = tool.name ?? tool.constructor.name;

    toolSkills.push({
      id: `${agent.name}-${toolName}`,
      name: toolName,
      description: tool.description ?? `Tool: ${toolName}`,
      examples: undefined,
      inputModes: undefined,
      outputModes: undefined,
      tags: ['llm', 'tools'],
    });
  }

  return toolSkills;
}

/**
 * Build planner skill for LLM agent.
 */
function buildPlannerSkill(agent: LlmAgent): AgentSkill {
  return {
    id: `${agent.name}-planner`,
    name: 'planning',
    description: 'Can think about the tasks to do and make plans',
    examples: undefined,
    inputModes: undefined,
    outputModes: undefined,
    tags: ['llm', 'planning'],
  };
}

/**
 * Build code executor skill for LLM agent.
 */
function buildCodeExecutorSkill(agent: LlmAgent): AgentSkill {
  return {
    id: `${agent.name}-code-executor`,
    name: 'code-execution',
    description: 'Can execute code',
    examples: undefined,
    inputModes: undefined,
    outputModes: undefined,
    tags: ['llm', 'code_execution'],
  };
}

/**
 * Build skills for non-LLM agents.
 */
async function buildNonLlmAgentSkills(agent: BaseAgent): Promise<AgentSkill[]> {
  const skills: AgentSkill[] = [];

  // 1. Agent skill (main agent skill)
  const agentDescription = buildAgentDescription(agent);
  const agentExamples = await extractExamplesFromAgent(agent);

  // Determine agent type and name
  const agentType = getAgentType(agent);
  const agentSkillName = getAgentSkillName(agent);

  skills.push({
    id: agent.name,
    name: agentSkillName,
    description: agentDescription,
    examples: extractInputsFromExamples(agentExamples),
    inputModes: getInputModes(agent),
    outputModes: getOutputModes(agent),
    tags: [agentType],
  });

  // 2. Sub-agent orchestration skill (for agents with sub-agents)
  if (agent.subAgents && agent.subAgents.length > 0) {
    const orchestrationSkill = buildOrchestrationSkill(agent, agentType);
    if (orchestrationSkill) {
      skills.push(orchestrationSkill);
    }
  }

  return skills;
}

/**
 * Build orchestration skill for agents with sub-agents.
 */
function buildOrchestrationSkill(
  agent: BaseAgent,
  agentType: string
): AgentSkill | undefined {
  const subAgentDescriptions: string[] = [];
  for (const subAgent of agent.subAgents) {
    const description = subAgent.description ?? 'No description';
    subAgentDescriptions.push(`${subAgent.name}: ${description}`);
  }

  if (subAgentDescriptions.length === 0) {
    return undefined;
  }

  return {
    id: `${agent.name}-sub-agents`,
    name: 'sub-agents',
    description: 'Orchestrates: ' + subAgentDescriptions.join('; '),
    examples: undefined,
    inputModes: undefined,
    outputModes: undefined,
    tags: [agentType, 'orchestration'],
  };
}

/**
 * Get the agent type for tagging.
 */
function getAgentType(agent: BaseAgent): string {
  if (isLlmAgent(agent)) {
    return 'llm';
  } else if (isSequentialAgent(agent)) {
    return 'sequential_workflow';
  } else if (isParallelAgent(agent)) {
    return 'parallel_workflow';
  } else if (isLoopAgent(agent)) {
    return 'loop_workflow';
  } else {
    return 'custom_agent';
  }
}

/**
 * Get the skill name based on agent type.
 */
function getAgentSkillName(agent: BaseAgent): string {
  if (isLlmAgent(agent)) {
    return 'model';
  } else if (
    isSequentialAgent(agent) ||
    isParallelAgent(agent) ||
    isLoopAgent(agent)
  ) {
    return 'workflow';
  } else {
    return 'custom';
  }
}

/**
 * Build agent description from agent.description and workflow-specific descriptions.
 */
function buildAgentDescription(agent: BaseAgent): string {
  const descriptionParts: string[] = [];

  // Add agent description
  if (agent.description) {
    descriptionParts.push(agent.description);
  }

  // Add workflow-specific descriptions for non-LLM agents
  if (!isLlmAgent(agent)) {
    const workflowDescription = getWorkflowDescription(agent);
    if (workflowDescription) {
      descriptionParts.push(workflowDescription);
    }
  }

  return descriptionParts.length > 0
    ? descriptionParts.join(' ')
    : getDefaultDescription(agent);
}

/**
 * Build agent description including instructions for LlmAgents.
 */
function buildLlmAgentDescriptionWithInstructions(agent: LlmAgent): string {
  const descriptionParts: string[] = [];

  // Add agent description
  if (agent.description) {
    descriptionParts.push(agent.description);
  }

  // Add instruction (with pronoun replacement) - only for LlmAgent
  // Note: instruction can be string or InstructionProvider, only use if string
  if (agent.instruction && typeof agent.instruction === 'string') {
    const instruction = replacePronouns(agent.instruction);
    descriptionParts.push(instruction);
  }

  // Add global instruction (with pronoun replacement) - only for LlmAgent
  // Note: globalInstruction can be string or InstructionProvider, only use if string
  if (agent.globalInstruction && typeof agent.globalInstruction === 'string') {
    const globalInstruction = replacePronouns(agent.globalInstruction);
    descriptionParts.push(globalInstruction);
  }

  return descriptionParts.length > 0
    ? descriptionParts.join(' ')
    : getDefaultDescription(agent);
}

/**
 * Replace pronouns and conjugate common verbs for agent description.
 * (e.g., "You are" -> "I am", "your" -> "my").
 */
function replacePronouns(text: string): string {
  const pronounMap: Record<string, string> = {
    // Longer phrases with verb conjugations
    'you are': 'I am',
    'you were': 'I was',
    "you're": 'I am',
    "you've": 'I have',
    // Standalone pronouns
    'yours': 'mine',
    'your': 'my',
    'you': 'I',
  };

  // Sort keys by length (descending) to ensure longer phrases are matched first.
  // This prevents "you" in "you are" from being replaced on its own.
  const sortedKeys = Object.keys(pronounMap).sort((a, b) => b.length - a.length);

  const pattern = new RegExp(
    '\\b(' + sortedKeys.map(escapeRegex).join('|') + ')\\b',
    'gi'
  );

  return text.replace(pattern, (match) => {
    return pronounMap[match.toLowerCase()] ?? match;
  });
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Get workflow-specific description for non-LLM agents.
 */
function getWorkflowDescription(agent: BaseAgent): string | undefined {
  if (!agent.subAgents || agent.subAgents.length === 0) {
    return undefined;
  }

  if (isSequentialAgent(agent)) {
    return buildSequentialDescription(agent);
  } else if (isParallelAgent(agent)) {
    return buildParallelDescription(agent);
  } else if (isLoopAgent(agent)) {
    return buildLoopDescription(agent);
  }

  return undefined;
}

/**
 * Build description for sequential workflow agent.
 */
function buildSequentialDescription(agent: BaseAgent): string {
  const descriptions: string[] = [];
  const subAgents = agent.subAgents;

  for (let i = 0; i < subAgents.length; i++) {
    const subAgent = subAgents[i];
    const subDescription =
      subAgent.description ?? `execute the ${subAgent.name} agent`;

    if (i === 0) {
      descriptions.push(`First, this agent will ${subDescription}`);
    } else if (i === subAgents.length - 1) {
      descriptions.push(`Finally, this agent will ${subDescription}`);
    } else {
      descriptions.push(`Then, this agent will ${subDescription}`);
    }
  }

  return descriptions.join(' ') + '.';
}

/**
 * Build description for parallel workflow agent.
 */
function buildParallelDescription(agent: BaseAgent): string {
  const descriptions: string[] = [];
  const subAgents = agent.subAgents;

  for (let i = 0; i < subAgents.length; i++) {
    const subAgent = subAgents[i];
    const subDescription =
      subAgent.description ?? `execute the ${subAgent.name} agent`;

    if (i === 0) {
      descriptions.push(`This agent will ${subDescription}`);
    } else if (i === subAgents.length - 1) {
      descriptions.push(`and ${subDescription}`);
    } else {
      descriptions.push(`, ${subDescription}`);
    }
  }

  return descriptions.join(' ') + ' simultaneously.';
}

/**
 * Build description for loop workflow agent.
 */
function buildLoopDescription(agent: BaseAgent): string {
  // Note: maxIterations is private in LoopAgent, so we can't access it directly
  // We use 'unlimited' as the default since we can't read the actual value
  const maxIterations = 'unlimited';
  const descriptions: string[] = [];
  const subAgents = agent.subAgents;

  for (let i = 0; i < subAgents.length; i++) {
    const subAgent = subAgents[i];
    const subDescription =
      subAgent.description ?? `execute the ${subAgent.name} agent`;

    if (i === 0) {
      descriptions.push(`This agent will ${subDescription}`);
    } else if (i === subAgents.length - 1) {
      descriptions.push(`and ${subDescription}`);
    } else {
      descriptions.push(`, ${subDescription}`);
    }
  }

  return `${descriptions.join(' ')} in a loop (max ${maxIterations} iterations).`;
}

/**
 * Get default description based on agent type.
 */
function getDefaultDescription(agent: BaseAgent): string {
  if (isLlmAgent(agent)) {
    return 'An LLM-based agent';
  } else if (isSequentialAgent(agent)) {
    return 'A sequential workflow agent';
  } else if (isParallelAgent(agent)) {
    return 'A parallel workflow agent';
  } else if (isLoopAgent(agent)) {
    return 'A loop workflow agent';
  }

  return 'A custom agent';
}

/**
 * Extracts only the input strings so they can be added to an AgentSkill.
 */
function extractInputsFromExamples(
  examples: Array<{input?: Record<string, unknown>}> | undefined
): string[] | undefined {
  if (!examples || examples.length === 0) {
    return undefined;
  }

  const extractedInputs: string[] = [];

  for (const example of examples) {
    const exampleInput = example.input;
    if (!exampleInput) {
      continue;
    }

    const parts = exampleInput.parts as
      | Array<{text?: string}>
      | undefined;
    if (parts !== undefined) {
      const partTexts: string[] = [];
      for (const part of parts) {
        if (part.text !== undefined) {
          partTexts.push(part.text);
        }
      }
      extractedInputs.push(partTexts.join('\n'));
    } else {
      const text = exampleInput.text as string | undefined;
      if (text !== undefined) {
        extractedInputs.push(text);
      }
    }
  }

  return extractedInputs.length > 0 ? extractedInputs : undefined;
}

/**
 * Extract examples from agent instruction.
 * Note: ExampleTool is not available in TypeScript ADK, so we only extract from instructions.
 */
async function extractExamplesFromAgent(
  agent: BaseAgent
): Promise<Array<{input?: Record<string, unknown>}> | undefined> {
  if (!isLlmAgent(agent)) {
    return undefined;
  }

  // Try to extract examples from instruction (only if it's a string)
  if (agent.instruction && typeof agent.instruction === 'string') {
    return extractExamplesFromInstruction(agent.instruction);
  }

  return undefined;
}

/**
 * Extract examples from agent instruction text using regex patterns.
 */
function extractExamplesFromInstruction(
  instruction: string
): Array<{input?: Record<string, unknown>}> | undefined {
  const examples: Array<{input?: Record<string, unknown>}> = [];

  // Look for common example patterns in instructions
  const examplePatterns = [
    /Example Query:\s*["']([^"']+)["']/gi,
    /Example Response:\s*["']([^"']+)["']/gi,
    /Example:\s*["']([^"']+)["']/gi,
  ];

  for (const pattern of examplePatterns) {
    const matches = [...instruction.matchAll(pattern)];
    if (matches.length > 0) {
      for (let i = 0; i < matches.length; i += 2) {
        if (i + 1 < matches.length) {
          examples.push({
            input: {text: matches[i][1]},
          });
        }
      }
    }
  }

  return examples.length > 0 ? examples : undefined;
}

/**
 * Get input modes based on agent model.
 */
function getInputModes(agent: BaseAgent): string[] | undefined {
  if (!isLlmAgent(agent)) {
    return undefined;
  }

  // This could be enhanced to check model capabilities
  // For now, return undefined to use default_input_modes
  return undefined;
}

/**
 * Get output modes from Agent.generate_content_config.response_modalities.
 */
function getOutputModes(agent: BaseAgent): string[] | undefined {
  if (!isLlmAgent(agent)) {
    return undefined;
  }

  const llmAgent = agent as LlmAgent;
  if (
    llmAgent.generateContentConfig &&
    llmAgent.generateContentConfig.responseModalities
  ) {
    return llmAgent.generateContentConfig.responseModalities;
  }

  return undefined;
}
