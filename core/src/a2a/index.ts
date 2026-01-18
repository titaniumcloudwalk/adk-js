/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A2A (Agent-to-Agent) Protocol Support
 *
 * This module provides experimental support for the A2A protocol, enabling:
 * - Exposing ADK agents as A2A servers
 * - Consuming remote A2A agents via RemoteA2aAgent
 * - Converting between ADK events and A2A protocol messages
 * - Full bidirectional conversion between ADK and A2A data structures
 * - Structured logging utilities for A2A requests and responses
 *
 * @experimental This module is experimental and may change in future releases.
 */

export * from './experimental.js';
export * from './converters/index.js';
export * from './executor/index.js';
export * from './logs/index.js';

// Explicitly re-export from agents to avoid naming conflicts
// (A2AMessage and A2ATask are also defined in converters)
export {
  RemoteA2aAgent,
  AgentCardResolutionError,
  A2AClientError,
  type RemoteA2aAgentConfig,
  type A2AClientResponse,
  // Rename to avoid conflicts with converters
  type A2AMessage as RemoteA2aAgentMessage,
  type A2ATask as RemoteA2aAgentTask,
} from './agents/index.js';

export * from './utils/index.js';
