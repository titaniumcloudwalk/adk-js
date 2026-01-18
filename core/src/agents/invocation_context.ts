/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, FunctionCall} from '@google/genai';

import {ResumabilityConfig} from '../apps/app.js';
import {BaseArtifactService} from '../artifacts/base_artifact_service.js';
import {BaseCredentialService} from '../auth/credential_service/base_credential_service.js';
import {Event} from '../events/event.js';
import {BaseMemoryService} from '../memory/base_memory_service.js';
import {PluginManager} from '../plugins/plugin_manager.js';
import {BaseSessionService} from '../sessions/base_session_service.js';
import {Session} from '../sessions/session.js';
import {randomUUID} from '../utils/env_aware_utils.js';

import {ActiveStreamingTool} from './active_streaming_tool.js';
import {BaseAgent} from './base_agent.js';
import {LiveRequestQueue} from './live_request_queue.js';
import {RealtimeCacheEntry} from './realtime_cache_entry.js';
import {RunConfig} from './run_config.js';
import {TranscriptionEntry} from './transcription_entry.js';

interface InvocationContextParams {
  artifactService?: BaseArtifactService;
  sessionService?: BaseSessionService;
  memoryService?: BaseMemoryService;
  credentialService?: BaseCredentialService;
  invocationId: string;
  branch?: string;
  agent: BaseAgent;
  userContent?: Content;
  session: Session;
  endInvocation?: boolean;
  transcriptionCache?: TranscriptionEntry[];
  inputRealtimeCache?: RealtimeCacheEntry[];
  outputRealtimeCache?: RealtimeCacheEntry[];
  runConfig?: RunConfig;
  liveRequestQueue?: LiveRequestQueue;
  activeStreamingTools?: Record<string, ActiveStreamingTool>;
  pluginManager: PluginManager;
  resumabilityConfig?: ResumabilityConfig;
  agentStates?: Record<string, Record<string, unknown>>;
  endOfAgents?: Record<string, boolean>;
}

/**
 * A container to keep track of the cost of invocation.
 *
 * While we don't expect the metrics captured here to be a direct
 * representative of monetary cost incurred in executing the current
 * invocation, they in some ways have an indirect effect.
 */
class InvocationCostManager {
  private numberOfLlmCalls: number = 0;

  /**
   * Increments the number of llm calls and enforces the limit.
   *
   * @param runConfig the run config of the invocation.
   * @throws If number of llm calls made exceed the set threshold.
   */
  incrementAndEnforceLlmCallsLimit(runConfig?: RunConfig) {
    this.numberOfLlmCalls++;

    if (runConfig && runConfig.maxLlmCalls! > 0 &&
        this.numberOfLlmCalls > runConfig.maxLlmCalls!) {
      throw new Error(`Max number of llm calls limit of ${
          runConfig.maxLlmCalls!} exceeded`);
    }
  }
}

/**
 * An invocation context represents the data of a single invocation of an agent.
 *
 * An invocation:
 *     1. Starts with a user message and ends with a final response.
 *     2. Can contain one or multiple agent calls.
 *     3. Is handled by runner.runAsync().
 *
 *   An invocation runs an agent until it does not request to transfer to
 * another agent.
 *
 *   An agent call:
 *     1. Is handled by agent.runAsync().
 *     2. Ends when agent.runAsync() ends.
 *
 *   An LLM agent call is an agent with a BaseLLMFlow.
 *  An LLM agent call can contain one or multiple steps.
 *
 *  An LLM agent runs steps in a loop until:
 *    1. A final response is generated.
 *    2. The agent transfers to another agent.
 *    3. The end_invocation is set to true by any callbacks or tools.
 *
 *  A step:
 *    1. Calls the LLM only once and yields its response.
 *   2. Calls the tools and yields their responses if requested.
 *
 *  The summarization of the function response is considered another step, since
 *  it is another llm call.
 *  A step ends when it's done calling llm and tools, or if the end_invocation
 *  is set to true at any time.
 *
 *  ```
 *     ┌─────────────────────── invocation ──────────────────────────┐
 *     ┌──────────── llm_agent_call_1 ────────────┐ ┌─ agent_call_2 ─┐
 *     ┌──── step_1 ────────┐ ┌───── step_2 ──────┐
 *     [call_llm] [call_tool] [call_llm] [transfer]
 *  ```
 */
export class InvocationContext {
  readonly artifactService?: BaseArtifactService;
  readonly sessionService?: BaseSessionService;
  readonly memoryService?: BaseMemoryService;
  readonly credentialService?: BaseCredentialService;

  /**
   * The id of this invocation context.
   */
  readonly invocationId: string;

  /**
   * The branch of the invocation context.
   *
   * The format is like agent_1.agent_2.agent_3, where agent_1 is the parent of
   * agent_2, and agent_2 is the parent of agent_3.
   *
   * Branch is used when multiple sub-agents shouldn't see their peer agents'
   * conversation history.
   */
  branch?: string;

  /**
   * The current agent of this invocation context.
   */
  agent: BaseAgent;

  /**
   * The user content that started this invocation.
   */
  readonly userContent?: Content;

  /**
   * The current session of this invocation context.
   */
  readonly session: Session;

  /**
   * Whether to end this invocation.
   * Set to True in callbacks or tools to terminate this invocation.
   */
  endInvocation: boolean;

  /**
   * Caches necessary, data audio or contents, that are needed by transcription.
   */
  transcriptionCache?: TranscriptionEntry[];

  /**
   * Cache for input (user) realtime audio/video data.
   * Used by AudioCacheManager to accumulate audio chunks before flushing.
   */
  inputRealtimeCache?: RealtimeCacheEntry[];

  /**
   * Cache for output (model) realtime audio/video data.
   * Used by AudioCacheManager to accumulate audio chunks before flushing.
   */
  outputRealtimeCache?: RealtimeCacheEntry[];

  /**
   * Configurations for live agents under this invocation.
   */
  runConfig?: RunConfig;

  /**
   * A container to keep track of different kinds of costs incurred as a part of
   * this invocation.
   */
  private readonly invocationCostManager = new InvocationCostManager();

  /**
   * The queue to receive live requests.
   */
  liveRequestQueue?: LiveRequestQueue;

  /**
   * The running streaming tools of this invocation.
   */
  activeStreamingTools?: Record<string, ActiveStreamingTool>;

  /**
   * The manager for keeping track of plugins in this invocation.
   */
  pluginManager: PluginManager;

  /**
   * Configuration for session resumability.
   *
   * When enabled, allows pausing invocations on long-running function calls
   * and resuming from the last checkpoint.
   */
  resumabilityConfig?: ResumabilityConfig;

  /**
   * The agent states stored during resumable invocations.
   * Key is the agent name, value is the serialized agent state.
   */
  readonly agentStates: Record<string, Record<string, unknown>>;

  /**
   * Tracks which agents have finished their current run.
   * Key is the agent name, value indicates end-of-agent status.
   */
  readonly endOfAgents: Record<string, boolean>;

  /**
   * @param params The parameters for creating an invocation context.
   */
  constructor(params: InvocationContextParams) {
    this.artifactService = params.artifactService;
    this.sessionService = params.sessionService;
    this.memoryService = params.memoryService;
    this.invocationId = params.invocationId;
    this.branch = params.branch;
    this.agent = params.agent;
    this.userContent = params.userContent;
    this.session = params.session;
    this.endInvocation = params.endInvocation || false;
    this.transcriptionCache = params.transcriptionCache;
    this.inputRealtimeCache = params.inputRealtimeCache;
    this.outputRealtimeCache = params.outputRealtimeCache;
    this.runConfig = params.runConfig;
    this.liveRequestQueue = params.liveRequestQueue;
    this.activeStreamingTools = params.activeStreamingTools;
    this.pluginManager = params.pluginManager;
    this.resumabilityConfig = params.resumabilityConfig;
    this.agentStates = params.agentStates ?? {};
    this.endOfAgents = params.endOfAgents ?? {};
  }

  /**
   * The app name of the current session.
   */
  get appName() {
    return this.session.appName;
  }

  /**
   * The user ID of the current session.
   */
  get userId() {
    return this.session.userId;
  }

  /**
   * Tracks number of llm calls made.
   *
   * @throws If number of llm calls made exceed the set threshold.
   */
  incrementLlmCallCount() {
    this.invocationCostManager.incrementAndEnforceLlmCallsLimit(this.runConfig);
  }

  /**
   * Whether this invocation is resumable.
   *
   * Returns true if resumabilityConfig is set and isResumable is true.
   */
  get isResumable(): boolean {
    return this.resumabilityConfig?.isResumable ?? false;
  }

  /**
   * Sets the agent state for the given agent.
   *
   * @param agentName The name of the agent.
   * @param agentState The serialized agent state, or undefined to clear.
   * @param endOfAgent If true, marks the agent as finished. If undefined, clears the flag.
   */
  setAgentState(
      agentName: string,
      agentState?: Record<string, unknown>,
      endOfAgent?: boolean,
  ): void {
    if (endOfAgent === true) {
      // Agent is finished, mark as end and clear state
      this.endOfAgents[agentName] = true;
      delete this.agentStates[agentName];
    } else if (agentState !== undefined) {
      // Agent state provided, store it and clear end flag
      this.agentStates[agentName] = agentState;
      this.endOfAgents[agentName] = false;
    } else {
      // Clear both state and end flag
      delete this.agentStates[agentName];
      delete this.endOfAgents[agentName];
    }
  }

  /**
   * Gets the agent state for the given agent.
   *
   * @param agentName The name of the agent.
   * @returns The serialized agent state, or undefined if not set.
   */
  getAgentState(agentName: string): Record<string, unknown>|undefined {
    return this.agentStates[agentName];
  }

  /**
   * Checks if the agent has finished its current run.
   *
   * @param agentName The name of the agent.
   * @returns True if the agent is marked as finished.
   */
  isEndOfAgent(agentName: string): boolean {
    return this.endOfAgents[agentName] ?? false;
  }

  /**
   * Resets the agent states for the given agent and all its sub-agents.
   *
   * Used when restarting a loop iteration to clear checkpoint data.
   *
   * @param agent The agent whose state (and sub-agent states) should be reset.
   */
  resetSubAgentStates(agent: BaseAgent): void {
    // Reset this agent's state
    delete this.agentStates[agent.name];
    delete this.endOfAgents[agent.name];

    // Recursively reset all sub-agents
    for (const subAgent of agent.subAgents) {
      this.resetSubAgentStates(subAgent);
    }
  }

  /**
   * Determines if the invocation should pause due to long-running tools.
   *
   * Checks if the invocation is resumable and if the event contains
   * function calls that match any of the configured long-running tool IDs.
   *
   * @param event The event to check for pause conditions.
   * @returns True if the invocation should pause.
   */
  shouldPauseInvocation(event: Event): boolean {
    if (!this.isResumable) {
      return false;
    }

    // Check if event has long-running tool IDs and function calls
    const longRunningToolIds = event.longRunningToolIds;
    if (!longRunningToolIds || longRunningToolIds.length === 0) {
      return false;
    }

    // Get function calls from the event content
    const functionCalls = this.extractFunctionCalls(event);
    if (functionCalls.length === 0) {
      return false;
    }

    // Check if any function call ID matches a long-running tool ID
    for (const fc of functionCalls) {
      if (fc.id && longRunningToolIds.includes(fc.id)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Populates agent states from session event history.
   *
   * Used at the start of a resumable invocation to restore checkpoint data.
   */
  populateInvocationAgentStates(): void {
    if (!this.session || !this.session.events) {
      return;
    }

    // Iterate through events to find agent state checkpoints
    for (const event of this.session.events) {
      const author = event.author;
      if (!author) {
        continue;
      }

      if (event.actions.agentState !== undefined) {
        this.agentStates[author] = event.actions.agentState;
        this.endOfAgents[author] = false;
      }
      if (event.actions.endOfAgent === true) {
        this.endOfAgents[author] = true;
        delete this.agentStates[author];
      }
    }
  }

  /**
   * Extracts function calls from an event's content.
   *
   * @param event The event to extract function calls from.
   * @returns Array of function calls found in the event.
   */
  private extractFunctionCalls(event: Event): FunctionCall[] {
    const functionCalls: FunctionCall[] = [];

    if (!event.content?.parts) {
      return functionCalls;
    }

    for (const part of event.content.parts) {
      if ('functionCall' in part && part.functionCall) {
        functionCalls.push(part.functionCall);
      }
    }

    return functionCalls;
  }
}

export function newInvocationContextId(): string {
  return `e-${randomUUID()}`;
}
