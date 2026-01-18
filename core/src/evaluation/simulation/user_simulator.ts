/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Base user simulator interface.
 *
 * User simulators generate user messages for multi-turn evaluation scenarios.
 */

import {type Content} from '@google/genai';
import {type ConversationScenario} from '../eval_case.js';

/**
 * Context for generating user responses.
 */
export interface UserSimulatorContext {
  /** The conversation scenario being simulated. */
  scenario: ConversationScenario;

  /** Previous turns in the conversation (alternating user/agent). */
  conversationHistory: Content[];

  /** The last agent response. */
  lastAgentResponse?: Content;

  /** Current turn number (0-indexed). */
  turnNumber: number;
}

/**
 * Result from a user simulation step.
 */
export interface UserSimulatorResult {
  /** The simulated user message. */
  userMessage: Content;

  /** Whether the conversation should end after this message. */
  isComplete: boolean;

  /** Optional reason for ending the conversation. */
  completionReason?: string;
}

/**
 * Abstract base class for user simulators.
 *
 * User simulators generate user messages to create multi-turn
 * evaluation conversations.
 */
export abstract class UserSimulator {
  /**
   * Name of this simulator.
   */
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Generates the next user message in the conversation.
   *
   * @param context - The simulation context
   * @returns The simulated user response
   */
  abstract generateUserMessage(context: UserSimulatorContext): Promise<UserSimulatorResult>;

  /**
   * Resets the simulator state for a new conversation.
   */
  reset(): void {
    // Default implementation does nothing
  }
}
