/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Validation logic for conformance test replay mode.
 *
 * Provides functions to compare events and sessions, generating
 * diff-based error messages for conformance failures.
 */

import {Event, Session} from '@google/adk';

/**
 * Result of comparing two objects during conformance testing.
 */
export interface ComparisonResult {
  /** Whether the comparison was successful. */
  success: boolean;
  /** Error message if comparison failed. */
  errorMessage?: string;
}

/**
 * Fields to exclude when comparing events (these vary between runs).
 */
const EVENT_EXCLUDED_FIELDS = new Set([
  'id',
  'timestamp',
  'invocationId',
  'longRunningToolIds',
]);

/**
 * State fields to exclude when comparing sessions.
 */
const SESSION_STATE_EXCLUDED_FIELDS = new Set([
  '_adk_recordings_config',
  '_adk_replay_config',
]);

/**
 * Generate a generic mismatch error message.
 */
function generateMismatchMessage(
  context: string,
  actualValue: string,
  recordedValue: string
): string {
  return `${context} mismatch - \nActual: \n${actualValue} \nRecorded: \n${recordedValue}`;
}

/**
 * Generate a diff-based error message for comparison failures.
 */
function generateDiffMessage(
  context: string,
  actualDict: Record<string, unknown>,
  recordedDict: Record<string, unknown>
): string {
  const actualJson = JSON.stringify(actualDict, null, 2);
  const recordedJson = JSON.stringify(recordedDict, null, 2);

  // Simple line-by-line diff
  const actualLines = actualJson.split('\n');
  const recordedLines = recordedJson.split('\n');
  const diffLines: string[] = [];

  diffLines.push(`--- recorded ${context}`);
  diffLines.push(`+++ actual ${context}`);

  const maxLen = Math.max(actualLines.length, recordedLines.length);
  for (let i = 0; i < maxLen; i++) {
    const actualLine = actualLines[i] ?? '';
    const recordedLine = recordedLines[i] ?? '';
    if (actualLine !== recordedLine) {
      if (recordedLine) {
        diffLines.push(`- ${recordedLine}`);
      }
      if (actualLine) {
        diffLines.push(`+ ${actualLine}`);
      }
    }
  }

  if (diffLines.length > 2) {
    return `${context} mismatch:\n${diffLines.join('\n')}`;
  } else {
    return generateMismatchMessage(context, actualJson, recordedJson);
  }
}

/**
 * Remove excluded fields from an event for comparison.
 */
function prepareEventForComparison(event: Event): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(event)) {
    if (EVENT_EXCLUDED_FIELDS.has(key)) {
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }

    if (key === 'content' && typeof value === 'object') {
      // Deep copy content but remove dynamic fields in parts
      result[key] = prepareContentForComparison(value as Record<string, unknown>);
    } else if (key === 'actions' && typeof value === 'object') {
      // Deep copy actions but remove dynamic state fields
      result[key] = prepareActionsForComparison(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Prepare content for comparison by removing dynamic fields.
 */
function prepareContentForComparison(content: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {...content};

  if (Array.isArray(result.parts)) {
    result.parts = result.parts.map((part: Record<string, unknown>) => {
      const cleanPart: Record<string, unknown> = {...part};
      // Remove dynamic fields from function calls/responses
      if (cleanPart.functionCall && typeof cleanPart.functionCall === 'object') {
        const fc = {...(cleanPart.functionCall as Record<string, unknown>)};
        delete fc.id;
        cleanPart.functionCall = fc;
      }
      if (cleanPart.functionResponse && typeof cleanPart.functionResponse === 'object') {
        const fr = {...(cleanPart.functionResponse as Record<string, unknown>)};
        delete fr.id;
        cleanPart.functionResponse = fr;
      }
      // Remove thought signatures which may vary
      delete cleanPart.thoughtSignature;
      return cleanPart;
    });
  }

  return result;
}

/**
 * Prepare actions for comparison by removing dynamic fields.
 */
function prepareActionsForComparison(actions: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {...actions};

  // Remove dynamic state fields
  if (result.stateDelta && typeof result.stateDelta === 'object') {
    const stateDelta = {...(result.stateDelta as Record<string, unknown>)};
    for (const field of SESSION_STATE_EXCLUDED_FIELDS) {
      delete stateDelta[field];
    }
    if (Object.keys(stateDelta).length > 0) {
      result.stateDelta = stateDelta;
    } else {
      delete result.stateDelta;
    }
  }

  // Remove fields that may vary per run
  delete result.requestedAuthConfigs;
  delete result.requestedToolConfirmations;

  return result;
}

/**
 * Compare a single actual event with a recorded event.
 */
export function compareEvent(
  actualEvent: Event,
  recordedEvent: Event,
  index: number
): ComparisonResult {
  const actualDict = prepareEventForComparison(actualEvent);
  const recordedDict = prepareEventForComparison(recordedEvent);

  const actualJson = JSON.stringify(actualDict, Object.keys(actualDict).sort());
  const recordedJson = JSON.stringify(recordedDict, Object.keys(recordedDict).sort());

  if (actualJson !== recordedJson) {
    return {
      success: false,
      errorMessage: generateDiffMessage(`event ${index}`, actualDict, recordedDict),
    };
  }

  return {success: true};
}

/**
 * Compare actual events with recorded events.
 */
export function compareEvents(
  actualEvents: Event[],
  recordedEvents: Event[]
): ComparisonResult {
  if (actualEvents.length !== recordedEvents.length) {
    return {
      success: false,
      errorMessage: generateMismatchMessage(
        'Event count',
        String(actualEvents.length),
        String(recordedEvents.length)
      ),
    };
  }

  for (let i = 0; i < actualEvents.length; i++) {
    const result = compareEvent(actualEvents[i], recordedEvents[i], i);
    if (!result.success) {
      return result;
    }
  }

  return {success: true};
}

/**
 * Prepare session for comparison by removing dynamic fields.
 */
function prepareSessionForComparison(session: Session): Record<string, unknown> {
  const result: Record<string, unknown> = {
    appName: session.appName,
    userId: session.userId,
  };

  // Filter state to remove config fields
  if (session.state && Object.keys(session.state).length > 0) {
    const filteredState: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(session.state)) {
      if (!SESSION_STATE_EXCLUDED_FIELDS.has(key)) {
        filteredState[key] = value;
      }
    }
    if (Object.keys(filteredState).length > 0) {
      result.state = filteredState;
    }
  }

  // Events comparison handled separately
  return result;
}

/**
 * Compare actual session with recorded session.
 */
export function compareSession(
  actualSession: Session,
  recordedSession: Session
): ComparisonResult {
  const actualDict = prepareSessionForComparison(actualSession);
  const recordedDict = prepareSessionForComparison(recordedSession);

  const actualJson = JSON.stringify(actualDict, Object.keys(actualDict).sort());
  const recordedJson = JSON.stringify(recordedDict, Object.keys(recordedDict).sort());

  if (actualJson !== recordedJson) {
    return {
      success: false,
      errorMessage: generateDiffMessage('session', actualDict, recordedDict),
    };
  }

  return {success: true};
}
