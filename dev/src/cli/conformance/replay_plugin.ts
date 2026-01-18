/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Replay plugin for ADK conformance testing.
 *
 * This plugin replays recorded LLM responses and tool responses
 * instead of making real calls, enabling deterministic testing.
 */

import * as fs from 'fs';
import * as path from 'path';

import {Content, FunctionCall} from '@google/genai';
import * as yaml from 'js-yaml';

import {
  BasePlugin,
  BaseTool,
  CallbackContext,
  InvocationContext,
  LlmRequest,
  LlmResponse,
  ToolContext,
} from '@google/adk';

import {
  LlmRecording,
  Recording,
  Recordings,
  ToolRecording,
  yamlToRecordings,
} from './recordings_schema.js';

/**
 * Exception raised when replay verification fails.
 */
export class ReplayVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayVerificationError';
  }
}

/**
 * Exception raised when replay configuration is invalid or missing.
 */
export class ReplayConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayConfigError';
  }
}

/**
 * Per-invocation replay state to isolate concurrent runs.
 */
interface InvocationReplayState {
  /** Path to the test case directory. */
  testCasePath: string;
  /** Index of the user message being replayed. */
  userMessageIndex: number;
  /** The recordings to replay. */
  recordings: Recordings;
  /** Per-agent replay indices for parallel execution. Key: agentName -> current index. */
  agentReplayIndices: Map<string, number>;
}

/**
 * Configuration for replay passed through session state.
 */
interface ReplayConfig {
  /** Directory path for the test case. */
  dir: string;
  /** Index of the user message (0-based). */
  user_message_index: number;
}

/**
 * Plugin for replaying ADK agent interactions from recordings.
 */
export class ReplayPlugin extends BasePlugin {
  /**
   * Track replay state per invocation to support concurrent runs.
   * Key: invocationId -> InvocationReplayState
   */
  private invocationStates: Map<string, InvocationReplayState> = new Map();

  constructor(name: string = 'adk_replay') {
    super(name);
  }

  /**
   * Load replay recordings when enabled.
   */
  override async beforeRunCallback({
    invocationContext,
  }: {
    invocationContext: InvocationContext;
  }): Promise<Content | undefined> {
    const ctx = new CallbackContext({invocationContext});
    if (this.isReplayModeOn(ctx)) {
      this.loadInvocationState(ctx);
    }
    return undefined;
  }

  /**
   * Replay LLM response from recordings instead of making real call.
   */
  override async beforeModelCallback({
    callbackContext,
    llmRequest,
  }: {
    callbackContext: CallbackContext;
    llmRequest: LlmRequest;
  }): Promise<LlmResponse | undefined> {
    if (!this.isReplayModeOn(callbackContext)) {
      return undefined;
    }

    const state = this.getInvocationState(callbackContext);
    if (!state) {
      throw new ReplayConfigError('Replay state not initialized. Ensure before_run created it.');
    }

    const agentName = callbackContext.agentName;

    // Verify and get the next LLM recording for this specific agent
    const recording = this.verifyAndGetNextLlmRecordingForAgent(state, agentName, llmRequest);

    // Return the recorded response
    return recording.llmResponse;
  }

  /**
   * Replay tool response from recordings instead of executing tool.
   */
  override async beforeToolCallback({
    tool,
    toolArgs,
    toolContext,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
  }): Promise<Record<string, unknown> | undefined> {
    if (!this.isReplayModeOn(toolContext)) {
      return undefined;
    }

    const state = this.getInvocationState(toolContext);
    if (!state) {
      throw new ReplayConfigError('Replay state not initialized. Ensure before_run created it.');
    }

    const agentName = toolContext.agentName;

    // Verify and get the next tool recording for this specific agent
    const recording = this.verifyAndGetNextToolRecordingForAgent(
      state,
      agentName,
      tool.name,
      toolArgs
    );

    // Note: Unlike Python, we don't execute AgentTool here to keep it simple.
    // If needed, this can be extended later.

    // Return the recorded response
    return recording.toolResponse?.response as Record<string, unknown>;
  }

  /**
   * Clean up replay state after invocation completes.
   */
  override async afterRunCallback({
    invocationContext,
  }: {
    invocationContext: InvocationContext;
  }): Promise<void> {
    const ctx = new CallbackContext({invocationContext});
    if (!this.isReplayModeOn(ctx)) {
      return;
    }

    // Clean up per-invocation replay state
    this.invocationStates.delete(ctx.invocationId);
  }

  /**
   * Check if replay mode is enabled for this invocation.
   */
  private isReplayModeOn(callbackContext: CallbackContext | ToolContext): boolean {
    const sessionState = callbackContext.state;
    const config = sessionState.get('_adk_replay_config') as ReplayConfig | undefined;
    if (!config) {
      return false;
    }
    return Boolean(config.dir) && config.user_message_index !== undefined;
  }

  /**
   * Get existing replay state for this invocation.
   */
  private getInvocationState(
    callbackContext: CallbackContext | ToolContext
  ): InvocationReplayState | undefined {
    const invocationId = callbackContext.invocationId;
    return this.invocationStates.get(invocationId);
  }

  /**
   * Load and store replay state for this invocation.
   */
  private loadInvocationState(callbackContext: CallbackContext): InvocationReplayState {
    const invocationId = callbackContext.invocationId;
    const sessionState = callbackContext.state;

    const config = sessionState.get('_adk_replay_config') as ReplayConfig | undefined;
    const caseDir = config?.dir;
    const msgIndex = config?.user_message_index;

    if (!caseDir || msgIndex === undefined) {
      throw new ReplayConfigError('Replay parameters are missing from session state');
    }

    // Load recordings
    const recordingsFile = path.join(caseDir, 'generated-recordings.yaml');

    if (!fs.existsSync(recordingsFile)) {
      throw new ReplayConfigError(`Recordings file not found: ${recordingsFile}`);
    }

    let recordings: Recordings;
    try {
      const fileContent = fs.readFileSync(recordingsFile, 'utf-8');
      const recordingsData = yaml.load(fileContent) as Record<string, unknown>;
      recordings = yamlToRecordings(recordingsData);
    } catch (error) {
      throw new ReplayConfigError(`Failed to load recordings from ${recordingsFile}: ${error}`);
    }

    // Create and store invocation state
    const state: InvocationReplayState = {
      testCasePath: caseDir,
      userMessageIndex: msgIndex,
      recordings: recordings,
      agentReplayIndices: new Map(),
    };
    this.invocationStates.set(invocationId, state);

    return state;
  }

  /**
   * Get the next recording for the specific agent in strict order.
   */
  private getNextRecordingForAgent(
    state: InvocationReplayState,
    agentName: string
  ): Recording {
    // Get current agent index
    const currentAgentIndex = state.agentReplayIndices.get(agentName) || 0;

    // Filter ALL recordings for this agent and user message index (strict order)
    const agentRecordings = state.recordings.recordings.filter(
      recording =>
        recording.agentName === agentName &&
        recording.userMessageIndex === state.userMessageIndex
    );

    // Check if we have enough recordings for this agent
    if (currentAgentIndex >= agentRecordings.length) {
      throw new ReplayVerificationError(
        `Runtime sent more requests than expected for agent '${agentName}' ` +
        `at user_message_index ${state.userMessageIndex}. Expected ` +
        `${agentRecordings.length}, but got request at index ${currentAgentIndex}`
      );
    }

    // Get the expected recording
    const expectedRecording = agentRecordings[currentAgentIndex];

    // Advance agent index
    state.agentReplayIndices.set(agentName, currentAgentIndex + 1);

    return expectedRecording;
  }

  /**
   * Verify and get the next LLM recording for the specific agent.
   */
  private verifyAndGetNextLlmRecordingForAgent(
    state: InvocationReplayState,
    agentName: string,
    llmRequest: LlmRequest
  ): LlmRecording {
    const currentAgentIndex = state.agentReplayIndices.get(agentName) || 0;
    const expectedRecording = this.getNextRecordingForAgent(state, agentName);

    // Verify this is an LLM recording
    if (!expectedRecording.llmRecording) {
      throw new ReplayVerificationError(
        `Expected LLM recording for agent '${agentName}' at index ` +
        `${currentAgentIndex}, but found tool recording`
      );
    }

    // Strict verification of LLM request
    this.verifyLlmRequestMatch(
      expectedRecording.llmRecording.llmRequest,
      llmRequest,
      agentName,
      currentAgentIndex
    );

    return expectedRecording.llmRecording;
  }

  /**
   * Verify and get the next tool recording for the specific agent.
   */
  private verifyAndGetNextToolRecordingForAgent(
    state: InvocationReplayState,
    agentName: string,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): ToolRecording {
    const currentAgentIndex = state.agentReplayIndices.get(agentName) || 0;
    const expectedRecording = this.getNextRecordingForAgent(state, agentName);

    // Verify this is a tool recording
    if (!expectedRecording.toolRecording) {
      throw new ReplayVerificationError(
        `Expected tool recording for agent '${agentName}' at index ` +
        `${currentAgentIndex}, but found LLM recording`
      );
    }

    // Strict verification of tool call
    this.verifyToolCallMatch(
      expectedRecording.toolRecording.toolCall,
      toolName,
      toolArgs,
      agentName,
      currentAgentIndex
    );

    return expectedRecording.toolRecording;
  }

  /**
   * Verify that the current LLM request matches the recorded one.
   */
  private verifyLlmRequestMatch(
    recordedRequest: LlmRequest | undefined,
    currentRequest: LlmRequest,
    agentName: string,
    agentIndex: number
  ): void {
    if (!recordedRequest) {
      throw new ReplayVerificationError(
        `No recorded LLM request for agent '${agentName}' at index ${agentIndex}`
      );
    }

    // Compare model
    if (recordedRequest.model !== currentRequest.model) {
      throw new ReplayVerificationError(
        `LLM model mismatch for agent '${agentName}' (index ${agentIndex}):\n` +
        `recorded: ${recordedRequest.model}\n` +
        `current: ${currentRequest.model}`
      );
    }

    // Compare contents (basic comparison - could be more sophisticated)
    const recordedContents = JSON.stringify(recordedRequest.contents);
    const currentContents = JSON.stringify(currentRequest.contents);
    if (recordedContents !== currentContents) {
      throw new ReplayVerificationError(
        `LLM contents mismatch for agent '${agentName}' (index ${agentIndex}):\n` +
        `recorded: ${recordedContents}\n` +
        `current: ${currentContents}`
      );
    }
  }

  /**
   * Verify that the current tool call matches the recorded one.
   */
  private verifyToolCallMatch(
    recordedCall: FunctionCall | undefined,
    toolName: string,
    toolArgs: Record<string, unknown>,
    agentName: string,
    agentIndex: number
  ): void {
    if (!recordedCall) {
      throw new ReplayVerificationError(
        `No recorded tool call for agent '${agentName}' at index ${agentIndex}`
      );
    }

    if (recordedCall.name !== toolName) {
      throw new ReplayVerificationError(
        `Tool name mismatch for agent '${agentName}' at index ${agentIndex}:\n` +
        `recorded: '${recordedCall.name}'\n` +
        `current: '${toolName}'`
      );
    }

    const recordedArgs = JSON.stringify(recordedCall.args);
    const currentArgs = JSON.stringify(toolArgs);
    if (recordedArgs !== currentArgs) {
      throw new ReplayVerificationError(
        `Tool args mismatch for agent '${agentName}' at index ${agentIndex}:\n` +
        `recorded: ${recordedArgs}\n` +
        `current: ${currentArgs}`
      );
    }
  }
}
