/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content} from '@google/genai';

import {ToolConfirmation} from '../tools/tool_confirmation.js';

// TODO: b/425992518 - Replace 'any' with a proper AuthConfig.
type AuthConfig = any;

/**
 * Represents compacted event data from a sliding window of events.
 *
 * When events are compacted, this structure holds the summarized content
 * along with the timestamp range of the original events.
 */
export interface EventCompaction {
  /**
   * The start timestamp of the compacted events, in milliseconds since epoch.
   */
  startTimestamp: number;

  /**
   * The end timestamp of the compacted events, in milliseconds since epoch.
   */
  endTimestamp: number;

  /**
   * The compacted content summarizing the events in the time range.
   */
  compactedContent: Content;
}

/**
 * Creates an EventCompaction object with default values.
 *
 * @param params Optional partial EventCompaction to merge.
 * @returns A complete EventCompaction object.
 */
export function createEventCompaction(
    params: Partial<EventCompaction> = {}): EventCompaction {
  return {
    startTimestamp: params.startTimestamp ?? 0,
    endTimestamp: params.endTimestamp ?? 0,
    compactedContent: params.compactedContent ?? {role: 'model', parts: []},
  };
}

/**
 * Represents the actions attached to an event.
 */
export interface EventActions {
  /**
   * If true, it won't call model to summarize function response.
   * Only used for function_response event.
   */
  skipSummarization?: boolean;

  /**
   * Indicates that the event is updating the state with the given delta.
   */
  stateDelta: {[key: string]: unknown};

  /**
   * Indicates that the event is updating an artifact. key is the filename,
   * value is the version.
   */
  artifactDelta: {[key: string]: number};

  /**
   * If set, the event transfers to the specified agent.
   */
  transferToAgent?: string;

  /**
   * The agent is escalating to a higher level agent.
   */
  escalate?: boolean;

  /**
   * Authentication configurations requested by tool responses.
   *
   * This field will only be set by a tool response event indicating tool
   * request auth credential.
   * - Keys: The function call id. Since one function response event could
   * contain multiple function responses that correspond to multiple function
   * calls. Each function call could request different auth configs. This id is
   * used to identify the function call.
   * - Values: The requested auth config.
   */
  requestedAuthConfigs: {[key: string]: AuthConfig};

  /**
   * A dict of tool confirmation requested by this event, keyed by the function
   * call id.
   */
  requestedToolConfirmations: {[key: string]: ToolConfirmation};

  /**
   * The invocation ID to rewind the session to.
   *
   * When set, this event represents a rewind operation that reverts the session
   * state to what it was before the specified invocation. All events from the
   * rewind point to (but not including) this rewind event will be skipped when
   * constructing LLM context.
   */
  rewindBeforeInvocationId?: string;

  /**
   * The compaction of the events.
   *
   * When set, this event represents a compacted summary of a range of previous
   * events. The compaction contains the start and end timestamps along with
   * the summarized content.
   */
  compaction?: EventCompaction;

  /**
   * The agent state at the current event, used for checkpoint and resume.
   *
   * Should only be set by ADK workflow for session rewind and resumption.
   */
  agentState?: Record<string, unknown>;

  /**
   * If true, the current agent has finished its current run.
   *
   * Note that there can be multiple events with endOfAgent=true for the same
   * agent within one invocation when there is a loop.
   * Should only be set by ADK workflow.
   */
  endOfAgent?: boolean;
}

/**
 * Creates an EventActions object.
 */
export function createEventActions(state: Partial<EventActions> = {}):
    EventActions {
  return {
    stateDelta: {},
    artifactDelta: {},
    requestedAuthConfigs: {},
    requestedToolConfirmations: {},
    ...state,
  };
}

/**
 * Merges a list of EventActions objects into a single EventActions object.
 *
 * 1. It merges dictionaries (stateDelta, artifactDelta, requestedAuthConfigs)
 * by adding all the properties from each source.
 *
 * 2. For other properties (skipSummarization,transferToAgent, escalate), the
 * last one wins.
 */
export function mergeEventActions(
    sources: Array<Partial<EventActions>>,
    target?: EventActions): EventActions {
  const result = createEventActions();

  if (target) {
    Object.assign(result, target);
  }

  for (const source of sources) {
    if (!source) continue;

    if (source.stateDelta) {
      Object.assign(result.stateDelta, source.stateDelta);
    }
    if (source.artifactDelta) {
      Object.assign(result.artifactDelta, source.artifactDelta);
    }
    if (source.requestedAuthConfigs) {
      Object.assign(result.requestedAuthConfigs, source.requestedAuthConfigs);
    }
    if (source.requestedToolConfirmations) {
      Object.assign(
          result.requestedToolConfirmations, source.requestedToolConfirmations);
    }

    if (source.skipSummarization !== undefined) {
      result.skipSummarization = source.skipSummarization;
    }
    if (source.transferToAgent !== undefined) {
      result.transferToAgent = source.transferToAgent;
    }
    if (source.escalate !== undefined) {
      result.escalate = source.escalate;
    }
  }
  return result;
}