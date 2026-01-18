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
 * - Converting between ADK events and A2A protocol messages
 * - Full bidirectional conversion between ADK and A2A data structures
 *
 * @experimental This module is experimental and may change in future releases.
 */

export * from './experimental.js';
export * from './converters/index.js';
export * from './executor/index.js';
