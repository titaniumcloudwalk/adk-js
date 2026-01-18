/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Base interface for all agent states used in resumable workflows.
 *
 * Agent states capture checkpoint data that allows agents to pause
 * and resume their execution across invocations.
 *
 * Implementations should be serializable to/from plain objects.
 */
export interface BaseAgentState {
  /**
   * Converts the agent state to a plain object for serialization.
   */
  toObject(): Record<string, unknown>;
}

/**
 * Helper function to create a base agent state from a plain object.
 * Subclasses should implement their own fromObject method.
 *
 * @param obj The plain object to convert.
 * @returns The agent state object.
 */
export function createBaseAgentState(
    obj: Record<string, unknown>): BaseAgentState {
  return {
    toObject(): Record<string, unknown> {
      return {...obj};
    },
  };
}

/**
 * State for LoopAgent used in resumable workflows.
 *
 * Tracks the current position within a loop iteration for pause/resume.
 */
export class LoopAgentState implements BaseAgentState {
  /**
   * The name of the current sub-agent being executed.
   */
  currentSubAgent: string;

  /**
   * The number of times the loop has completed.
   */
  timesLooped: number;

  constructor(params: {currentSubAgent: string; timesLooped: number}) {
    this.currentSubAgent = params.currentSubAgent;
    this.timesLooped = params.timesLooped;
  }

  /**
   * Converts the loop agent state to a plain object for serialization.
   */
  toObject(): Record<string, unknown> {
    return {
      currentSubAgent: this.currentSubAgent,
      timesLooped: this.timesLooped,
    };
  }

  /**
   * Creates a LoopAgentState from a plain object.
   *
   * @param obj The plain object to convert.
   * @returns The LoopAgentState instance.
   */
  static fromObject(obj: Record<string, unknown>): LoopAgentState {
    return new LoopAgentState({
      currentSubAgent: obj['currentSubAgent'] as string ?? '',
      timesLooped: obj['timesLooped'] as number ?? 0,
    });
  }
}
