/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI implementation for recording ADK conformance tests.
 *
 * This module provides the `adk conformance record` command which
 * generates test recordings from spec.yaml files.
 */

import * as fs from 'fs';
import * as path from 'path';

import {Content, Part} from '@google/genai';
import * as yaml from 'js-yaml';

import {Session} from '@google/adk';

import {AdkWebServerClient, RunAgentRequest} from './adk_web_server_client.js';
import {TestCase, TestSpec, yamlToTestSpec} from './test_case.js';

const USER_ID = 'adk_conformance_test_user';

/**
 * Load TestSpec from spec.yaml file.
 */
function loadTestCase(testCaseDir: string): TestSpec {
  const specFile = path.join(testCaseDir, 'spec.yaml');
  const fileContent = fs.readFileSync(specFile, 'utf-8');
  const data = yaml.load(fileContent) as Record<string, unknown>;
  return yamlToTestSpec(data);
}

/**
 * Save session to YAML file, excluding recording config fields.
 */
function saveSession(session: Session, filePath: string): void {
  // Filter out recording config from state
  const filteredState: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(session.state)) {
    if (key !== '_adk_recordings_config') {
      filteredState[key] = value;
    }
  }

  // Filter out recording config from event state deltas
  const filteredEvents = session.events.map(event => {
    if (!event.actions?.stateDelta) {
      return event;
    }
    const filteredStateDelta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.actions.stateDelta)) {
      if (key !== '_adk_recordings_config') {
        filteredStateDelta[key] = value;
      }
    }
    return {
      ...event,
      actions: {
        ...event.actions,
        stateDelta: Object.keys(filteredStateDelta).length > 0 ? filteredStateDelta : undefined,
      },
    };
  });

  const sessionData = {
    id: session.id,
    app_name: session.appName,
    user_id: session.userId,
    state: filteredState,
    events: filteredEvents,
    last_update_time: session.lastUpdateTime,
  };

  const yamlContent = yaml.dump(sessionData);
  fs.writeFileSync(filePath, yamlContent, 'utf-8');
}

/**
 * Generate conformance test files from a TestCase.
 */
async function createConformanceTestFiles(
  testCase: TestCase,
  userId: string = USER_ID
): Promise<string> {
  const testCaseDir = testCase.dir;

  // Remove existing generated files to ensure clean state
  const generatedSessionFile = path.join(testCaseDir, 'generated-session.yaml');
  const generatedRecordingsFile = path.join(testCaseDir, 'generated-recordings.yaml');

  if (fs.existsSync(generatedSessionFile)) {
    fs.unlinkSync(generatedSessionFile);
  }
  if (fs.existsSync(generatedRecordingsFile)) {
    fs.unlinkSync(generatedRecordingsFile);
  }

  const client = new AdkWebServerClient();

  try {
    // Create a new session for the test
    const session = await client.createSession({
      appName: testCase.testSpec.agent,
      userId,
      state: testCase.testSpec.initialState,
    });

    // Run the agent with the user messages
    const functionCallNameToIdMap: Map<string, string> = new Map();

    for (let userMessageIndex = 0; userMessageIndex < testCase.testSpec.userMessages.length; userMessageIndex++) {
      const userMessage = testCase.testSpec.userMessages[userMessageIndex];

      // Create content from UserMessage object
      let content: Content;
      if (userMessage.content !== undefined) {
        content = userMessage.content as Content;

        // If the user provides a function response, replace the function call ID
        // with the actual function call ID
        if (
          content.parts &&
          content.parts[0] &&
          (content.parts[0] as Part & {functionResponse?: {name?: string; id?: string}}).functionResponse?.name
        ) {
          const functionResponse = (content.parts[0] as Part & {functionResponse: {name: string; id?: string}}).functionResponse;
          const actualId = functionCallNameToIdMap.get(functionResponse.name);
          if (!actualId) {
            throw new Error(
              `Function response for ${functionResponse.name} does not match any pending function call.`
            );
          }
          functionResponse.id = actualId;
        }
      } else if (userMessage.text !== undefined) {
        content = {
          role: 'user',
          parts: [{text: userMessage.text}],
        };
      } else {
        throw new Error(
          `UserMessage at index ${userMessageIndex} has neither text nor content`
        );
      }

      const request: RunAgentRequest = {
        appName: testCase.testSpec.agent,
        userId,
        sessionId: session.id,
        newMessage: content,
        stateDelta: userMessage.stateDelta,
      };

      // Run the agent and collect function call IDs
      for await (const event of client.runAgent(
        request,
        'record',
        testCaseDir,
        userMessageIndex
      )) {
        if (event.content && event.content.parts) {
          for (const part of event.content.parts) {
            const functionCall = (part as Part & {functionCall?: {name: string; id: string}}).functionCall;
            if (functionCall) {
              functionCallNameToIdMap.set(functionCall.name, functionCall.id);
            }
          }
        }
      }
    }

    // Retrieve the updated session
    const updatedSession = await client.getSession({
      appName: testCase.testSpec.agent,
      userId,
      sessionId: session.id,
    });

    // Save session.yaml
    saveSession(updatedSession, generatedSessionFile);

    return generatedSessionFile;
  } finally {
    await client.close();
  }
}

/**
 * Discover and load test cases from specified directories.
 */
function discoverTestCases(testDirs: string[]): Map<string, TestCase> {
  const testCases: Map<string, TestCase> = new Map();

  for (const testDir of testDirs) {
    if (!fs.existsSync(testDir)) {
      continue;
    }

    // Recursively find spec.yaml files
    const findSpecFiles = (dir: string): string[] => {
      const results: string[] = [];
      const entries = fs.readdirSync(dir, {withFileTypes: true});

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...findSpecFiles(fullPath));
        } else if (entry.name === 'spec.yaml') {
          results.push(fullPath);
        }
      }

      return results;
    };

    const specFiles = findSpecFiles(testDir);

    for (const specFile of specFiles) {
      try {
        const testCaseDir = path.dirname(specFile);
        const category = path.basename(path.dirname(testCaseDir));
        const name = path.basename(testCaseDir);
        const testSpec = loadTestCase(testCaseDir);
        const testCase: TestCase = {
          category,
          name,
          dir: testCaseDir,
          testSpec,
        };
        testCases.set(testCaseDir, testCase);
        console.log(`Loaded test spec: ${category}/${name}`);
      } catch (e) {
        console.error(`Failed to load ${specFile}: ${e}`);
      }
    }
  }

  return testCases;
}

/**
 * Run conformance record command.
 *
 * Generates conformance tests from TestCaseInput files (spec.yaml).
 *
 * @param paths List of directories containing test cases input files.
 */
export async function runConformanceRecord(paths: string[]): Promise<void> {
  console.log('Generating ADK conformance tests...');

  // Look for spec.yaml files and load TestCase objects
  const testCases = discoverTestCases(paths);

  // Process all loaded test cases
  if (testCases.size > 0) {
    console.log(`\nProcessing ${testCases.size} test cases...`);

    for (const testCase of testCases.values()) {
      try {
        await createConformanceTestFiles(testCase);
        console.log(
          `\x1b[32mGenerated conformance test files for: ${testCase.category}/${testCase.name}\x1b[0m`
        );
      } catch (e) {
        console.error(
          `\x1b[31mFailed to generate ${testCase.category}/${testCase.name}: ${e}\x1b[0m`
        );
      }
    }
  } else {
    console.log('\x1b[33mNo test specs found to process.\x1b[0m');
  }

  console.log('\n\x1b[34mConformance test generation complete!\x1b[0m');
}
