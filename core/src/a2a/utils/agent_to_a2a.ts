/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Utility function to convert an ADK agent to an A2A-compatible server setup.
 *
 * This module provides the `toA2a()` function that creates all the necessary
 * components to expose an ADK agent as an A2A server.
 */

import {BaseAgent} from '../../agents/base_agent.js';
import {Runner} from '../../runner/runner.js';
import {InMemoryArtifactService} from '../../artifacts/in_memory_artifact_service.js';
import {InMemorySessionService} from '../../sessions/in_memory_session_service.js';
import {InMemoryMemoryService} from '../../memory/in_memory_memory_service.js';
import {InMemoryCredentialService} from '../../auth/credential_service/in_memory_credential_service.js';
import {logger} from '../../utils/logger.js';
import {logA2aExperimentalWarning, a2aExperimental} from '../experimental.js';
import {A2aAgentExecutor, type RunnerFactory} from '../executor/a2a_agent_executor.js';
import {
  AgentCardBuilder,
  type AgentCard,
  type AgentCapabilities,
  type AgentProvider,
  type SecurityScheme,
} from './agent_card_builder.js';

/**
 * Options for toA2a function.
 */
export interface ToA2aOptions {
  /** The ADK agent to convert */
  agent: BaseAgent;
  /** The host for the A2A RPC URL (default: "localhost") */
  host?: string;
  /** The port for the A2A RPC URL (default: 8000) */
  port?: number;
  /** The protocol for the A2A RPC URL (default: "http") */
  protocol?: string;
  /** Optional pre-built AgentCard. If not provided, will be built automatically. */
  agentCard?: AgentCard;
  /** Optional pre-built Runner. If not provided, a default runner will be created. */
  runner?: Runner;
  /** Optional agent capabilities configuration */
  capabilities?: AgentCapabilities;
  /** Optional agent provider information */
  provider?: AgentProvider;
  /** Optional security schemes */
  securitySchemes?: Record<string, SecurityScheme>;
  /** Optional documentation URL */
  docUrl?: string;
  /** Optional agent version (default: "0.0.1") */
  agentVersion?: string;
}

/**
 * Result object returned by toA2a function.
 */
export interface A2aServerComponents {
  /** The A2A agent executor that handles requests */
  executor: A2aAgentExecutor;
  /** The agent card (built or provided) */
  agentCard: AgentCard;
  /** The runner used for agent execution */
  runner: Runner;
  /** Function to build agent card asynchronously (if not provided) */
  buildAgentCard: () => Promise<AgentCard>;
  /** The RPC URL for the A2A server */
  rpcUrl: string;
}

/**
 * Creates a default runner for the agent.
 *
 * @param agent - The ADK agent.
 * @returns A configured Runner instance.
 */
function createDefaultRunner(agent: BaseAgent): Runner {
  return new Runner({
    appName: agent.name || 'adk_agent',
    agent: agent,
    artifactService: new InMemoryArtifactService(),
    sessionService: new InMemorySessionService(),
    memoryService: new InMemoryMemoryService(),
    credentialService: new InMemoryCredentialService(),
  });
}

/**
 * Convert an ADK agent to A2A server components.
 *
 * This function creates all the necessary components to expose an ADK agent
 * as an A2A server. It returns an object containing the executor, agent card,
 * runner, and helper functions.
 *
 * @param options - Configuration options for the A2A server setup.
 * @returns An object containing all A2A server components.
 *
 * @example
 * ```typescript
 * import { LlmAgent } from '@google/adk';
 * import { toA2a } from '@google/adk/a2a';
 *
 * const agent = new LlmAgent({
 *   name: 'my_agent',
 *   model: 'gemini-2.5-flash',
 *   instruction: 'You are a helpful assistant.',
 * });
 *
 * const a2aComponents = await toA2a({ agent });
 *
 * // The executor can be used with any HTTP framework
 * // The agentCard can be served at /.well-known/agent.json
 * console.log('Agent Card:', a2aComponents.agentCard);
 * console.log('RPC URL:', a2aComponents.rpcUrl);
 * ```
 */
export async function toA2a(options: ToA2aOptions): Promise<A2aServerComponents> {
  logA2aExperimentalWarning();

  const {
    agent,
    host = 'localhost',
    port = 8000,
    protocol = 'http',
    agentCard: providedAgentCard,
    runner: providedRunner,
    capabilities,
    provider,
    securitySchemes,
    docUrl,
    agentVersion,
  } = options;

  if (!agent) {
    throw new Error('Agent is required');
  }

  // Set up ADK logging to ensure logs are visible
  logger.info(`Setting up A2A server for agent: ${agent.name}`);

  // Create or use the provided runner
  const runner = providedRunner ?? createDefaultRunner(agent);

  // Build the RPC URL
  const rpcUrl = `${protocol}://${host}:${port}/`;

  // Create the agent card builder
  const cardBuilder = new AgentCardBuilder({
    agent,
    rpcUrl,
    capabilities,
    provider,
    securitySchemes,
    docUrl,
    agentVersion,
  });

  // Build agent card function
  const buildAgentCard = async (): Promise<AgentCard> => {
    if (providedAgentCard) {
      return providedAgentCard;
    }
    return await cardBuilder.build();
  };

  // Build the agent card (or use provided one)
  const agentCard = providedAgentCard ?? (await buildAgentCard());

  // Create the A2A agent executor
  const executor = new A2aAgentExecutor(runner);

  return {
    executor,
    agentCard,
    runner,
    buildAgentCard,
    rpcUrl,
  };
}

/**
 * Creates a factory function that returns the A2A server components lazily.
 * Useful when you want to defer the agent card building.
 *
 * @param options - Configuration options for the A2A server setup.
 * @returns A factory function that returns A2A server components.
 */
export function createA2aServerFactory(
  options: ToA2aOptions
): () => Promise<A2aServerComponents> {
  logA2aExperimentalWarning();

  return async () => toA2a(options);
}

/**
 * Creates an A2A agent executor with a runner factory.
 * The runner is created lazily on first request.
 *
 * @param agent - The ADK agent.
 * @param runnerFactory - Optional factory function to create the runner.
 * @returns An A2aAgentExecutor instance.
 */
export function createA2aExecutor(
  agent: BaseAgent,
  runnerFactory?: RunnerFactory
): A2aAgentExecutor {
  logA2aExperimentalWarning();

  const factory: RunnerFactory = runnerFactory ?? (() => createDefaultRunner(agent));
  return new A2aAgentExecutor(factory);
}
