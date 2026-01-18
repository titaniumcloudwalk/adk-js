/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core evaluation case types.
 *
 * These types define the structure of evaluation cases, invocations,
 * and the data collected during agent execution for evaluation.
 */

import {type Content} from '@google/genai';
import {type Rubric} from './eval_rubrics.js';

// Re-export Content from genai for convenience
export type {Content} from '@google/genai';

/**
 * Represents a tool call made during agent execution.
 */
export interface ToolCall {
  /** Name of the tool that was called. */
  toolName: string;

  /** Arguments passed to the tool. */
  args?: Record<string, unknown>;

  /** ID of the function call (for correlation with responses). */
  functionCallId?: string;
}

/**
 * Represents a tool response during agent execution.
 */
export interface ToolResponse {
  /** Name of the tool that responded. */
  toolName: string;

  /** The response from the tool. */
  response?: unknown;

  /** ID of the function call this response corresponds to. */
  functionCallId?: string;
}

/**
 * Intermediate data collected during a single invocation.
 *
 * This includes tool calls, tool responses, and other data
 * useful for evaluation.
 */
export interface IntermediateData {
  /** Tool calls made during this invocation. */
  toolCalls?: ToolCall[];

  /** Tool responses received during this invocation. */
  toolResponses?: ToolResponse[];

  /** Raw model responses (for detailed analysis). */
  modelResponses?: unknown[];

  /** Any additional custom data. */
  customData?: Record<string, unknown>;
}

/**
 * Events from an invocation (alternative to IntermediateData).
 *
 * Stores the raw event stream for more detailed replay/analysis.
 */
export interface InvocationEvents {
  /** Raw events from the invocation. */
  events: unknown[];
}

/**
 * Initial session state for an evaluation case.
 */
export interface SessionInput {
  /** Initial state to set on the session. */
  state?: Record<string, unknown>;

  /** App name for the session. */
  appName?: string;

  /** User ID for the session. */
  userId?: string;
}

/**
 * App details for tracking which app/agent was evaluated.
 */
export interface AppDetails {
  /** Name of the app. */
  appName?: string;

  /** Description of the app. */
  description?: string;

  /** Version of the app. */
  version?: string;
}

/**
 * A single invocation (turn) in a conversation.
 *
 * An invocation represents one user message and the agent's response,
 * along with any intermediate data collected during execution.
 */
export interface Invocation {
  /**
   * Unique identifier for this invocation.
   */
  invocationId: string;

  /**
   * The user's input content.
   */
  userContent: Content;

  /**
   * The agent's final response content.
   */
  finalResponse?: Content;

  /**
   * Intermediate data collected during this invocation.
   * Use either intermediateData or invocationEvents, not both.
   */
  intermediateData?: IntermediateData;

  /**
   * Raw events from this invocation.
   * Use either intermediateData or invocationEvents, not both.
   */
  invocationEvents?: InvocationEvents;

  /**
   * Timestamp when this invocation was created (ms since epoch).
   */
  creationTimestamp: number;

  /**
   * Optional rubrics specific to this invocation.
   */
  rubrics?: Rubric[];

  /**
   * Optional app details for this invocation.
   */
  appDetails?: AppDetails;
}

/**
 * Configuration for dynamic conversation scenarios.
 *
 * Used with user simulators to generate multi-turn conversations.
 */
export interface ConversationScenario {
  /** Description of the scenario for the user simulator. */
  scenarioDescription: string;

  /** Initial user message to start the conversation. */
  initialMessage?: Content;

  /** Maximum number of turns in the conversation. */
  maxTurns?: number;

  /** Goal that should be achieved by the end of the conversation. */
  expectedGoal?: string;
}

/**
 * Static conversation for evaluation (no simulation needed).
 */
export interface StaticConversation {
  /** The fixed list of invocations in this conversation. */
  invocations: Invocation[];
}

/**
 * An evaluation case defines a single test scenario.
 *
 * An eval case can have either:
 * - A static conversation (pre-defined invocations)
 * - A conversation scenario (for dynamic generation with user simulator)
 */
export interface EvalCase {
  /**
   * Unique identifier for this eval case.
   */
  evalId: string;

  /**
   * Static conversation with pre-defined invocations.
   * Use either conversation or conversationScenario, not both.
   */
  conversation?: Invocation[];

  /**
   * Dynamic conversation scenario for user simulation.
   * Use either conversation or conversationScenario, not both.
   */
  conversationScenario?: ConversationScenario;

  /**
   * Initial session input for this eval case.
   */
  sessionInput?: SessionInput;

  /**
   * Timestamp when this eval case was created (ms since epoch).
   */
  creationTimestamp: number;

  /**
   * Optional rubrics for this entire eval case.
   */
  rubrics?: Rubric[];

  /**
   * Expected final session state after running this eval case.
   */
  finalSessionState?: Record<string, unknown>;
}

/**
 * Creates a new Invocation instance.
 *
 * @param invocationId - Unique ID for this invocation
 * @param userContent - The user's input
 * @param finalResponse - The agent's response
 * @param intermediateData - Optional intermediate data
 * @returns A new Invocation instance
 */
export function createInvocation(
  invocationId: string,
  userContent: Content,
  finalResponse?: Content,
  intermediateData?: IntermediateData
): Invocation {
  return {
    invocationId,
    userContent,
    finalResponse,
    intermediateData,
    creationTimestamp: Date.now(),
  };
}

/**
 * Creates a new EvalCase instance with a static conversation.
 *
 * @param evalId - Unique ID for this eval case
 * @param conversation - List of invocations
 * @param sessionInput - Optional initial session state
 * @returns A new EvalCase instance
 */
export function createEvalCase(
  evalId: string,
  conversation: Invocation[],
  sessionInput?: SessionInput
): EvalCase {
  return {
    evalId,
    conversation,
    sessionInput,
    creationTimestamp: Date.now(),
  };
}

/**
 * Creates a new EvalCase instance with a conversation scenario.
 *
 * @param evalId - Unique ID for this eval case
 * @param conversationScenario - The scenario configuration
 * @param sessionInput - Optional initial session state
 * @returns A new EvalCase instance
 */
export function createEvalCaseWithScenario(
  evalId: string,
  conversationScenario: ConversationScenario,
  sessionInput?: SessionInput
): EvalCase {
  return {
    evalId,
    conversationScenario,
    sessionInput,
    creationTimestamp: Date.now(),
  };
}

/**
 * Extracts tool calls from an invocation's intermediate data.
 *
 * @param invocation - The invocation to extract from
 * @returns Array of tool calls, or empty array if none
 */
export function getToolCalls(invocation: Invocation): ToolCall[] {
  return invocation.intermediateData?.toolCalls ?? [];
}

/**
 * Extracts tool names from an invocation.
 *
 * @param invocation - The invocation to extract from
 * @returns Array of tool names in order of invocation
 */
export function getToolNames(invocation: Invocation): string[] {
  return getToolCalls(invocation).map((tc) => tc.toolName);
}

/**
 * Gets the text content from a Content object.
 *
 * @param content - The content to extract text from
 * @returns The text content, or empty string if none
 */
export function getTextFromContent(content?: Content): string {
  if (!content) {
    return '';
  }

  // Handle various Content formats
  if (typeof content === 'string') {
    return content;
  }

  // Content with parts array (genai format)
  if ('parts' in content && Array.isArray(content.parts)) {
    return content.parts
      .filter((p): p is {text: string} => 'text' in p && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
  }

  // Single part with text
  if ('text' in content && typeof content.text === 'string') {
    return content.text;
  }

  return '';
}
