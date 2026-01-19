/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Evaluation CLI commands implementation.
 *
 * Provides CLI commands for running evaluations, managing eval sets,
 * and adding eval cases. Follows Python ADK CLI patterns.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  type BaseAgent,
  type EvalSet,
  type EvalCase,
  type EvalConfig,
  type EvalMetric,
  type EvalCaseResult,
  type EvalSetResult,
  type ConversationScenario,
  type Invocation,
  type Criterion,
  type CustomMetricConfig,
  createEvalSet,
  createEvalCase,
  createEvalCaseWithScenario,
  createEvalConfig,
  createEvalMetric,
  createAgentEvaluator,
  LocalEvalSetsManager,
  LocalEvalSetResultsManager,
  EvalStatus,
  ToolTrajectoryMatchType,
  PREBUILT_METRIC_NAMES,
} from '@google/adk';

/**
 * Result summary for display.
 */
interface EvalSetSummary {
  evalSetId: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  notEvaluatedCases: number;
}

/**
 * Options for the 'adk eval' command.
 */
export interface EvalOptions {
  /** Path to the agent module file or directory. */
  agentPath: string;

  /** List of eval set file paths or IDs (with optional case filters). */
  evalSets: string[];

  /** Path to evaluation config file (JSON). */
  configFile?: string;

  /** Print detailed results per eval case. */
  printDetailedResults?: boolean;

  /** Storage URI for eval results (e.g., gs://bucket). */
  evalStorageUri?: string;
}

/**
 * Options for the 'adk eval_set create' command.
 */
export interface EvalSetCreateOptions {
  /** Path to the agent module file or directory. */
  agentPath: string;

  /** ID for the new eval set. */
  evalSetId: string;

  /** Optional name for the eval set. */
  name?: string;

  /** Optional description for the eval set. */
  description?: string;

  /** Storage URI for eval sets. */
  evalStorageUri?: string;
}

/**
 * Options for the 'adk eval_set add_eval_case' command.
 */
export interface EvalSetAddCaseOptions {
  /** Path to the agent module file or directory. */
  agentPath: string;

  /** ID of the eval set to add cases to. */
  evalSetId: string;

  /** Path to JSON file with conversation scenarios. */
  scenariosFile?: string;

  /** Path to JSON file with session input. */
  sessionInputFile?: string;

  /** Storage URI for eval sets. */
  evalStorageUri?: string;
}

/**
 * Loads an agent from a file path.
 *
 * @param agentPath - Path to the agent file (.ts, .js)
 * @returns The loaded agent
 */
async function loadAgent(agentPath: string): Promise<BaseAgent> {
  const absolutePath = path.isAbsolute(agentPath)
    ? agentPath
    : path.join(process.cwd(), agentPath);

  // Try to import the module
  const moduleUrl = `file://${absolutePath}`;
  const agentModule = await import(moduleUrl);

  // Look for rootAgent, root_agent, or default export
  const agent =
    agentModule.rootAgent ??
    agentModule.root_agent ??
    agentModule.default;

  if (!agent) {
    throw new Error(
      `No agent found in module '${agentPath}'. Expected export: rootAgent, root_agent, or default.`
    );
  }

  return agent as BaseAgent;
}

/**
 * Gets the app name from an agent path.
 *
 * @param agentPath - Path to the agent file
 * @returns The app name (directory or file name without extension)
 */
function getAppName(agentPath: string): string {
  const absolutePath = path.isAbsolute(agentPath)
    ? agentPath
    : path.join(process.cwd(), agentPath);

  const baseName = path.basename(absolutePath);

  // Check if it's a directory
  if (!baseName.includes('.')) {
    return baseName;
  }

  // Remove extension
  return baseName.replace(/\.[^.]+$/, '');
}

/**
 * Gets the base directory for an agent.
 *
 * @param agentPath - Path to the agent file
 * @returns The base directory
 */
function getBaseDir(agentPath: string): string {
  const absolutePath = path.isAbsolute(agentPath)
    ? agentPath
    : path.join(process.cwd(), agentPath);

  return path.dirname(absolutePath);
}

/**
 * Parses eval set specification with optional case filters.
 *
 * Format: eval_set_id[:case1,case2,case3] or file_path[:case1,case2,case3]
 *
 * @param spec - The eval set specification
 * @returns Parsed spec with ID/path and optional case filter
 */
function parseEvalSetSpec(spec: string): {idOrPath: string; caseFilter?: string[]} {
  const colonIndex = spec.indexOf(':');

  // Check if colon is part of a path (e.g., C:\path\to\file)
  if (colonIndex === 1 && /^[a-zA-Z]$/.test(spec[0])) {
    // Windows path - look for next colon
    const nextColon = spec.indexOf(':', 2);
    if (nextColon !== -1) {
      const idOrPath = spec.substring(0, nextColon);
      const caseFilter = spec.substring(nextColon + 1).split(',').filter(Boolean);
      return {idOrPath, caseFilter: caseFilter.length > 0 ? caseFilter : undefined};
    }
    return {idOrPath: spec};
  }

  if (colonIndex !== -1) {
    const idOrPath = spec.substring(0, colonIndex);
    const caseFilter = spec.substring(colonIndex + 1).split(',').filter(Boolean);
    return {idOrPath, caseFilter: caseFilter.length > 0 ? caseFilter : undefined};
  }

  return {idOrPath: spec};
}

/**
 * Loads an eval set from a file path or manager.
 *
 * @param idOrPath - Eval set ID or file path
 * @param manager - Optional eval sets manager
 * @param appName - App name for manager lookup
 * @returns The loaded eval set
 */
async function loadEvalSet(
  idOrPath: string,
  manager?: LocalEvalSetsManager,
  appName?: string
): Promise<EvalSet> {
  // Check if it's a file path
  if (idOrPath.endsWith('.json') || idOrPath.includes('/') || idOrPath.includes('\\')) {
    const absolutePath = path.isAbsolute(idOrPath)
      ? idOrPath
      : path.join(process.cwd(), idOrPath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    return JSON.parse(content) as EvalSet;
  }

  // Try to load from manager
  if (manager && appName) {
    const evalSet = await manager.getEvalSet(appName, idOrPath);
    if (evalSet) {
      return evalSet;
    }
  }

  throw new Error(`Eval set '${idOrPath}' not found. Provide a file path or ensure it exists in the eval storage.`);
}

/**
 * Config file format for evaluation.
 * Supports both simple metric configs and custom metrics with code paths.
 */
interface EvalConfigFile {
  /** Simple criteria format: { "metric_name": threshold } */
  criteria?: Record<string, number | Criterion>;

  /** Custom metrics format: { "metric_name": { codeConfig: { name: "path.to.function" } } } */
  customMetrics?: Record<string, CustomMetricConfig>;

  /** Alternative: full metrics array format */
  metrics?: Array<{
    metricName: string;
    threshold?: number;
    criterion?: unknown;
    customFunctionPath?: string;
  }>;

  numRepeats?: number;
  maxParallelEvaluations?: number;
  continueOnError?: boolean;
  timeoutMs?: number;
}

/**
 * Gets eval metrics from config, handling both criteria and customMetrics formats.
 *
 * @param configData - The parsed config file data
 * @returns Array of EvalMetric objects
 */
function getEvalMetricsFromConfig(configData: EvalConfigFile): EvalMetric[] {
  const metrics: EvalMetric[] = [];

  // Handle the full metrics array format (existing behavior)
  if (configData.metrics) {
    for (const m of configData.metrics) {
      metrics.push(
        createEvalMetric(
          m.metricName,
          m.threshold ?? 0.5,
          m.criterion as Criterion | undefined,
          m.customFunctionPath
        )
      );
    }
    return metrics;
  }

  // Handle criteria + customMetrics format (Python pattern)
  if (configData.criteria) {
    for (const [metricName, criterion] of Object.entries(configData.criteria)) {
      // Check if this metric has a custom function path
      let customFunctionPath: string | undefined;
      if (configData.customMetrics && configData.customMetrics[metricName]) {
        const config = configData.customMetrics[metricName];
        // Validate that codeConfig.args is not set (not supported)
        if (config.codeConfig.args) {
          throw new Error(
            `args field in codeConfig for custom metric '${metricName}' is not supported.`
          );
        }
        customFunctionPath = config.codeConfig.name;
      }

      // Handle threshold-only criterion
      if (typeof criterion === 'number') {
        metrics.push(createEvalMetric(metricName, criterion, undefined, customFunctionPath));
      } else {
        // Handle full criterion object
        metrics.push(
          createEvalMetric(
            metricName,
            (criterion as {threshold?: number}).threshold ?? 0.5,
            criterion as Criterion,
            customFunctionPath
          )
        );
      }
    }
  }

  return metrics;
}

/**
 * Loads eval config from a file or creates default config.
 *
 * Supports two config formats:
 *
 * 1. Simple criteria format (Python pattern):
 * ```json
 * {
 *   "criteria": {
 *     "tool_trajectory_avg_score": 0.8,
 *     "my_custom_metric": 0.5
 *   },
 *   "customMetrics": {
 *     "my_custom_metric": {
 *       "codeConfig": { "name": "my_module.my_function" }
 *     }
 *   }
 * }
 * ```
 *
 * 2. Full metrics array format:
 * ```json
 * {
 *   "metrics": [
 *     { "metricName": "tool_trajectory_avg_score", "threshold": 0.8 },
 *     { "metricName": "my_custom_metric", "threshold": 0.5, "customFunctionPath": "my_module.my_function" }
 *   ]
 * }
 * ```
 *
 * @param configPath - Optional path to config file
 * @returns The eval config
 */
async function loadEvalConfig(configPath?: string): Promise<EvalConfig> {
  if (configPath) {
    const absolutePath = path.isAbsolute(configPath)
      ? configPath
      : path.join(process.cwd(), configPath);
    const content = await fs.readFile(absolutePath, 'utf-8');
    const configData = JSON.parse(content) as EvalConfigFile;

    // Convert to EvalConfig using the format-aware helper
    const metrics = getEvalMetricsFromConfig(configData);

    if (metrics.length === 0) {
      throw new Error(
        'No metrics found in config file. Provide either "criteria" or "metrics" field.'
      );
    }

    return createEvalConfig(metrics, {
      numRepeats: configData.numRepeats,
      maxParallelEvaluations: configData.maxParallelEvaluations,
      continueOnError: configData.continueOnError,
      timeoutMs: configData.timeoutMs,
    });
  }

  // Default config with common metrics
  return createEvalConfig([
    createEvalMetric(PREBUILT_METRIC_NAMES.TOOL_TRAJECTORY_AVG_SCORE, 0.8, {
      type: 'tool_trajectory',
      matchType: ToolTrajectoryMatchType.ANY_ORDER,
    }),
    createEvalMetric(PREBUILT_METRIC_NAMES.RESPONSE_MATCH_SCORE, 0.7),
  ]);
}

/**
 * Filters eval cases by their IDs.
 *
 * @param evalSet - The eval set to filter
 * @param caseFilter - Optional list of case IDs to include
 * @returns A new eval set with filtered cases
 */
function filterEvalCases(evalSet: EvalSet, caseFilter?: string[]): EvalSet {
  if (!caseFilter || caseFilter.length === 0) {
    return evalSet;
  }

  return {
    ...evalSet,
    evalCases: evalSet.evalCases.filter((ec) => caseFilter.includes(ec.evalId)),
  };
}

/**
 * Formats a single metric result for display.
 */
function formatMetricResult(metricName: string, score: number | undefined, status: EvalStatus): string {
  const statusStr = status === EvalStatus.PASSED ? '✓ PASSED'
    : status === EvalStatus.FAILED ? '✗ FAILED'
    : '? NOT_EVALUATED';
  const scoreStr = score !== undefined ? `${(score * 100).toFixed(1)}%` : 'N/A';
  return `  ${metricName}: ${scoreStr} (${statusStr})`;
}

/**
 * Prints evaluation summary for all eval sets.
 *
 * @param summaries - List of eval set summaries
 */
function printEvalSummary(summaries: EvalSetSummary[]): void {
  console.log('\n=== Evaluation Summary ===\n');

  for (const summary of summaries) {
    const passRate = summary.totalCases > 0
      ? ((summary.passedCases / summary.totalCases) * 100).toFixed(1)
      : '0.0';

    console.log(`Eval Set: ${summary.evalSetId}`);
    console.log(`  Total Cases: ${summary.totalCases}`);
    console.log(`  Passed: ${summary.passedCases} (${passRate}%)`);
    console.log(`  Failed: ${summary.failedCases}`);
    if (summary.notEvaluatedCases > 0) {
      console.log(`  Not Evaluated: ${summary.notEvaluatedCases}`);
    }
    console.log();
  }
}

/**
 * Prints detailed results for an eval set.
 *
 * @param result - The eval set result
 */
function printDetailedResults(result: EvalSetResult): void {
  console.log(`\n--- Detailed Results: ${result.evalSetId} ---\n`);

  for (const caseResult of result.evalCaseResults) {
    console.log(`Case: ${caseResult.evalCaseId}`);

    if (caseResult.errorMessage) {
      console.log(`  Error: ${caseResult.errorMessage}`);
      continue;
    }

    for (const metricResult of caseResult.overallEvalMetricResults) {
      console.log(formatMetricResult(
        metricResult.metricName,
        metricResult.score,
        metricResult.evalStatus
      ));

      if (metricResult.rationale) {
        console.log(`    Rationale: ${metricResult.rationale}`);
      }
    }
    console.log();
  }
}

/**
 * Computes summary statistics from an eval set result.
 *
 * @param result - The eval set result
 * @returns Summary statistics
 */
function computeSummary(result: EvalSetResult): EvalSetSummary {
  let passedCases = 0;
  let failedCases = 0;
  let notEvaluatedCases = 0;

  for (const caseResult of result.evalCaseResults) {
    if (caseResult.errorMessage || caseResult.overallEvalMetricResults.length === 0) {
      notEvaluatedCases++;
      continue;
    }

    // A case passes if all its metrics pass
    const allPassed = caseResult.overallEvalMetricResults.every(
      (m) => m.evalStatus === EvalStatus.PASSED
    );
    const anyFailed = caseResult.overallEvalMetricResults.some(
      (m) => m.evalStatus === EvalStatus.FAILED
    );

    if (allPassed) {
      passedCases++;
    } else if (anyFailed) {
      failedCases++;
    } else {
      notEvaluatedCases++;
    }
  }

  return {
    evalSetId: result.evalSetId,
    totalCases: result.evalCaseResults.length,
    passedCases,
    failedCases,
    notEvaluatedCases,
  };
}

/**
 * Runs evaluations for the given options.
 *
 * @param options - The evaluation options
 * @returns Exit code (0 for success, 1 for failure)
 */
export async function runEvaluation(options: EvalOptions): Promise<number> {
  try {
    console.log(`Loading agent from: ${options.agentPath}`);
    const agent = await loadAgent(options.agentPath);
    const appName = getAppName(options.agentPath);
    const baseDir = getBaseDir(options.agentPath);

    console.log(`Agent loaded: ${agent.name ?? appName}`);

    // Create eval sets manager
    const evalSetsManager = new LocalEvalSetsManager(
      options.evalStorageUri ?? baseDir
    );

    // Load eval config
    console.log('Loading evaluation config...');
    const evalConfig = await loadEvalConfig(options.configFile);
    console.log(`Metrics configured: ${evalConfig.metrics.map((m) => m.metricName).join(', ')}`);

    // Create agent evaluator
    const evaluator = createAgentEvaluator(agent, evalConfig, {appName});

    const results: EvalSetResult[] = [];
    const summaries: EvalSetSummary[] = [];

    // Process each eval set
    for (const evalSetSpec of options.evalSets) {
      const {idOrPath, caseFilter} = parseEvalSetSpec(evalSetSpec);
      console.log(`\nProcessing eval set: ${idOrPath}`);

      try {
        // Load eval set
        let evalSet = await loadEvalSet(idOrPath, evalSetsManager, appName);
        console.log(`Loaded ${evalSet.evalCases.length} cases`);

        // Apply case filter if specified
        if (caseFilter) {
          evalSet = filterEvalCases(evalSet, caseFilter);
          console.log(`Filtered to ${evalSet.evalCases.length} cases: ${caseFilter.join(', ')}`);
        }

        if (evalSet.evalCases.length === 0) {
          console.log('No cases to evaluate');
          continue;
        }

        // Run evaluation
        console.log('Running evaluation...');
        const result = await evaluator.evaluateEvalSet(evalSet);
        results.push(result);

        // Compute summary
        const summary = computeSummary(result);
        summaries.push(summary);

        // Print detailed results if requested
        if (options.printDetailedResults) {
          printDetailedResults(result);
        }

        // Save results if storage URI provided
        if (options.evalStorageUri) {
          const resultsManager = new LocalEvalSetResultsManager(options.evalStorageUri);
          await resultsManager.saveEvalSetResult(appName, result.evalSetId, result.evalCaseResults);
          console.log(`Results saved to: ${options.evalStorageUri}`);
        }
      } catch (error) {
        console.error(`Error processing eval set '${idOrPath}': ${error}`);
        summaries.push({
          evalSetId: idOrPath,
          totalCases: 0,
          passedCases: 0,
          failedCases: 0,
          notEvaluatedCases: 0,
        });
      }
    }

    // Print summary
    printEvalSummary(summaries);

    // Return exit code based on results
    const allPassed = summaries.every((s) => s.failedCases === 0 && s.notEvaluatedCases === 0);
    return allPassed ? 0 : 1;
  } catch (error) {
    console.error(`Evaluation failed: ${error}`);
    return 1;
  }
}

/**
 * Creates a new eval set.
 *
 * @param options - The create options
 */
export async function createEvalSetCommand(options: EvalSetCreateOptions): Promise<void> {
  try {
    const appName = getAppName(options.agentPath);
    const baseDir = getBaseDir(options.agentPath);

    // Create eval sets manager
    const manager = new LocalEvalSetsManager(options.evalStorageUri ?? baseDir);

    // Create the eval set
    console.log(`Creating eval set '${options.evalSetId}' for app '${appName}'...`);
    const evalSet = await manager.createEvalSet(
      appName,
      options.evalSetId,
      options.name,
      options.description
    );

    console.log(`Eval set created successfully!`);
    console.log(`  ID: ${evalSet.evalSetId}`);
    if (evalSet.name) console.log(`  Name: ${evalSet.name}`);
    if (evalSet.description) console.log(`  Description: ${evalSet.description}`);
    console.log(`  Cases: ${evalSet.evalCases.length}`);
  } catch (error) {
    console.error(`Failed to create eval set: ${error}`);
    throw error;
  }
}

/**
 * Adds eval cases to an existing eval set.
 *
 * @param options - The add case options
 */
export async function addEvalCaseCommand(options: EvalSetAddCaseOptions): Promise<void> {
  try {
    const appName = getAppName(options.agentPath);
    const baseDir = getBaseDir(options.agentPath);

    // Create eval sets manager
    const manager = new LocalEvalSetsManager(options.evalStorageUri ?? baseDir);

    // Load existing eval set
    const evalSet = await manager.getEvalSet(appName, options.evalSetId);
    if (!evalSet) {
      throw new Error(`Eval set '${options.evalSetId}' not found for app '${appName}'`);
    }

    let casesAdded = 0;

    // Load scenarios from file if provided
    if (options.scenariosFile) {
      console.log(`Loading scenarios from: ${options.scenariosFile}`);
      const scenariosPath = path.isAbsolute(options.scenariosFile)
        ? options.scenariosFile
        : path.join(process.cwd(), options.scenariosFile);

      const content = await fs.readFile(scenariosPath, 'utf-8');
      const scenarios = JSON.parse(content) as Array<{
        evalId?: string;
        scenario: ConversationScenario;
        sessionInput?: {state?: Record<string, unknown>};
      }>;

      for (let i = 0; i < scenarios.length; i++) {
        const {evalId, scenario, sessionInput} = scenarios[i];
        const caseId = evalId ?? `scenario_${Date.now()}_${i}`;

        const evalCase = createEvalCaseWithScenario(caseId, scenario, sessionInput);
        await manager.addEvalCase(appName, options.evalSetId, evalCase);
        casesAdded++;
        console.log(`  Added case: ${caseId}`);
      }
    }

    // Load session input from file if provided
    if (options.sessionInputFile) {
      console.log(`Loading session input from: ${options.sessionInputFile}`);
      const inputPath = path.isAbsolute(options.sessionInputFile)
        ? options.sessionInputFile
        : path.join(process.cwd(), options.sessionInputFile);

      const content = await fs.readFile(inputPath, 'utf-8');
      const sessionInputs = JSON.parse(content) as Array<{
        evalId: string;
        conversation?: Invocation[];
        sessionInput?: {state?: Record<string, unknown>};
      }>;

      for (const input of sessionInputs) {
        const evalCase = createEvalCase(
          input.evalId,
          input.conversation ?? [],
          input.sessionInput
        );
        await manager.addEvalCase(appName, options.evalSetId, evalCase);
        casesAdded++;
        console.log(`  Added case: ${input.evalId}`);
      }
    }

    if (casesAdded === 0) {
      console.log('No cases to add. Provide --scenarios_file or --session_input_file');
      return;
    }

    console.log(`\nSuccessfully added ${casesAdded} case(s) to eval set '${options.evalSetId}'`);
  } catch (error) {
    console.error(`Failed to add eval cases: ${error}`);
    throw error;
  }
}

/**
 * Lists eval sets for an agent.
 *
 * @param agentPath - Path to the agent
 * @param evalStorageUri - Optional storage URI
 */
export async function listEvalSetsCommand(
  agentPath: string,
  evalStorageUri?: string
): Promise<void> {
  try {
    const appName = getAppName(agentPath);
    const baseDir = getBaseDir(agentPath);

    const manager = new LocalEvalSetsManager(evalStorageUri ?? baseDir);
    const evalSetIds = await manager.listEvalSets(appName);

    console.log(`Eval sets for '${appName}':`);
    if (evalSetIds.length === 0) {
      console.log('  (none)');
      return;
    }

    for (const id of evalSetIds) {
      const evalSet = await manager.getEvalSet(appName, id);
      if (evalSet) {
        console.log(`  ${id} (${evalSet.evalCases.length} cases)`);
      } else {
        console.log(`  ${id}`);
      }
    }
  } catch (error) {
    console.error(`Failed to list eval sets: ${error}`);
    throw error;
  }
}

/**
 * Shows details of an eval set.
 *
 * @param agentPath - Path to the agent
 * @param evalSetId - ID of the eval set
 * @param evalStorageUri - Optional storage URI
 */
export async function showEvalSetCommand(
  agentPath: string,
  evalSetId: string,
  evalStorageUri?: string
): Promise<void> {
  try {
    const appName = getAppName(agentPath);
    const baseDir = getBaseDir(agentPath);

    const manager = new LocalEvalSetsManager(evalStorageUri ?? baseDir);
    const evalSet = await manager.getEvalSet(appName, evalSetId);

    if (!evalSet) {
      console.log(`Eval set '${evalSetId}' not found for app '${appName}'`);
      return;
    }

    console.log(`Eval Set: ${evalSet.evalSetId}`);
    if (evalSet.name) console.log(`Name: ${evalSet.name}`);
    if (evalSet.description) console.log(`Description: ${evalSet.description}`);
    console.log(`Created: ${new Date(evalSet.creationTimestamp).toISOString()}`);
    console.log(`Cases: ${evalSet.evalCases.length}`);

    if (evalSet.evalCases.length > 0) {
      console.log('\nEval Cases:');
      for (const evalCase of evalSet.evalCases) {
        const hasConversation = evalCase.conversation && evalCase.conversation.length > 0;
        const hasScenario = evalCase.conversationScenario !== undefined;
        const type = hasScenario ? 'scenario' : hasConversation ? 'static' : 'empty';
        console.log(`  - ${evalCase.evalId} (${type})`);
      }
    }
  } catch (error) {
    console.error(`Failed to show eval set: ${error}`);
    throw error;
  }
}

/**
 * Deletes an eval set.
 *
 * @param agentPath - Path to the agent
 * @param evalSetId - ID of the eval set to delete
 * @param evalStorageUri - Optional storage URI
 */
export async function deleteEvalSetCommand(
  agentPath: string,
  evalSetId: string,
  evalStorageUri?: string
): Promise<void> {
  try {
    const appName = getAppName(agentPath);
    const baseDir = getBaseDir(agentPath);

    const manager = new LocalEvalSetsManager(evalStorageUri ?? baseDir);
    await manager.deleteEvalSet(appName, evalSetId);

    console.log(`Eval set '${evalSetId}' deleted successfully`);
  } catch (error) {
    console.error(`Failed to delete eval set: ${error}`);
    throw error;
  }
}
