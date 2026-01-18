/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Conformance testing module for ADK.
 *
 * Provides tools for recording and replaying agent interactions
 * to ensure behavioral consistency across changes.
 */

export {runConformanceRecord} from './cli_record.js';
export {runConformanceTest} from './cli_test_runner.js';
export {RecordingsPlugin} from './recordings_plugin.js';
export {ReplayPlugin, ReplayConfigError, ReplayVerificationError} from './replay_plugin.js';
export {AdkWebServerClient} from './adk_web_server_client.js';
export type {RunAgentRequest} from './adk_web_server_client.js';
export {compareEvent, compareEvents, compareSession} from './replay_validators.js';
export type {ComparisonResult} from './replay_validators.js';
export type {TestCase, TestSpec, UserMessage} from './test_case.js';
export {yamlToTestSpec, yamlToUserMessage, testSpecToYaml, userMessageToYaml} from './test_case.js';
export type {Recording, Recordings, LlmRecording, ToolRecording} from './recordings_schema.js';
export {
  createEmptyRecordings,
  recordingToYaml,
  recordingsToYaml,
  yamlToRecording,
  yamlToRecordings,
} from './recordings_schema.js';
