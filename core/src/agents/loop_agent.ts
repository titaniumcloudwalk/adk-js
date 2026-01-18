/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Event} from '../events/event.js';

import {BaseAgent, BaseAgentConfig} from './base_agent.js';
import {LoopAgentState} from './base_agent_state.js';
import {InvocationContext} from './invocation_context.js';

/**
 * Helper interface to track loop resumption state.
 */
interface LoopStartState {
  /**
   * The iteration number to start from.
   */
  startIteration: number;

  /**
   * The index of the sub-agent to start from.
   */
  startSubAgentIndex: number;

  /**
   * Whether we are resuming at the current agent (vs a nested agent).
   */
  isResumingAtCurrentAgent: boolean;
}

/**
 * The configuration options for creating a loop agent.
 */
export interface LoopAgentConfig extends BaseAgentConfig {
  /**
   * The maximum number of iterations the loop agent will run.
   *
   * If not provided, the loop agent will run indefinitely.
   */
  maxIterations?: number;
}

/**
 * A shell agent that run its sub-agents in a loop.
 *
 * When sub-agent generates an event with escalate or max_iterations are
 * reached, the loop agent will stop.
 *
 * Supports resumable workflows when resumabilityConfig is set on the context.
 * During resumable execution, the loop will checkpoint its state before
 * yielding events and can pause when long-running tools are encountered.
 */
export class LoopAgent extends BaseAgent {
  private readonly maxIterations: number;

  constructor(config: LoopAgentConfig) {
    super(config);
    this.maxIterations = config.maxIterations ?? Number.MAX_SAFE_INTEGER;
  }

  protected async *
      runAsyncImpl(
          context: InvocationContext,
          ): AsyncGenerator<Event, void, void> {
    // Determine starting position for resumable workflows
    const startState = this.getStartState(context);
    let iteration = startState.startIteration;
    let isPaused = false;

    while (iteration < this.maxIterations) {
      // Determine starting sub-agent index for this iteration
      const startIndex = iteration === startState.startIteration
          ? startState.startSubAgentIndex
          : 0;

      for (let i = startIndex; i < this.subAgents.length; i++) {
        const subAgent = this.subAgents[i];
        let shouldExit = false;

        // Checkpoint state before running sub-agent (if resumable and not resuming)
        if (context.isResumable && !startState.isResumingAtCurrentAgent) {
          const state = new LoopAgentState({
            currentSubAgent: subAgent.name,
            timesLooped: iteration,
          });
          context.setAgentState(this.name, state.toObject());
          yield this.createAgentStateEvent(context, state);
        }

        // Reset isResumingAtCurrentAgent after first sub-agent
        if (startState.isResumingAtCurrentAgent && i === startIndex) {
          startState.isResumingAtCurrentAgent = false;
        }

        for await (const event of subAgent.runAsync(context)) {
          yield event;

          if (event.actions.escalate) {
            shouldExit = true;
          }

          // Check if we should pause due to long-running tools
          if (context.shouldPauseInvocation(event)) {
            isPaused = true;
          }
        }

        if (shouldExit || isPaused) {
          // If paused, don't emit end-of-agent event
          if (!isPaused && context.isResumable) {
            context.setAgentState(this.name, undefined, true);
            yield this.createAgentStateEvent(context, undefined, true);
          }
          return;
        }
      }

      iteration++;

      // Reset sub-agent states at the start of a new loop iteration
      if (iteration < this.maxIterations && context.isResumable) {
        for (const subAgent of this.subAgents) {
          context.resetSubAgentStates(subAgent);
        }
      }
    }

    // Emit end-of-agent event when loop completes
    if (context.isResumable) {
      context.setAgentState(this.name, undefined, true);
      yield this.createAgentStateEvent(context, undefined, true);
    }
  }

  /**
   * Computes the starting state for resumable loop execution.
   *
   * When resuming from a checkpoint, this method determines which iteration
   * and sub-agent to start from based on saved state.
   *
   * @param context The invocation context.
   * @returns The starting state for the loop.
   */
  private getStartState(context: InvocationContext): LoopStartState {
    const defaultState: LoopStartState = {
      startIteration: 0,
      startSubAgentIndex: 0,
      isResumingAtCurrentAgent: false,
    };

    if (!context.isResumable) {
      return defaultState;
    }

    // Check if this agent has already finished
    if (context.isEndOfAgent(this.name)) {
      return defaultState;
    }

    // Load saved state if available
    const savedState = this.loadAgentState(context, LoopAgentState.fromObject);
    if (!savedState) {
      return defaultState;
    }

    // Find the sub-agent index
    const subAgentIndex =
        this.subAgents.findIndex(a => a.name === savedState.currentSubAgent);
    if (subAgentIndex === -1) {
      // Sub-agent not found, start from beginning
      return defaultState;
    }

    return {
      startIteration: savedState.timesLooped,
      startSubAgentIndex: subAgentIndex,
      isResumingAtCurrentAgent: true,
    };
  }

  protected async *
      runLiveImpl(
          context: InvocationContext,
          ): AsyncGenerator<Event, void, void> {
    throw new Error('This is not supported yet for LoopAgent.');
  }
}