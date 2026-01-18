/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Task result aggregator for A2A protocol.
 * Aggregates task status updates to determine final state.
 */

import type {
  A2AEvent,
  A2ATaskStatusUpdateEvent,
} from '../converters/event_converter.js';
import type {A2AMessage, A2ATaskState} from '../converters/request_converter.js';

/**
 * State priority for determining final task state.
 * Higher priority states override lower priority states.
 */
const STATE_PRIORITY: Record<A2ATaskState, number> = {
  failed: 4,
  auth_required: 3,
  input_required: 2,
  working: 1,
  submitted: 0,
  completed: 0,
};

/**
 * Aggregates task status updates to determine final state.
 */
export class TaskResultAggregator {
  private _taskState: A2ATaskState = 'working';
  private _taskStatusMessage: A2AMessage | undefined;

  /**
   * Processes an A2A event and tracks state transitions.
   *
   * @param event - The A2A event to process.
   */
  processEvent(event: A2AEvent): void {
    if (event.kind === 'status_update') {
      const statusEvent = event as A2ATaskStatusUpdateEvent;
      const newState = statusEvent.status.state;
      const newPriority = STATE_PRIORITY[newState] ?? 0;
      const currentPriority = STATE_PRIORITY[this._taskState] ?? 0;

      // Update state if new state has higher priority
      if (newPriority >= currentPriority) {
        this._taskState = newState;
        if (statusEvent.status.message) {
          this._taskStatusMessage = statusEvent.status.message;
        }
      }
    }
  }

  /**
   * Gets the current final task state.
   */
  get taskState(): A2ATaskState {
    return this._taskState;
  }

  /**
   * Gets the final status message.
   */
  get taskStatusMessage(): A2AMessage | undefined {
    return this._taskStatusMessage;
  }
}
