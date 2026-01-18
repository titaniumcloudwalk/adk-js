/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Utility functions for structured A2A request and response logging.
 */

import type {A2APart, A2ATextPart, A2ADataPart} from '../converters/part_converter.js';

// Constants
const NEW_LINE = '\n';
const EXCLUDED_PART_FIELD = new Set(['file.bytes']);

/**
 * A2A Message interface for logging purposes.
 */
export interface A2AMessageForLog {
  message_id?: string;
  messageId?: string;
  role?: string;
  task_id?: string;
  taskId?: string;
  context_id?: string;
  contextId?: string;
  parts?: A2APart[];
  metadata?: Record<string, unknown>;
}

/**
 * A2A Task Status for logging purposes.
 */
export interface A2ATaskStatusForLog {
  state?: string;
  message?: A2AMessageForLog;
  timestamp?: string;
}

/**
 * A2A Task interface for logging purposes.
 */
export interface A2ATaskForLog {
  id?: string;
  context_id?: string;
  contextId?: string;
  status?: A2ATaskStatusForLog;
  history?: A2AMessageForLog[];
  artifacts?: unknown[];
  metadata?: Record<string, unknown>;
}

/**
 * A2A Client Event (Task, UpdateEvent) tuple for logging purposes.
 */
export type A2AClientEventForLog = [A2ATaskForLog, unknown];

/**
 * Response type that can be either a Task tuple or a Message.
 */
export type A2AResponseForLog = A2AClientEventForLog | A2AMessageForLog;

/**
 * Type guard to check if a part is a TextPart.
 */
function isA2aTextPart(part: A2APart): part is A2ATextPart {
  return part.kind === 'text';
}

/**
 * Type guard to check if a part is a DataPart.
 */
function isA2aDataPart(part: A2APart): part is A2ADataPart {
  return part.kind === 'data';
}

/**
 * Type guard to check if an object is an A2A Task.
 */
function isA2aTask(obj: unknown): obj is A2ATaskForLog {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'status' in obj &&
    (('id' in obj) || ('context_id' in obj) || ('contextId' in obj))
  );
}

/**
 * Type guard to check if a response is an A2A Client Event (Task, UpdateEvent) tuple.
 */
function isA2aClientEvent(obj: unknown): obj is A2AClientEventForLog {
  return (
    Array.isArray(obj) &&
    obj.length === 2 &&
    isA2aTask(obj[0])
  );
}

/**
 * Type guard to check if an object is an A2A Message.
 */
function isA2aMessage(obj: unknown): obj is A2AMessageForLog {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'role' in obj &&
    (('message_id' in obj) || ('messageId' in obj) || ('parts' in obj))
  );
}

/**
 * Safely serializes a value, handling circular references and large objects.
 */
function safeSerialize(value: unknown, indent: number = 2): string {
  try {
    return JSON.stringify(value, null, indent);
  } catch {
    return '<unable to serialize>';
  }
}

/**
 * Builds a log representation of an A2A message part.
 *
 * @param part - The A2A message part to log.
 * @returns A string representation of the part.
 */
export function buildMessagePartLog(part: A2APart): string {
  let partContent = '';

  if (isA2aTextPart(part)) {
    const text = part.text;
    const truncated = text.length > 100 ? text.slice(0, 100) + '...' : text;
    partContent = `TextPart: ${truncated}`;
  } else if (isA2aDataPart(part)) {
    // For data parts, show the data keys but exclude large values
    const dataSummary: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(part.data)) {
      if (
        (typeof v === 'object' && v !== null) ||
        (Array.isArray(v) && JSON.stringify(v).length > 100)
      ) {
        const typeName = Array.isArray(v) ? 'Array' : typeof v;
        dataSummary[k] = `<${typeName}>`;
      } else {
        dataSummary[k] = v;
      }
    }
    partContent = `DataPart: ${safeSerialize(dataSummary)}`;
  } else if (part.kind === 'file') {
    // For file parts, exclude bytes to avoid large logs
    const fileInfo = {
      kind: part.kind,
      file: {
        ...('file' in part ? part.file : {}),
        bytes: '<bytes excluded>',
      },
    };
    partContent = `FilePart: ${safeSerialize(fileInfo)}`;
  } else {
    partContent = `${(part as {kind: string}).kind}: ${safeSerialize(part)}`;
  }

  // Add part metadata if it exists
  if (part.metadata && Object.keys(part.metadata).length > 0) {
    const metadataStr = safeSerialize(part.metadata).replace(/\n/g, '\n    ');
    partContent += `\n    Part Metadata: ${metadataStr}`;
  }

  return partContent;
}

/**
 * Builds a structured log representation of an A2A request.
 *
 * @param req - The A2A Message request to log.
 * @returns A formatted string representation of the request.
 */
export function buildA2aRequestLog(req: A2AMessageForLog): string {
  // Message parts logs
  const messagePartsLogs: string[] = [];
  if (req.parts) {
    for (let i = 0; i < req.parts.length; i++) {
      const partLog = buildMessagePartLog(req.parts[i]);
      // Replace any internal newlines with indented newlines to maintain formatting
      const partLogFormatted = partLog.replace(/\n/g, '\n  ');
      messagePartsLogs.push(`Part ${i}: ${partLogFormatted}`);
    }
  }

  // Build message metadata section
  let messageMetadataSection = '';
  if (req.metadata && Object.keys(req.metadata).length > 0) {
    const metadataFormatted = safeSerialize(req.metadata).replace(/\n/g, '\n  ');
    messageMetadataSection = `\n  Metadata:\n  ${metadataFormatted}`;
  }

  // Get message ID (supporting both snake_case and camelCase)
  const messageId = req.message_id ?? req.messageId ?? 'N/A';
  const taskId = req.task_id ?? req.taskId ?? 'N/A';
  const contextId = req.context_id ?? req.contextId ?? 'N/A';

  return `
A2A Send Message Request:
-----------------------------------------------------------
Message:
  ID: ${messageId}
  Role: ${req.role ?? 'N/A'}
  Task ID: ${taskId}
  Context ID: ${contextId}${messageMetadataSection}
-----------------------------------------------------------
Message Parts:
${messagePartsLogs.length > 0 ? messagePartsLogs.join(NEW_LINE) : 'No parts'}
-----------------------------------------------------------
`;
}

/**
 * Builds a structured log representation of an A2A response.
 *
 * @param resp - The A2A response to log.
 * @returns A formatted string representation of the response.
 */
export function buildA2aResponseLog(resp: A2AResponseForLog): string {
  // Handle success responses
  let result = resp;
  let resultType = 'Unknown';

  // Build result details based on type
  const resultDetails: string[] = [];

  if (isA2aClientEvent(result)) {
    resultType = 'ClientEvent';
    const task = result[0];
    resultDetails.push(
      `Task ID: ${task.id ?? 'N/A'}`,
      `Context ID: ${task.context_id ?? task.contextId ?? 'N/A'}`,
      `Status State: ${task.status?.state ?? 'N/A'}`,
      `Status Timestamp: ${task.status?.timestamp ?? 'N/A'}`,
      `History Length: ${task.history?.length ?? 0}`,
      `Artifacts Count: ${task.artifacts?.length ?? 0}`
    );

    // Add task metadata if it exists
    if (task.metadata && Object.keys(task.metadata).length > 0) {
      resultDetails.push('Task Metadata:');
      const metadataFormatted = safeSerialize(task.metadata).replace(/\n/g, '\n  ');
      resultDetails.push(`  ${metadataFormatted}`);
    }

    // Build status message section
    let statusMessageSection = 'None';
    if (task.status?.message) {
      const statusMsg = task.status.message;
      const statusPartsLogs: string[] = [];
      if (statusMsg.parts) {
        for (let i = 0; i < statusMsg.parts.length; i++) {
          const partLog = buildMessagePartLog(statusMsg.parts[i]);
          const partLogFormatted = partLog.replace(/\n/g, '\n  ');
          statusPartsLogs.push(`Part ${i}: ${partLogFormatted}`);
        }
      }

      let statusMetadataSection = '';
      if (statusMsg.metadata && Object.keys(statusMsg.metadata).length > 0) {
        statusMetadataSection = `\nMetadata:\n${safeSerialize(statusMsg.metadata)}`;
      }

      const statusMsgId = statusMsg.message_id ?? statusMsg.messageId ?? 'N/A';
      const statusTaskId = statusMsg.task_id ?? statusMsg.taskId ?? 'N/A';
      const statusContextId = statusMsg.context_id ?? statusMsg.contextId ?? 'N/A';

      statusMessageSection = `ID: ${statusMsgId}
Role: ${statusMsg.role ?? 'N/A'}
Task ID: ${statusTaskId}
Context ID: ${statusContextId}
Message Parts:
${statusPartsLogs.length > 0 ? statusPartsLogs.join(NEW_LINE) : 'No parts'}${statusMetadataSection}`;
    }

    // Build history section
    let historySection = 'No history';
    if (task.history && task.history.length > 0) {
      const historyLogs: string[] = [];
      for (let i = 0; i < task.history.length; i++) {
        const message = task.history[i];
        const messagePartsLogs: string[] = [];
        if (message.parts) {
          for (let j = 0; j < message.parts.length; j++) {
            const partLog = buildMessagePartLog(message.parts[j]);
            const partLogFormatted = partLog.replace(/\n/g, '\n    ');
            messagePartsLogs.push(`  Part ${j}: ${partLogFormatted}`);
          }
        }

        let messageMetadataSection = '';
        if (message.metadata && Object.keys(message.metadata).length > 0) {
          const metadataFormatted = safeSerialize(message.metadata).replace(/\n/g, '\n  ');
          messageMetadataSection = `\n  Metadata:\n  ${metadataFormatted}`;
        }

        const msgId = message.message_id ?? message.messageId ?? 'N/A';
        const msgTaskId = message.task_id ?? message.taskId ?? 'N/A';
        const msgContextId = message.context_id ?? message.contextId ?? 'N/A';

        historyLogs.push(
          `Message ${i + 1}:
  ID: ${msgId}
  Role: ${message.role ?? 'N/A'}
  Task ID: ${msgTaskId}
  Context ID: ${msgContextId}
  Message Parts:
${messagePartsLogs.length > 0 ? messagePartsLogs.join(NEW_LINE) : '  No parts'}${messageMetadataSection}`
        );
      }
      historySection = historyLogs.join(NEW_LINE);
    }

    return `
A2A Response:
-----------------------------------------------------------
Type: SUCCESS
Result Type: ${resultType}
-----------------------------------------------------------
Result Details:
${resultDetails.join(NEW_LINE)}
-----------------------------------------------------------
Status Message:
${statusMessageSection}
-----------------------------------------------------------
History:
${historySection}
-----------------------------------------------------------
`;
  } else if (isA2aMessage(result)) {
    resultType = 'Message';
    const msgId = result.message_id ?? result.messageId ?? 'N/A';
    const taskId = result.task_id ?? result.taskId ?? 'N/A';
    const contextId = result.context_id ?? result.contextId ?? 'N/A';

    resultDetails.push(
      `Message ID: ${msgId}`,
      `Role: ${result.role ?? 'N/A'}`,
      `Task ID: ${taskId}`,
      `Context ID: ${contextId}`
    );

    // Add message parts
    if (result.parts && result.parts.length > 0) {
      resultDetails.push('Message Parts:');
      for (let i = 0; i < result.parts.length; i++) {
        const partLog = buildMessagePartLog(result.parts[i]);
        const partLogFormatted = partLog.replace(/\n/g, '\n    ');
        resultDetails.push(`  Part ${i}: ${partLogFormatted}`);
      }
    }

    // Add metadata if it exists
    if (result.metadata && Object.keys(result.metadata).length > 0) {
      resultDetails.push('Metadata:');
      const metadataFormatted = safeSerialize(result.metadata).replace(/\n/g, '\n  ');
      resultDetails.push(`  ${metadataFormatted}`);
    }
  } else {
    // Handle other result types by showing their JSON representation
    resultType = 'Unknown';
    try {
      const resultJson = safeSerialize(result);
      resultDetails.push(`JSON Data: ${resultJson}`);
    } catch {
      resultDetails.push('JSON Data: <unable to serialize>');
    }
  }

  return `
A2A Response:
-----------------------------------------------------------
Type: SUCCESS
Result Type: ${resultType}
-----------------------------------------------------------
Result Details:
${resultDetails.join(NEW_LINE)}
-----------------------------------------------------------
`;
}
