/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content} from '@google/genai';

import {LlmAgent} from '../agents/llm_agent.js';
import {Event} from '../events/event.js';
import {InMemoryMemoryService} from '../memory/in_memory_memory_service.js';
import {BaseLlm} from '../models/base_llm.js';
import {Runner} from '../runner/runner.js';
import {InMemorySessionService} from '../sessions/in_memory_session_service.js';

import {AgentTool, AgentToolConfig} from './agent_tool.js';
import {RunAsyncToolRequest} from './base_tool.js';
import {ForwardingArtifactService} from './forwarding_artifact_service.js';
import {GoogleSearchTool} from './google_search_tool.js';

/**
 * Creates a sub-agent that only uses the google_search tool.
 *
 * @param model - The model to use for the sub-agent (string or BaseLlm instance)
 * @returns A configured LlmAgent instance for Google Search
 */
export function createGoogleSearchAgent(model: string|BaseLlm): LlmAgent {
  return new LlmAgent({
    name: 'google_search_agent',
    model: model,
    description:
        'An agent for performing Google search using the `google_search` tool',
    instruction: `
        You are a specialized Google search agent.

        When given a search query, use the \`google_search\` tool to find the related information.
      `,
    tools: [new GoogleSearchTool()],
  });
}

/**
 * A tool that wraps a sub-agent that only uses google_search tool.
 *
 * This is a workaround to support using google_search tool with other tools.
 * The agent wrapping allows the google_search tool to be used alongside
 * other function tools by isolating the built-in tool in a sub-agent.
 *
 * This workaround is temporary and may be removed once the API limitation
 * is fixed.
 *
 * @example
 * ```typescript
 * const searchAgent = createGoogleSearchAgent('gemini-2.0-flash');
 * const searchTool = new GoogleSearchAgentTool({ agent: searchAgent });
 *
 * const agent = new LlmAgent({
 *   name: 'my_agent',
 *   model: 'gemini-2.0-flash',
 *   tools: [searchTool, otherTool], // Can now use with other tools
 * });
 * ```
 */
export class GoogleSearchAgentTool extends AgentTool {
  constructor(config: AgentToolConfig) {
    super(config);
  }

  /**
   * Executes the Google search via a sub-agent.
   *
   * Captures grounding metadata from the search results and stores it in
   * `toolContext.state['temp:_adk_grounding_metadata']` for access by
   * the parent agent.
   */
  override async runAsync({args, toolContext}: RunAsyncToolRequest):
      Promise<unknown> {
    const agent = (this as unknown as {agent: LlmAgent}).agent;

    // Build the user message content
    let content: Content;
    if (agent instanceof LlmAgent && agent.inputSchema) {
      content = {
        role: 'user',
        parts: [{text: JSON.stringify(args)}],
      };
    } else {
      content = {
        role: 'user',
        parts: [{text: args['request'] as string}],
      };
    }

    // Create a runner for the sub-agent
    const runner = new Runner({
      appName: agent.name,
      agent: agent,
      artifactService: new ForwardingArtifactService(toolContext),
      sessionService: new InMemorySessionService(),
      memoryService: new InMemoryMemoryService(),
      credentialService: toolContext.invocationContext.credentialService,
      plugins: Array.from(
          toolContext.invocationContext.pluginManager?.plugins ?? []),
    });

    // Filter out internal ADK states when creating session
    const stateDict: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(toolContext.state.toRecord())) {
      if (!key.startsWith('_adk')) {
        stateDict[key] = value;
      }
    }

    const session = await runner.sessionService.createSession({
      appName: agent.name,
      userId: toolContext.invocationContext.userId,
      state: stateDict,
    });

    // Run the agent and collect results
    let lastEvent: Event|undefined;
    let lastGroundingMetadata: unknown = undefined;

    for await (const event of runner.runAsync({
      userId: session.userId,
      sessionId: session.id,
      newMessage: content,
    })) {
      // Forward state delta to parent session
      if (event.actions.stateDelta) {
        toolContext.state.update(event.actions.stateDelta);
      }

      if (event.content) {
        lastEvent = event;
        lastGroundingMetadata = event.groundingMetadata;
      }
    }

    // Return empty string if no content
    if (!lastEvent?.content?.parts?.length) {
      return '';
    }

    // Merge text parts
    const mergedText = lastEvent.content.parts.map((part) => part.text)
                           .filter((text) => text)
                           .join('\n');

    // Parse output if schema is defined
    let toolResult: unknown;
    if (agent instanceof LlmAgent && agent.outputSchema) {
      try {
        toolResult = JSON.parse(mergedText);
      } catch {
        toolResult = mergedText;
      }
    } else {
      toolResult = mergedText;
    }

    // Store grounding metadata in state for parent agent access
    if (lastGroundingMetadata) {
      toolContext.state.set(
          'temp:_adk_grounding_metadata', lastGroundingMetadata);
    }

    return toolResult;
  }
}
