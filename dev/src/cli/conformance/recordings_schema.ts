/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TypeScript interfaces for ADK conformance test recordings.
 *
 * These schemas mirror the Python Pydantic models in recordings_schema.py
 * and are used to capture and replay LLM and tool interactions.
 */

import {FunctionCall, FunctionResponse} from '@google/genai';

import {LlmRequest} from '@google/adk';
import {LlmResponse} from '@google/adk';

/**
 * Paired LLM request and response.
 */
export interface LlmRecording {
  /** The LLM request sent to the model. */
  llmRequest?: LlmRequest;
  /** The LLM response received from the model. */
  llmResponse?: LlmResponse;
}

/**
 * Paired tool call and response.
 */
export interface ToolRecording {
  /** The tool call (function call). */
  toolCall?: FunctionCall;
  /** The tool response (function response). */
  toolResponse?: FunctionResponse;
}

/**
 * Single interaction recording, ordered by request timestamp.
 */
export interface Recording {
  /** Index of the user message this recording belongs to (0-based). */
  userMessageIndex: number;
  /** Name of the agent. */
  agentName: string;
  /** LLM request-response pair (mutually exclusive with toolRecording). */
  llmRecording?: LlmRecording;
  /** Tool call-response pair (mutually exclusive with llmRecording). */
  toolRecording?: ToolRecording;
}

/**
 * All recordings in chronological order.
 */
export interface Recordings {
  /** Chronological list of all recordings. */
  recordings: Recording[];
}

/**
 * Creates an empty Recordings object.
 */
export function createEmptyRecordings(): Recordings {
  return {recordings: []};
}

/**
 * Converts a Recording to a YAML-compatible object with snake_case keys.
 */
export function recordingToYaml(recording: Recording): Record<string, unknown> {
  const result: Record<string, unknown> = {
    user_message_index: recording.userMessageIndex,
    agent_name: recording.agentName,
  };

  if (recording.llmRecording) {
    result.llm_recording = {
      llm_request: recording.llmRecording.llmRequest,
      llm_response: recording.llmRecording.llmResponse,
    };
  }

  if (recording.toolRecording) {
    result.tool_recording = {
      tool_call: recording.toolRecording.toolCall,
      tool_response: recording.toolRecording.toolResponse,
    };
  }

  return result;
}

/**
 * Converts a YAML object to a Recording.
 */
export function yamlToRecording(data: Record<string, unknown>): Recording {
  const recording: Recording = {
    userMessageIndex: data.user_message_index as number,
    agentName: data.agent_name as string,
  };

  if (data.llm_recording) {
    const llmData = data.llm_recording as Record<string, unknown>;
    recording.llmRecording = {
      llmRequest: llmData.llm_request as LlmRequest | undefined,
      llmResponse: llmData.llm_response as LlmResponse | undefined,
    };
  }

  if (data.tool_recording) {
    const toolData = data.tool_recording as Record<string, unknown>;
    recording.toolRecording = {
      toolCall: toolData.tool_call as FunctionCall | undefined,
      toolResponse: toolData.tool_response as FunctionResponse | undefined,
    };
  }

  return recording;
}

/**
 * Converts a Recordings object to a YAML-compatible object.
 */
export function recordingsToYaml(recordings: Recordings): Record<string, unknown> {
  return {
    recordings: recordings.recordings.map(recordingToYaml),
  };
}

/**
 * Converts a YAML object to a Recordings object.
 */
export function yamlToRecordings(data: Record<string, unknown>): Recordings {
  const recordingsArray = data.recordings as Record<string, unknown>[];
  return {
    recordings: recordingsArray ? recordingsArray.map(yamlToRecording) : [],
  };
}
