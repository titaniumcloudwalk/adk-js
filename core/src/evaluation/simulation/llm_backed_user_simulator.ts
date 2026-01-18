/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LLM-backed user simulator.
 *
 * Uses an LLM to generate realistic user messages based on scenarios.
 */

import {type Content} from '@google/genai';
import {
  UserSimulator,
  type UserSimulatorContext,
  type UserSimulatorResult,
} from './user_simulator.js';
import {type BaseLlm} from '../../models/base_llm.js';
import {LLMRegistry} from '../../models/registry.js';
import {type LlmRequest} from '../../models/llm_request.js';
import {getTextFromContent} from '../eval_case.js';
import {DEFAULT_JUDGE_MODEL} from '../constants.js';

/**
 * User simulator that uses an LLM to generate user messages.
 *
 * The LLM is prompted with the scenario description and conversation
 * history to generate contextually appropriate user messages.
 */
export class LlmBackedUserSimulator extends UserSimulator {
  private readonly model: string;
  private readonly temperature: number;
  private llm?: BaseLlm;

  /**
   * Creates a new LlmBackedUserSimulator.
   *
   * @param model - The model to use for generation (default: gemini-2.0-flash)
   * @param temperature - Temperature for generation (default: 0.7)
   * @param name - Optional name for this simulator
   */
  constructor(
    model: string = DEFAULT_JUDGE_MODEL,
    temperature: number = 0.7,
    name: string = 'llm_backed_user_simulator'
  ) {
    super(name);
    this.model = model;
    this.temperature = temperature;
  }

  /**
   * Gets or creates the LLM instance.
   */
  private getLlm(): BaseLlm {
    if (!this.llm) {
      this.llm = LLMRegistry.newLlm(this.model);
    }
    return this.llm;
  }

  async generateUserMessage(context: UserSimulatorContext): Promise<UserSimulatorResult> {
    const prompt = this.buildPrompt(context);
    const llm = this.getLlm();

    const request: LlmRequest = {
      contents: [
        {
          role: 'user',
          parts: [{text: prompt}],
        },
      ],
      toolsDict: {},
      liveConnectConfig: {},
    };

    // generateContentAsync is an async generator, collect the last response
    let lastResponse;
    for await (const response of llm.generateContentAsync(request, false)) {
      lastResponse = response;
    }

    const responseText = lastResponse?.content
      ? getTextFromContent(lastResponse.content)
      : '';

    // Parse the response to extract message and completion status
    return this.parseResponse(responseText, context);
  }

  /**
   * Builds the prompt for the user simulator LLM.
   */
  private buildPrompt(context: UserSimulatorContext): string {
    const {scenario, conversationHistory, lastAgentResponse, turnNumber} = context;
    const maxTurns = scenario.maxTurns ?? 10;

    // Format conversation history
    const historyText = conversationHistory.length > 0
      ? conversationHistory.map((c, i) => {
          const role = i % 2 === 0 ? 'User' : 'Agent';
          const text = getTextFromContent(c);
          return `${role}: ${text}`;
        }).join('\n')
      : '(No conversation history yet)';

    // Last agent response
    const lastResponseText = lastAgentResponse
      ? getTextFromContent(lastAgentResponse)
      : '(No agent response yet)';

    return `You are simulating a user interacting with an AI assistant.

## Scenario
${scenario.scenarioDescription}

${scenario.expectedGoal ? `## Expected Goal\n${scenario.expectedGoal}\n` : ''}

## Current Turn
Turn ${turnNumber + 1} of max ${maxTurns}

## Conversation History
${historyText}

## Last Agent Response
${lastResponseText}

## Instructions
Generate the next user message for this conversation.

Respond in the following format:

USER_MESSAGE: [The message the user would send]
IS_COMPLETE: [yes/no - whether the conversation goal has been achieved]
${turnNumber >= maxTurns - 1 ? '\nNote: This is the last turn, so IS_COMPLETE should be "yes".' : ''}

Guidelines:
- Stay in character as the user described in the scenario
- Be natural and conversational
- Work towards achieving the expected goal
- If the goal has been achieved, set IS_COMPLETE to "yes"
- If the agent seems stuck or unhelpful, try a different approach
- Don't be overly verbose - keep messages realistic`;
  }

  /**
   * Parses the LLM response to extract the user message and completion status.
   */
  private parseResponse(
    responseText: string,
    context: UserSimulatorContext
  ): UserSimulatorResult {
    // Extract user message
    const messageMatch = responseText.match(/USER_MESSAGE:\s*(.+?)(?=IS_COMPLETE:|$)/is);
    const userMessageText = messageMatch?.[1]?.trim() || 'I see, thank you.';

    // Extract completion status
    const completeMatch = responseText.match(/IS_COMPLETE:\s*(yes|no)/i);
    const isCompleteFromResponse = completeMatch?.[1]?.toLowerCase() === 'yes';

    // Check max turns
    const maxTurns = context.scenario.maxTurns ?? 10;
    const isLastTurn = context.turnNumber >= maxTurns - 1;
    const isComplete = isCompleteFromResponse || isLastTurn;

    const userMessage: Content = {
      role: 'user',
      parts: [{text: userMessageText}],
    };

    return {
      userMessage,
      isComplete,
      completionReason: isComplete
        ? (isLastTurn ? 'Reached max turns' : 'Goal achieved')
        : undefined,
    };
  }

  reset(): void {
    // LLM instance can be reused, but subclasses may override
  }
}
