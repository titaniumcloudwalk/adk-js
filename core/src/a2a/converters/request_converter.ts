/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Module containing utilities for converting A2A requests to ADK runner requests.
 */

import type {Content, Part as GenAIPart} from '@google/genai';
import type {RunConfig} from '../../agents/run_config.js';
import {logA2aExperimentalWarning} from '../experimental.js';
import type {A2APart, A2APartToGenAIPartConverter} from './part_converter.js';
import {convertA2aPartToGenaiPart} from './part_converter.js';

/**
 * A2A RequestContext type definition.
 * Matches the structure from @a2a-js/sdk/server.
 */
export interface A2ARequestContext {
  taskId: string;
  contextId?: string;
  message?: A2AMessage;
  metadata?: Record<string, unknown>;
  currentTask?: A2ATask;
  callContext?: {
    user?: {
      userName?: string;
    };
  };
}

/**
 * A2A Message type definition.
 */
export interface A2AMessage {
  messageId: string;
  role: 'user' | 'agent';
  parts: A2APart[];
  metadata?: Record<string, unknown>;
}

/**
 * A2A Task type definition.
 */
export interface A2ATask {
  id: string;
  status?: A2ATaskStatus;
  history?: A2AMessage[];
  artifacts?: A2AArtifact[];
}

/**
 * A2A TaskStatus type definition.
 */
export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
  timestamp?: string;
}

/**
 * A2A TaskState enum values.
 */
export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'completed'
  | 'failed'
  | 'auth_required'
  | 'input_required';

/**
 * A2A Artifact type definition.
 */
export interface A2AArtifact {
  artifactId: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
}

/**
 * Data model for arguments passed to the ADK runner.
 */
export interface AgentRunRequest {
  /** The user ID for the request */
  userId?: string;
  /** The session ID for the request */
  sessionId?: string;
  /** The invocation ID for the request */
  invocationId?: string;
  /** The new message content to process */
  newMessage?: Content;
  /** State delta to apply */
  stateDelta?: Record<string, unknown>;
  /** Run configuration */
  runConfig?: RunConfig;
}

/**
 * Type for converting A2A RequestContext to AgentRunRequest.
 */
export type A2ARequestToAgentRunRequestConverter = (
  request: A2ARequestContext,
  partConverter: A2APartToGenAIPartConverter
) => AgentRunRequest;

/**
 * Extracts user ID from the request context.
 *
 * @param request - The A2A request context.
 * @returns The user ID.
 */
function getUserId(request: A2ARequestContext): string {
  // Get user from call context if available (auth is enabled on a2a server)
  if (request.callContext?.user?.userName) {
    return request.callContext.user.userName;
  }

  // Get user from context id
  return `A2A_USER_${request.contextId ?? request.taskId}`;
}

/**
 * Converts an A2A RequestContext to an AgentRunRequest model.
 *
 * @param request - The incoming request context from the A2A server.
 * @param partConverter - A function to convert A2A content parts to GenAI parts.
 * @returns An AgentRunRequest object ready to be used as arguments for the ADK runner.
 * @throws Error if the request message is undefined.
 */
export function convertA2aRequestToAgentRunRequest(
  request: A2ARequestContext,
  partConverter: A2APartToGenAIPartConverter = convertA2aPartToGenaiPart
): AgentRunRequest {
  logA2aExperimentalWarning();

  if (!request.message) {
    throw new Error('Request message cannot be undefined');
  }

  const customMetadata: Record<string, unknown> = {};
  if (request.metadata) {
    customMetadata.a2a_metadata = request.metadata;
  }

  const outputParts: GenAIPart[] = [];
  for (const a2aPart of request.message.parts) {
    const genaiParts = partConverter(a2aPart);
    if (genaiParts) {
      if (Array.isArray(genaiParts)) {
        outputParts.push(...genaiParts);
      } else {
        outputParts.push(genaiParts);
      }
    }
  }

  return {
    userId: getUserId(request),
    sessionId: request.contextId,
    newMessage: {
      role: 'user',
      parts: outputParts,
    },
    runConfig: {
      customMetadata:
        Object.keys(customMetadata).length > 0 ? customMetadata : undefined,
    },
  };
}
