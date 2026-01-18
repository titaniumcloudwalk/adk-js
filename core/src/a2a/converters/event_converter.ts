/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Module containing utilities for conversion between ADK Events and A2A Events.
 */

import {v4 as uuidv4} from '../../utils/uuid.js';
import type {InvocationContext} from '../../agents/invocation_context.js';
import type {Event} from '../../events/event.js';
import {createEvent} from '../../events/event.js';
import {logger} from '../../utils/logger.js';
import {logA2aExperimentalWarning} from '../experimental.js';
import {
  type A2APart,
  type A2ADataPart,
  type A2ATextPart,
  type GenAIPartToA2APartConverter,
  A2A_DATA_PART_METADATA_IS_LONG_RUNNING_KEY,
  A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL,
  A2A_DATA_PART_METADATA_TYPE_KEY,
  convertGenaiPartToA2aPart,
  convertA2aPartToGenaiPart,
  type A2APartToGenAIPartConverter,
} from './part_converter.js';
import {
  type A2AMessage,
  type A2ATaskState,
} from './request_converter.js';
import {getAdkMetadataKey} from './utils.js';
import type {Content, Part as GenAIPart} from '@google/genai';

// Constants
const ARTIFACT_ID_SEPARATOR = '-';
const DEFAULT_ERROR_MESSAGE = 'An error occurred during processing';

// Request EUC function call name for auth_required state detection
const REQUEST_EUC_FUNCTION_CALL_NAME = 'adk_request_credential';

/**
 * A2A Event base interface.
 */
export interface A2AEvent {
  kind: string;
  taskId?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A2A TaskStatusUpdateEvent.
 */
export interface A2ATaskStatusUpdateEvent extends A2AEvent {
  kind: 'status_update';
  status: {
    state: A2ATaskState;
    message?: A2AMessage;
    timestamp: string;
  };
  final: boolean;
}

/**
 * A2A TaskArtifactUpdateEvent.
 */
export interface A2ATaskArtifactUpdateEvent extends A2AEvent {
  kind: 'artifact_update';
  artifact: {
    artifactId: string;
    parts: A2APart[];
    metadata?: Record<string, unknown>;
  };
  lastChunk: boolean;
}

/**
 * Type for converting ADK Event to A2A Events.
 */
export type AdkEventToA2AEventsConverter = (
  event: Event,
  invocationContext: InvocationContext,
  taskId: string | undefined,
  contextId: string | undefined,
  partConverter: GenAIPartToA2APartConverter
) => A2AEvent[];

/**
 * Safely serializes metadata values to string format.
 *
 * @param value - The value to serialize.
 * @returns String representation of the value.
 */
function serializeMetadataValue(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    if ('toJSON' in value && typeof value.toJSON === 'function') {
      try {
        return value.toJSON();
      } catch (e) {
        logger.warn(`Failed to serialize metadata value: ${e}`);
        return String(value);
      }
    }
  }
  return value;
}

/**
 * Gets the context metadata for the event.
 *
 * @param event - The ADK event to extract metadata from.
 * @param invocationContext - The invocation context containing session information.
 * @returns A dictionary containing the context metadata.
 */
function getContextMetadata(
  event: Event,
  invocationContext: InvocationContext
): Record<string, unknown> {
  if (!event) {
    throw new Error('Event cannot be undefined');
  }
  if (!invocationContext) {
    throw new Error('Invocation context cannot be undefined');
  }

  const metadata: Record<string, unknown> = {
    [getAdkMetadataKey('app_name')]: invocationContext.appName,
    [getAdkMetadataKey('user_id')]: invocationContext.userId,
    [getAdkMetadataKey('session_id')]: invocationContext.session.id,
    [getAdkMetadataKey('invocation_id')]: event.invocationId,
    [getAdkMetadataKey('author')]: event.author,
  };

  // Add optional metadata fields if present
  const optionalFields: Array<[string, unknown]> = [
    ['branch', event.branch],
    ['grounding_metadata', event.groundingMetadata],
    ['custom_metadata', event.customMetadata],
    ['usage_metadata', event.usageMetadata],
    ['error_code', event.errorCode],
    ['actions', event.actions],
  ];

  for (const [fieldName, fieldValue] of optionalFields) {
    if (fieldValue !== undefined && fieldValue !== null) {
      metadata[getAdkMetadataKey(fieldName)] = serializeMetadataValue(fieldValue);
    }
  }

  return metadata;
}

/**
 * Creates a unique artifact ID.
 *
 * @param appName - The application name.
 * @param userId - The user ID.
 * @param sessionId - The session ID.
 * @param filename - The artifact filename.
 * @param version - The artifact version.
 * @returns A unique artifact ID string.
 */
export function createArtifactId(
  appName: string,
  userId: string,
  sessionId: string,
  filename: string,
  version: number
): string {
  const components = [appName, userId, sessionId, filename, String(version)];
  return components.join(ARTIFACT_ID_SEPARATOR);
}

/**
 * Processes long-running tool metadata for an A2A part.
 *
 * @param a2aPart - The A2A part to potentially mark as long-running.
 * @param event - The ADK event containing long-running tool information.
 */
function processLongRunningTool(a2aPart: A2APart, event: Event): void {
  if (
    a2aPart.kind === 'data' &&
    event.longRunningToolIds &&
    event.longRunningToolIds.length > 0 &&
    a2aPart.metadata
  ) {
    const typeKey = getAdkMetadataKey(A2A_DATA_PART_METADATA_TYPE_KEY);
    const isLongRunningKey = getAdkMetadataKey(
      A2A_DATA_PART_METADATA_IS_LONG_RUNNING_KEY
    );

    if (a2aPart.metadata[typeKey] === A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL) {
      const functionCallId = (a2aPart as A2ADataPart).data.id as string;
      if (functionCallId && event.longRunningToolIds.includes(functionCallId)) {
        a2aPart.metadata[isLongRunningKey] = true;
      }
    }
  }
}

/**
 * Converts an A2A message to an ADK event.
 *
 * @param a2aMessage - The A2A message to convert. Must not be undefined.
 * @param author - The author of the event. Defaults to "a2a agent" if not provided.
 * @param invocationContext - The invocation context containing session information.
 * @param partConverter - The function to convert A2A part to GenAI part.
 * @returns An ADK Event object with converted content and long-running tool metadata.
 */
export function convertA2aMessageToEvent(
  a2aMessage: A2AMessage,
  author?: string,
  invocationContext?: InvocationContext,
  partConverter: A2APartToGenAIPartConverter = convertA2aPartToGenaiPart
): Event {
  logA2aExperimentalWarning();

  if (!a2aMessage) {
    throw new Error('A2A message cannot be undefined');
  }

  const invocationId = invocationContext?.invocationId ?? uuidv4();
  const eventAuthor = author ?? 'a2a agent';
  const branch = invocationContext?.branch;

  if (!a2aMessage.parts || a2aMessage.parts.length === 0) {
    logger.warn('A2A message has no parts, creating event with empty content');
    return createEvent({
      invocationId,
      author: eventAuthor,
      branch,
      content: {role: 'model', parts: []},
    });
  }

  const outputParts: GenAIPart[] = [];
  const longRunningToolIdsList: string[] = [];

  for (const a2aPart of a2aMessage.parts) {
    try {
      const parts = partConverter(a2aPart);
      if (!parts) {
        logger.warn(`Failed to convert A2A part, skipping: ${JSON.stringify(a2aPart)}`);
        continue;
      }

      const partsArray = Array.isArray(parts) ? parts : [parts];

      // Check for long-running tools
      const isLongRunningKey = getAdkMetadataKey(
        A2A_DATA_PART_METADATA_IS_LONG_RUNNING_KEY
      );
      if (
        a2aPart.metadata?.[isLongRunningKey] === true
      ) {
        for (const part of partsArray) {
          if (part.functionCall?.id) {
            longRunningToolIdsList.push(part.functionCall.id);
          }
        }
      }

      outputParts.push(...partsArray);
    } catch (e) {
      logger.error(`Failed to convert A2A part: ${JSON.stringify(a2aPart)}, error: ${e}`);
      // Continue processing other parts
    }
  }

  if (outputParts.length === 0) {
    logger.warn(`No parts could be converted from A2A message ${JSON.stringify(a2aMessage)}`);
  }

  return createEvent({
    invocationId,
    author: eventAuthor,
    branch,
    longRunningToolIds: longRunningToolIdsList.length > 0 ? longRunningToolIdsList : undefined,
    content: {
      role: 'model',
      parts: outputParts,
    } as Content,
  });
}

/**
 * Converts an ADK event to an A2A message.
 *
 * @param event - The ADK event to convert.
 * @param invocationContext - The invocation context.
 * @param role - The role of the message.
 * @param partConverter - The function to convert GenAI part to A2A part.
 * @returns An A2A Message if the event has content, undefined otherwise.
 */
export function convertEventToA2aMessage(
  event: Event,
  invocationContext: InvocationContext,
  role: 'user' | 'agent' = 'agent',
  partConverter: GenAIPartToA2APartConverter = convertGenaiPartToA2aPart
): A2AMessage | undefined {
  logA2aExperimentalWarning();

  if (!event) {
    throw new Error('Event cannot be undefined');
  }
  if (!invocationContext) {
    throw new Error('Invocation context cannot be undefined');
  }

  if (!event.content?.parts || event.content.parts.length === 0) {
    return undefined;
  }

  const outputParts: A2APart[] = [];
  for (const part of event.content.parts) {
    const a2aParts = partConverter(part);
    if (a2aParts) {
      const partsArray = Array.isArray(a2aParts) ? a2aParts : [a2aParts];
      for (const a2aPart of partsArray) {
        outputParts.push(a2aPart);
        processLongRunningTool(a2aPart, event);
      }
    }
  }

  if (outputParts.length > 0) {
    return {
      messageId: uuidv4(),
      role,
      parts: outputParts,
    };
  }

  return undefined;
}

/**
 * Creates a TaskStatusUpdateEvent for error scenarios.
 *
 * @param event - The ADK event containing error information.
 * @param invocationContext - The invocation context.
 * @param taskId - Optional task ID to use for generated events.
 * @param contextId - Optional Context ID to use for generated events.
 * @returns A TaskStatusUpdateEvent with FAILED state.
 */
function createErrorStatusEvent(
  event: Event,
  invocationContext: InvocationContext,
  taskId?: string,
  contextId?: string
): A2ATaskStatusUpdateEvent {
  const errorMessage = event.errorMessage ?? DEFAULT_ERROR_MESSAGE;

  // Get context metadata and add error code
  const eventMetadata = getContextMetadata(event, invocationContext);
  if (event.errorCode) {
    eventMetadata[getAdkMetadataKey('error_code')] = String(event.errorCode);
  }

  const errorTextPart: A2ATextPart = {kind: 'text', text: errorMessage};
  if (event.errorCode) {
    errorTextPart.metadata = {
      [getAdkMetadataKey('error_code')]: String(event.errorCode),
    };
  }

  return {
    kind: 'status_update',
    taskId,
    contextId,
    metadata: eventMetadata,
    status: {
      state: 'failed',
      message: {
        messageId: uuidv4(),
        role: 'agent',
        parts: [errorTextPart],
      },
      timestamp: new Date().toISOString(),
    },
    final: false,
  };
}

/**
 * Creates a TaskStatusUpdateEvent for running scenarios.
 *
 * @param message - The A2A message to include.
 * @param invocationContext - The invocation context.
 * @param event - The ADK event.
 * @param taskId - Optional task ID to use for generated events.
 * @param contextId - Optional Context ID to use for generated events.
 * @returns A TaskStatusUpdateEvent with appropriate state.
 */
function createStatusUpdateEvent(
  message: A2AMessage,
  invocationContext: InvocationContext,
  event: Event,
  taskId?: string,
  contextId?: string
): A2ATaskStatusUpdateEvent {
  let state: A2ATaskState = 'working';

  // Check for auth_required or input_required states based on long-running tool function calls
  const typeKey = getAdkMetadataKey(A2A_DATA_PART_METADATA_TYPE_KEY);
  const isLongRunningKey = getAdkMetadataKey(
    A2A_DATA_PART_METADATA_IS_LONG_RUNNING_KEY
  );

  for (const part of message.parts) {
    if (part.kind === 'data' && part.metadata) {
      const isFunctionCall =
        part.metadata[typeKey] === A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL;
      const isLongRunning = part.metadata[isLongRunningKey] === true;

      if (isFunctionCall && isLongRunning) {
        const functionName = (part as A2ADataPart).data.name as string;
        if (functionName === REQUEST_EUC_FUNCTION_CALL_NAME) {
          state = 'auth_required';
          break;
        } else {
          state = 'input_required';
        }
      }
    }
  }

  return {
    kind: 'status_update',
    taskId,
    contextId,
    metadata: getContextMetadata(event, invocationContext),
    status: {
      state,
      message,
      timestamp: new Date().toISOString(),
    },
    final: false,
  };
}

/**
 * Converts a GenAI event to a list of A2A events.
 *
 * @param event - The ADK event to convert.
 * @param invocationContext - The invocation context.
 * @param taskId - Optional task ID to use for generated events.
 * @param contextId - Optional Context ID to use for generated events.
 * @param partConverter - The function to convert GenAI part to A2A part.
 * @returns A list of A2A events representing the converted ADK event.
 */
export function convertEventToA2aEvents(
  event: Event,
  invocationContext: InvocationContext,
  taskId?: string,
  contextId?: string,
  partConverter: GenAIPartToA2APartConverter = convertGenaiPartToA2aPart
): A2AEvent[] {
  logA2aExperimentalWarning();

  if (!event) {
    throw new Error('Event cannot be undefined');
  }
  if (!invocationContext) {
    throw new Error('Invocation context cannot be undefined');
  }

  const a2aEvents: A2AEvent[] = [];

  try {
    // Handle error scenarios
    if (event.errorCode) {
      const errorEvent = createErrorStatusEvent(
        event,
        invocationContext,
        taskId,
        contextId
      );
      a2aEvents.push(errorEvent);
    }

    // Handle regular message content
    const message = convertEventToA2aMessage(
      event,
      invocationContext,
      'agent',
      partConverter
    );
    if (message) {
      const runningEvent = createStatusUpdateEvent(
        message,
        invocationContext,
        event,
        taskId,
        contextId
      );
      a2aEvents.push(runningEvent);
    }
  } catch (e) {
    logger.error(`Failed to convert event to A2A events: ${e}`);
    throw e;
  }

  return a2aEvents;
}
