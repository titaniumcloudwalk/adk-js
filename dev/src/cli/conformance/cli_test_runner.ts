/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CLI implementation for running ADK conformance tests.
 *
 * This module provides the `adk conformance test` command which
 * runs tests against recorded interactions in replay mode.
 */

import * as fs from 'fs';
import * as path from 'path';

import {Content, Part} from '@google/genai';
import * as yaml from 'js-yaml';

import {Session} from '@google/adk';

import {AdkWebServerClient, RunAgentRequest} from './adk_web_server_client.js';
import {compareEvents, compareSession, ComparisonResult} from './replay_validators.js';
import {TestCase, TestSpec, yamlToTestSpec} from './test_case.js';

const USER_ID = 'adk_conformance_test_user';

/**
 * Result of running a single conformance test.
 */
interface TestResult {
  category: string;
  name: string;
  success: boolean;
  errorMessage?: string;
}

/**
 * Summary of all conformance test results.
 */
interface ConformanceTestSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: TestResult[];
}

/**
 * Calculate success rate as a percentage.
 */
function getSuccessRate(summary: ConformanceTestSummary): number {
  if (summary.totalTests === 0) {
    return 0;
  }
  return (summary.passedTests / summary.totalTests) * 100;
}

/**
 * Load TestSpec from spec.yaml file.
 */
function loadTestSpec(testCaseDir: string): TestSpec {
  const specFile = path.join(testCaseDir, 'spec.yaml');
  const fileContent = fs.readFileSync(specFile, 'utf-8');
  const data = yaml.load(fileContent) as Record<string, unknown>;
  return yamlToTestSpec(data);
}

/**
 * Load recorded session from generated-session.yaml file.
 */
function loadRecordedSession(testCaseDir: string): Session | undefined {
  const sessionFile = path.join(testCaseDir, 'generated-session.yaml');
  if (!fs.existsSync(sessionFile)) {
    return undefined;
  }

  try {
    const fileContent = fs.readFileSync(sessionFile, 'utf-8');
    const sessionData = yaml.load(fileContent) as Record<string, unknown> | undefined;
    if (!sessionData) {
      return undefined;
    }

    // Convert snake_case to camelCase for TypeScript
    return {
      id: sessionData.id,
      appName: sessionData.app_name,
      userId: sessionData.user_id,
      state: (sessionData.state as Record<string, unknown>) || {},
      events: (sessionData.events as unknown[]) || [],
      lastUpdateTime: (sessionData.last_update_time as number) || 0,
    } as Session;
  } catch (e) {
    console.warn(`Warning: Failed to parse session data: ${e}`);
    return undefined;
  }
}

/**
 * Conformance test runner.
 */
class ConformanceTestRunner {
  private testPaths: string[];
  private mode: 'replay' | 'live';
  private client: AdkWebServerClient;
  private userId: string;

  constructor(
    testPaths: string[],
    client: AdkWebServerClient,
    mode: 'replay' | 'live' = 'replay',
    userId: string = USER_ID
  ) {
    this.testPaths = testPaths;
    this.mode = mode;
    this.client = client;
    this.userId = userId;
  }

  /**
   * Discover test cases from specified folder paths.
   */
  private discoverTestCases(): TestCase[] {
    const testCases: TestCase[] = [];

    for (const testPath of this.testPaths) {
      if (!fs.existsSync(testPath) || !fs.statSync(testPath).isDirectory()) {
        console.warn(`\x1b[33mInvalid path: ${testPath}\x1b[0m`);
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

      const specFiles = findSpecFiles(testPath);

      for (const specFile of specFiles) {
        const testCaseDir = path.dirname(specFile);
        const category = path.basename(path.dirname(testCaseDir));
        const name = path.basename(testCaseDir);

        // Skip if recordings missing in replay mode
        if (
          this.mode === 'replay' &&
          !fs.existsSync(path.join(testCaseDir, 'generated-recordings.yaml'))
        ) {
          console.warn(`\x1b[33mSkipping ${category}/${name}: no recordings\x1b[0m`);
          continue;
        }

        const testSpec = loadTestSpec(testCaseDir);
        testCases.push({
          category,
          name,
          dir: testCaseDir,
          testSpec,
        });
      }
    }

    // Sort by category and name
    return testCases.sort((a, b) => {
      const categoryCompare = a.category.localeCompare(b.category);
      if (categoryCompare !== 0) {
        return categoryCompare;
      }
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Run all user messages for a test case.
   */
  private async runUserMessages(sessionId: string, testCase: TestCase): Promise<void> {
    const functionCallNameToIdMap: Map<string, string> = new Map();

    for (let userMessageIndex = 0; userMessageIndex < testCase.testSpec.userMessages.length; userMessageIndex++) {
      const userMessage = testCase.testSpec.userMessages[userMessageIndex];

      // Create content from UserMessage object
      let content: Content;
      if (userMessage.content !== undefined) {
        content = userMessage.content as Content;

        // Replace function call ID if needed
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
        userId: this.userId,
        sessionId,
        newMessage: content,
        streaming: false,
        stateDelta: userMessage.stateDelta,
      };

      // Run the agent
      for await (const event of this.client.runAgent(
        request,
        'replay',
        testCase.dir,
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
  }

  /**
   * Validate test results by comparing with recorded data.
   */
  private async validateTestResults(sessionId: string, testCase: TestCase): Promise<TestResult> {
    // Get final session
    const finalSession = await this.client.getSession({
      appName: testCase.testSpec.agent,
      userId: this.userId,
      sessionId,
    });

    if (!finalSession) {
      return {
        category: testCase.category,
        name: testCase.name,
        success: false,
        errorMessage: 'No final session available for comparison',
      };
    }

    // Load recorded session data for comparison
    const recordedSession = loadRecordedSession(testCase.dir);
    if (!recordedSession) {
      return {
        category: testCase.category,
        name: testCase.name,
        success: false,
        errorMessage: 'No recorded session found for replay comparison',
      };
    }

    // Compare events and session
    const eventsResult = compareEvents(finalSession.events, recordedSession.events);
    const sessionResult = compareSession(finalSession, recordedSession);

    // Determine overall success
    const success = eventsResult.success && sessionResult.success;
    const errorMessages: string[] = [];
    if (!eventsResult.success && eventsResult.errorMessage) {
      errorMessages.push(`Event mismatch: ${eventsResult.errorMessage}`);
    }
    if (!sessionResult.success && sessionResult.errorMessage) {
      errorMessages.push(`Session mismatch: ${sessionResult.errorMessage}`);
    }

    return {
      category: testCase.category,
      name: testCase.name,
      success,
      errorMessage: errorMessages.length > 0 ? errorMessages.join('\n\n') : undefined,
    };
  }

  /**
   * Run a single test case in replay mode.
   */
  private async runTestCaseReplay(testCase: TestCase): Promise<TestResult> {
    try {
      // Create session
      const session = await this.client.createSession({
        appName: testCase.testSpec.agent,
        userId: this.userId,
        state: testCase.testSpec.initialState,
      });

      // Run each user message
      try {
        await this.runUserMessages(session.id, testCase);
      } catch (e) {
        return {
          category: testCase.category,
          name: testCase.name,
          success: false,
          errorMessage: `Replay verification failed: ${e}`,
        };
      }

      // Validate results and return test result
      const result = await this.validateTestResults(session.id, testCase);

      // Clean up session
      try {
        await this.client.deleteSession({
          appName: testCase.testSpec.agent,
          userId: this.userId,
          sessionId: session.id,
        });
      } catch (e) {
        // Ignore cleanup errors
      }

      return result;
    } catch (e) {
      return {
        category: testCase.category,
        name: testCase.name,
        success: false,
        errorMessage: `Test setup failed: ${e}`,
      };
    }
  }

  /**
   * Run all discovered test cases.
   */
  async runAllTests(): Promise<ConformanceTestSummary> {
    const testCases = this.discoverTestCases();
    if (testCases.length === 0) {
      console.warn('\x1b[33mNo test cases found!\x1b[0m');
      return {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        results: [],
      };
    }

    console.log(`\nFound ${testCases.length} test cases to run in ${this.mode} mode\n`);

    const results: TestResult[] = [];
    for (const testCase of testCases) {
      process.stdout.write(`Running ${testCase.category}/${testCase.name}...`);
      let result: TestResult;
      if (this.mode === 'replay') {
        result = await this.runTestCaseReplay(testCase);
      } else {
        // Live mode not yet implemented
        result = {
          category: testCase.category,
          name: testCase.name,
          success: false,
          errorMessage: 'Live mode not yet implemented',
        };
      }
      results.push(result);
      printTestCaseResult(result);
    }

    const passed = results.filter(r => r.success).length;
    return {
      totalTests: results.length,
      passedTests: passed,
      failedTests: results.length - passed,
      results,
    };
  }
}

/**
 * Print the result of a single test case.
 */
function printTestCaseResult(result: TestResult): void {
  if (result.success) {
    console.log(' \x1b[32m✓ PASS\x1b[0m');
  } else {
    console.log(' \x1b[31m✗ FAIL\x1b[0m');
    if (result.errorMessage) {
      console.error(`\x1b[31mError: ${result.errorMessage}\x1b[0m`);
    }
  }
}

/**
 * Print detailed information about a failed test result.
 */
function printTestResultDetails(result: TestResult): void {
  console.log(`\n\x1b[31m✗ ${result.category}/${result.name}\x1b[0m\n`);
  if (result.errorMessage) {
    const indentedMessage = result.errorMessage.split('\n').map(line => `  ${line}`).join('\n');
    console.error(`\x1b[31m${indentedMessage}\x1b[0m`);
  }
}

/**
 * Print the conformance test summary results.
 */
function printTestSummary(summary: ConformanceTestSummary): void {
  console.log('\n' + '='.repeat(50));
  console.log('CONFORMANCE TEST SUMMARY');
  console.log('='.repeat(50));

  if (summary.totalTests === 0) {
    console.log('\x1b[33mNo tests were run.\x1b[0m');
    return;
  }

  console.log(`Total tests: ${summary.totalTests}`);
  console.log(`\x1b[32mPassed: ${summary.passedTests}\x1b[0m`);

  if (summary.failedTests > 0) {
    console.log(`\x1b[31mFailed: ${summary.failedTests}\x1b[0m`);
  } else {
    console.log(`Failed: ${summary.failedTests}`);
  }

  console.log(`Success rate: ${getSuccessRate(summary).toFixed(1)}%`);

  // List failed tests
  const failedTests = summary.results.filter(r => !r.success);
  if (failedTests.length > 0) {
    console.log('\nFailed tests:');
    for (const result of failedTests) {
      printTestResultDetails(result);
    }
  }
}

/**
 * Print the conformance test header.
 */
function printTestHeader(mode: string): void {
  console.log('='.repeat(50));
  console.log(`Running ADK conformance tests in ${mode} mode...`);
  console.log('='.repeat(50));
}

/**
 * Run conformance test command.
 *
 * @param testPaths List of directories containing test cases.
 * @param mode Test mode: "replay" or "live".
 * @returns Exit code (0 for success, 1 for failures).
 */
export async function runConformanceTest(
  testPaths: string[],
  mode: 'replay' | 'live' = 'replay'
): Promise<number> {
  printTestHeader(mode);

  const client = new AdkWebServerClient();
  try {
    const runner = new ConformanceTestRunner(testPaths, client, mode);
    const summary = await runner.runAllTests();

    printTestSummary(summary);

    // Return exit code
    if (summary.failedTests > 0) {
      console.error(`\n\x1b[31m${summary.failedTests} test(s) failed\x1b[0m`);
      return 1;
    } else {
      console.log('\n\x1b[32mAll tests passed! 🎉\x1b[0m');
      return 0;
    }
  } finally {
    await client.close();
  }
}
