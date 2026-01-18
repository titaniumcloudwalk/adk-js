/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recording plugin for ADK conformance testing.
 *
 * This plugin captures all LLM requests/responses and tool calls/responses
 * during agent execution and saves them to YAML files for replay testing.
 */

import * as fs from 'fs';
import * as path from 'path';

import {Content, FunctionCall, FunctionResponse} from '@google/genai';
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
  createEmptyRecordings,
  LlmRecording,
  Recording,
  Recordings,
  recordingsToYaml,
  ToolRecording,
  yamlToRecordings,
} from './recordings_schema.js';

/**
 * Per-invocation recording state to isolate concurrent runs.
 */
interface InvocationRecordingState {
  /** Path to the test case directory. */
  testCasePath: string;
  /** Index of the user message being recorded. */
  userMessageIndex: number;
  /** The recordings collected so far. */
  records: Recordings;
  /** Pending LLM recordings keyed by agent_name. */
  pendingLlmRecordings: Map<string, Recording>;
  /** Pending tool recordings keyed by function_call_id. */
  pendingToolRecordings: Map<string, Recording>;
  /** Ordered list of pending recordings to maintain chronological order. */
  pendingRecordingsOrder: Recording[];
}

/**
 * Configuration for recordings passed through session state.
 */
interface RecordingsConfig {
  /** Directory path for the test case. */
  dir: string;
  /** Index of the user message (0-based). */
  user_message_index: number;
}

/**
 * Plugin for recording ADK agent interactions for conformance testing.
 */
export class RecordingsPlugin extends BasePlugin {
  /**
   * Track recording state per invocation to support concurrent runs.
   * Key: invocationId -> InvocationRecordingState
   */
  private invocationStates: Map<string, InvocationRecordingState> = new Map();

  constructor(name: string = 'adk_recordings') {
    super(name);
  }

  /**
   * Create fresh per-invocation recording state when enabled.
   */
  override async beforeRunCallback({
    invocationContext,
  }: {
    invocationContext: InvocationContext;
  }): Promise<Content | undefined> {
    const ctx = new CallbackContext({invocationContext});
    if (this.isRecordModeOn(ctx)) {
      this.createInvocationState(ctx);
    }
    return undefined;
  }

  /**
   * Create pending LLM recording awaiting response.
   */
  override async beforeModelCallback({
    callbackContext,
    llmRequest,
  }: {
    callbackContext: CallbackContext;
    llmRequest: LlmRequest;
  }): Promise<LlmResponse | undefined> {
    if (!this.isRecordModeOn(callbackContext)) {
      return undefined;
    }

    const state = this.getInvocationState(callbackContext);
    if (!state) {
      throw new Error('Recording state not initialized. Ensure before_run created it.');
    }

    const pendingRecording: Recording = {
      userMessageIndex: state.userMessageIndex,
      agentName: callbackContext.agentName,
      llmRecording: {
        llmRequest: llmRequest,
        llmResponse: undefined,
      },
    };

    // Store in both lookup dict and chronological list
    state.pendingLlmRecordings.set(callbackContext.agentName, pendingRecording);
    state.pendingRecordingsOrder.push(pendingRecording);

    return undefined; // Continue LLM execution
  }

  /**
   * Complete pending LLM recording with response.
   */
  override async afterModelCallback({
    callbackContext,
    llmResponse,
  }: {
    callbackContext: CallbackContext;
    llmResponse: LlmResponse;
  }): Promise<LlmResponse | undefined> {
    if (!this.isRecordModeOn(callbackContext)) {
      return undefined;
    }

    const state = this.getInvocationState(callbackContext);
    if (!state) {
      throw new Error('Recording state not initialized. Ensure before_run created it.');
    }

    const agentName = callbackContext.agentName;
    const pendingRecording = state.pendingLlmRecordings.get(agentName);

    if (pendingRecording && pendingRecording.llmRecording) {
      pendingRecording.llmRecording.llmResponse = llmResponse;
      state.pendingLlmRecordings.delete(agentName);
    }

    return undefined; // Continue LLM execution
  }

  /**
   * Create pending tool recording.
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
    if (!this.isRecordModeOn(toolContext)) {
      return undefined;
    }

    const functionCallId = toolContext.functionCallId;
    if (!functionCallId) {
      console.warn(`No function_call_id provided for tool ${tool.name}, skipping recording`);
      return undefined;
    }

    const state = this.getInvocationState(toolContext);
    if (!state) {
      throw new Error('Recording state not initialized. Ensure before_run created it.');
    }

    const pendingRecording: Recording = {
      userMessageIndex: state.userMessageIndex,
      agentName: toolContext.agentName,
      toolRecording: {
        toolCall: {
          id: functionCallId,
          name: tool.name,
          args: toolArgs,
        } as FunctionCall,
        toolResponse: undefined,
      },
    };

    // Store in both lookup dict and chronological list
    state.pendingToolRecordings.set(functionCallId, pendingRecording);
    state.pendingRecordingsOrder.push(pendingRecording);

    return undefined; // Continue tool execution
  }

  /**
   * Complete pending tool recording with response.
   */
  override async afterToolCallback({
    tool,
    toolArgs,
    toolContext,
    result,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
    result: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined> {
    if (!this.isRecordModeOn(toolContext)) {
      return undefined;
    }

    const functionCallId = toolContext.functionCallId;
    if (!functionCallId) {
      console.warn(`No function_call_id provided for tool ${tool.name} result, skipping completion`);
      return undefined;
    }

    const state = this.getInvocationState(toolContext);
    if (!state) {
      throw new Error('Recording state not initialized. Ensure before_run created it.');
    }

    const pendingRecording = state.pendingToolRecordings.get(functionCallId);
    if (pendingRecording && pendingRecording.toolRecording) {
      pendingRecording.toolRecording.toolResponse = {
        id: functionCallId,
        name: tool.name,
        response: typeof result === 'object' ? result : {result: result},
      } as FunctionResponse;
      state.pendingToolRecordings.delete(functionCallId);
    }

    return undefined; // Continue tool execution
  }

  /**
   * Handle tool error callback with state guard.
   */
  override async onToolErrorCallback({
    tool,
    toolArgs,
    toolContext,
    error,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
    error: Error;
  }): Promise<Record<string, unknown> | undefined> {
    if (!this.isRecordModeOn(toolContext)) {
      return undefined;
    }

    const state = this.getInvocationState(toolContext);
    if (!state) {
      throw new Error('Recording state not initialized. Ensure before_run created it.');
    }

    // Recording schema does not yet capture errors; we only validate state
    console.debug(
      `Tool error occurred for agent ${toolContext.agentName}: ` +
      `tool=${tool.name}, id=${toolContext.functionCallId}, error=${error.message}`
    );
    return undefined;
  }

  /**
   * Finalize and persist recordings, then clean per-invocation state.
   */
  override async afterRunCallback({
    invocationContext,
  }: {
    invocationContext: InvocationContext;
  }): Promise<void> {
    const ctx = new CallbackContext({invocationContext});
    if (!this.isRecordModeOn(ctx)) {
      return;
    }

    const state = this.getInvocationState(ctx);
    if (!state) {
      throw new Error('Recording state not initialized. Ensure before_run created it.');
    }

    try {
      // Add all completed recordings to the main records
      for (const pending of state.pendingRecordingsOrder) {
        if (pending.llmRecording) {
          if (pending.llmRecording.llmResponse !== undefined) {
            state.records.recordings.push(pending);
          } else {
            console.warn(`Incomplete LLM recording for agent ${pending.agentName}, skipping`);
          }
        } else if (pending.toolRecording) {
          if (pending.toolRecording.toolResponse !== undefined) {
            state.records.recordings.push(pending);
          } else {
            console.warn(`Incomplete tool recording for agent ${pending.agentName}, skipping`);
          }
        }
      }

      // Write recordings to YAML file
      const recordingsFile = path.join(state.testCasePath, 'generated-recordings.yaml');
      const yamlContent = yaml.dump(recordingsToYaml(state.records));
      fs.writeFileSync(recordingsFile, yamlContent, 'utf-8');
      console.log(`Saved ${state.records.recordings.length} recordings to ${recordingsFile}`);
    } catch (error) {
      console.error(`Failed to save interactions: ${error}`);
    } finally {
      // Cleanup per-invocation recording state
      this.invocationStates.delete(ctx.invocationId);
    }
  }

  /**
   * Check if recording mode is enabled for this invocation.
   */
  private isRecordModeOn(callbackContext: CallbackContext | ToolContext): boolean {
    const sessionState = callbackContext.state;
    const config = sessionState.get('_adk_recordings_config') as RecordingsConfig | undefined;
    if (!config) {
      return false;
    }
    return Boolean(config.dir) && config.user_message_index !== undefined;
  }

  /**
   * Get existing recording state for this invocation.
   */
  private getInvocationState(
    callbackContext: CallbackContext | ToolContext
  ): InvocationRecordingState | undefined {
    const invocationId = callbackContext.invocationId;
    return this.invocationStates.get(invocationId);
  }

  /**
   * Create and store recording state for this invocation.
   */
  private createInvocationState(callbackContext: CallbackContext): InvocationRecordingState {
    const invocationId = callbackContext.invocationId;
    const sessionState = callbackContext.state;

    const config = sessionState.get('_adk_recordings_config') as RecordingsConfig | undefined;
    const caseDir = config?.dir;
    const msgIndex = config?.user_message_index;

    if (!caseDir || msgIndex === undefined) {
      throw new Error('Recording parameters are missing from session state');
    }

    // Load or create recordings
    const recordingsFile = path.join(caseDir, 'generated-recordings.yaml');
    let records: Recordings;

    if (fs.existsSync(recordingsFile)) {
      try {
        const fileContent = fs.readFileSync(recordingsFile, 'utf-8');
        const recordingsData = yaml.load(fileContent) as Record<string, unknown>;
        records = yamlToRecordings(recordingsData);
      } catch (error) {
        console.error(`Failed to load recordings from ${recordingsFile}: ${error}`);
        records = createEmptyRecordings();
      }
    } else {
      records = createEmptyRecordings();
    }

    // Create and store invocation state
    const state: InvocationRecordingState = {
      testCasePath: caseDir,
      userMessageIndex: msgIndex,
      records: records,
      pendingLlmRecordings: new Map(),
      pendingToolRecordings: new Map(),
      pendingRecordingsOrder: [],
    };
    this.invocationStates.set(invocationId, state);

    return state;
  }
}
