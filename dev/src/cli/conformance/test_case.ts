/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * TypeScript interfaces for ADK conformance test cases.
 *
 * These types mirror the Python models in test_case.py and define
 * the structure of conformance test specifications.
 */

import {Content} from '@google/genai';

/**
 * Represents a user message in a conformance test.
 */
export interface UserMessage {
  /** The user message in text (mutually exclusive with content). */
  text?: string;
  /** The user message as Content object (mutually exclusive with text). */
  content?: Content;
  /** The state changes when running this user message. */
  stateDelta?: Record<string, unknown>;
}

/**
 * Test specification for conformance test cases.
 *
 * This is the human-authored specification that defines what should be tested.
 * Category and name are inferred from folder structure.
 */
export interface TestSpec {
  /** Human-readable description of what this test validates. */
  description: string;
  /** Name of the ADK agent to test against. */
  agent: string;
  /** The initial state key-value pairs in the creation_session request. */
  initialState: Record<string, unknown>;
  /** Sequence of user messages to send to the agent during test execution. */
  userMessages: UserMessage[];
}

/**
 * Represents a single conformance test case.
 */
export interface TestCase {
  /** Test category (from folder name). */
  category: string;
  /** Test name (from folder name). */
  name: string;
  /** Directory path to the test case. */
  dir: string;
  /** The test specification loaded from spec.yaml. */
  testSpec: TestSpec;
}

/**
 * Converts a YAML object to a UserMessage.
 */
export function yamlToUserMessage(data: Record<string, unknown>): UserMessage {
  return {
    text: data.text as string | undefined,
    content: data.content as Content | undefined,
    stateDelta: data.state_delta as Record<string, unknown> | undefined,
  };
}

/**
 * Converts a YAML object to a TestSpec.
 */
export function yamlToTestSpec(data: Record<string, unknown>): TestSpec {
  const userMessagesData = data.user_messages as Record<string, unknown>[];
  return {
    description: data.description as string,
    agent: data.agent as string,
    initialState: (data.initial_state as Record<string, unknown>) || {},
    userMessages: userMessagesData ? userMessagesData.map(yamlToUserMessage) : [],
  };
}

/**
 * Converts a UserMessage to a YAML-compatible object with snake_case keys.
 */
export function userMessageToYaml(message: UserMessage): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (message.text !== undefined) {
    result.text = message.text;
  }
  if (message.content !== undefined) {
    result.content = message.content;
  }
  if (message.stateDelta !== undefined) {
    result.state_delta = message.stateDelta;
  }
  return result;
}

/**
 * Converts a TestSpec to a YAML-compatible object with snake_case keys.
 */
export function testSpecToYaml(spec: TestSpec): Record<string, unknown> {
  return {
    description: spec.description,
    agent: spec.agent,
    initial_state: spec.initialState,
    user_messages: spec.userMessages.map(userMessageToYaml),
  };
}
