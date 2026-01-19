/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {FunctionDeclaration, Type} from '@google/genai';

import {BaseTool, RunAsyncToolRequest} from './base_tool.js';
import {ToolContext} from './tool_context.js';

/**
 * Transfer the question to another agent.
 *
 * This tool hands off control to another agent when it's more suitable to
 * answer the user's question according to the agent's description.
 *
 * Note:
 *   For most use cases, you should use TransferToAgentTool instead of this
 *   function directly. TransferToAgentTool provides additional enum constraints
 *   that prevent LLMs from hallucinating invalid agent names.
 *
 * @param agentName - The agent name to transfer to
 * @param toolContext - The tool context providing access to actions
 *
 * @example
 * ```typescript
 * import { transferToAgent, FunctionTool, LlmAgent } from '@google/adk';
 *
 * // Create an agent with a transfer tool
 * const agent = new LlmAgent({
 *   tools: [
 *     new FunctionTool({
 *       name: 'transfer_to_agent',
 *       description: 'Transfer the question to another agent',
 *       execute: transferToAgent,
 *     }),
 *   ],
 * });
 * ```
 */
export function transferToAgent(
    agentName: string, toolContext: ToolContext): void {
  toolContext.actions.transferToAgent = agentName;
}

/**
 * A specialized tool for agent transfer with enum constraints.
 *
 * This tool enhances the base transfer_to_agent function by adding JSON Schema
 * enum constraints to the agent_name parameter. This prevents LLMs from
 * hallucinating invalid agent names by restricting choices to only valid agents.
 *
 * @example
 * ```typescript
 * import { TransferToAgentTool, LlmAgent } from '@google/adk';
 *
 * // Create a transfer tool with specific agent options
 * const transferTool = new TransferToAgentTool(['billing_agent', 'support_agent']);
 *
 * const agent = new LlmAgent({
 *   tools: [transferTool],
 * });
 * ```
 */
export class TransferToAgentTool extends BaseTool {
  /**
   * List of valid agent names that can be transferred to.
   */
  private readonly agentNames: string[];

  /**
   * Initialize the TransferToAgentTool.
   *
   * @param agentNames - List of valid agent names that can be transferred to
   */
  constructor(agentNames: string[]) {
    super({
      name: 'transfer_to_agent',
      description:
          'Transfer the question to another agent when it\'s more suitable to ' +
          'answer the user\'s question according to the agent\'s description.',
    });
    this.agentNames = agentNames;
  }

  /**
   * Execute the transfer to agent action.
   */
  async runAsync(request: RunAsyncToolRequest): Promise<void> {
    const args = request.args as {agentName?: string};
    const agentName = args?.agentName;
    if (agentName) {
      transferToAgent(agentName, request.toolContext);
    }
  }

  /**
   * Add enum constraint to the agent_name parameter.
   *
   * @returns FunctionDeclaration with enum constraint on agent_name parameter.
   */
  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          agentName: {
            type: Type.STRING,
            description: 'The name of the agent to transfer to',
            enum: this.agentNames,
          },
        },
        required: ['agentName'],
      },
    };
  }
}
