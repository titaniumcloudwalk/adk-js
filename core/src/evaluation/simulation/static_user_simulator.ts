/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Static user simulator.
 *
 * Uses predefined messages for each turn.
 */

import {type Content} from '@google/genai';
import {
  UserSimulator,
  type UserSimulatorContext,
  type UserSimulatorResult,
} from './user_simulator.js';

/**
 * User simulator that uses predefined static messages.
 *
 * Useful for deterministic evaluation scenarios where user behavior
 * should be consistent across runs.
 */
export class StaticUserSimulator extends UserSimulator {
  private readonly messages: Content[];

  /**
   * Creates a new StaticUserSimulator.
   *
   * @param messages - Array of predefined user messages
   * @param name - Optional name for this simulator
   */
  constructor(messages: Content[], name: string = 'static_user_simulator') {
    super(name);
    this.messages = messages;
  }

  async generateUserMessage(context: UserSimulatorContext): Promise<UserSimulatorResult> {
    const turnIndex = context.turnNumber;

    if (turnIndex >= this.messages.length) {
      // No more predefined messages
      return {
        userMessage: {
          role: 'user',
          parts: [{text: 'Thank you, that will be all.'}],
        },
        isComplete: true,
        completionReason: 'All predefined messages exhausted',
      };
    }

    const message = this.messages[turnIndex];
    const isLastMessage = turnIndex >= this.messages.length - 1;

    // Check for max turns
    const maxTurns = context.scenario.maxTurns ?? this.messages.length;
    const isComplete = isLastMessage || turnIndex >= maxTurns - 1;

    return {
      userMessage: message,
      isComplete,
      completionReason: isComplete ? 'Reached end of static messages' : undefined,
    };
  }
}

/**
 * Creates a static user simulator from simple text messages.
 *
 * @param messages - Array of message strings
 * @returns A new StaticUserSimulator
 */
export function createStaticUserSimulator(messages: string[]): StaticUserSimulator {
  const contentMessages: Content[] = messages.map((text) => ({
    role: 'user',
    parts: [{text}],
  }));

  return new StaticUserSimulator(contentMessages);
}
