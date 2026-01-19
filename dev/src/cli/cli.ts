#! /usr/bin/env node
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'os';
import * as path from 'path';
import dotenv from 'dotenv';
import {Command, Argument, Option} from 'commander';
import {LogLevel, setLogLevel, BaseArtifactService, GcsArtifactService, applyFeatureOverrides} from '@google/adk';
import {AdkWebServer} from '../server/adk_web_server.js';
import {runAgent} from './cli_run.js';
import {deployToCloudRun, deployToAgentEngine, deployToGke} from './cli_deploy.js';
import {getTempDir} from '../utils/file_utils.js';
import { createAgent } from './cli_create.js';
import {
  createSessionServiceFromOptions,
  createArtifactServiceFromOptions,
  createMemoryServiceFromOptions,
} from './service_factory.js';
import {
  runEvaluation,
  createEvalSetCommand,
  addEvalCaseCommand,
  listEvalSetsCommand,
  showEvalSetCommand,
  deleteEvalSetCommand,
} from './cli_eval.js';
import {runConformanceRecord, runConformanceTest} from './conformance/index.js';
import {runMigrateSession} from './cli_migrate.js';

dotenv.config();

const LOG_LEVEL_MAP: Record<string, LogLevel> = {
  'debug': LogLevel.DEBUG,
  'info': LogLevel.INFO,
  'warn': LogLevel.WARN,
  'error': LogLevel.ERROR,
};

function getLogLevelFromOptions(
    options: {verbose?: boolean; log_level?: string;}) {
  if (options.verbose) {
    return LogLevel.DEBUG;
  }

  if (typeof options.log_level === 'string') {
    return LOG_LEVEL_MAP[options.log_level.toLowerCase()] || LogLevel.INFO;
  }

  return LogLevel.INFO;
}

function getAbsolutePath(p: string): string {
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

function getArtifactServiceFromUri(uri: string): BaseArtifactService {
  if (uri.startsWith('gs://')) {
    const bucket = uri.split('://')[1];

    return new GcsArtifactService(bucket);
  }

  throw new Error(`Unsupported artifact service URI: ${uri}`);
}

const AGENT_DIR_ARGUMENT =
    new Argument(
        '[agents_dir]',
        'Agent file or directory of agents to serve. For directory the internal structure should be agents_dir/{agentName}.js or agents_dir/{agentName}/agent.js. Agent file should has export of the rootAgent as instance of BaseAgent (e.g LlmAgent)')
        .default(process.cwd());
const HOST_OPTION =
    new Option(
        '-h, --host <string>', 'Optional. The binding host of the server')
        .default(os.hostname());
const PORT_OPTION =
    new Option('-p, --port <number>', 'Optional. The port of the server')
        .default('8000');
const ORIGINS_OPTION =
    new Option(
        '--allow_origins <string>', 'Optional. The allow origins of the server')
        .default('');
const VERBOSE_OPTION =
    new Option(
        '-v, --verbose [boolean]', 'Optional. The verbose level of the server')
        .default(false);
const LOG_LEVEL_OPTION =
    new Option('--log_level <string>', 'Optional. The log level of the server')
        .default('info');
const ARTIFACT_SERVICE_URI_OPTION = new Option(
    '--artifact_service_uri <string>',
    'Optional. The URI of the artifact service. Supported URIs: gs://<bucket> for GCS, memory:// for in-memory.');

const SESSION_SERVICE_URI_OPTION = new Option(
    '--session_service_uri <string>',
    'Optional. The URI of the session service. Supported URIs: sqlite:///<path>, agentengine://<resource>, memory:// for in-memory.');

const USE_LOCAL_STORAGE_OPTION = new Option(
    '--use_local_storage [boolean]',
    'Optional. Whether to use local .adk storage for sessions/artifacts when no URI is provided (default: true).')
    .default(true);

const MEMORY_SERVICE_URI_OPTION = new Option(
    '--memory_service_uri <string>',
    'Optional. The URI of the memory service. Supported URIs: agentengine://<resource>, rag://<corpus_id>, memory:// for in-memory.');

const A2A_OPTION = new Option(
    '--a2a [boolean]',
    'Optional. Enable Agent-to-Agent protocol endpoints (default: false).')
    .default(false);

const EVAL_STORAGE_URI_OPTION = new Option(
    '--eval_storage_uri <string>',
    'Optional. Storage URI for evaluation results. Supported URIs: gs://<bucket> for GCS.');

const URL_PREFIX_OPTION = new Option(
    '--url_prefix <string>',
    'Optional. URL path prefix for reverse proxy/API gateway mounting.');

const LOGO_TEXT_OPTION = new Option(
    '--logo_text <string>',
    'Optional. Text to display in web UI logo.');

const LOGO_IMAGE_URL_OPTION = new Option(
    '--logo_image_url <string>',
    'Optional. URL of image to display in web UI logo.');

const program = new Command('ADK CLI');

const TRACE_TO_CLOUD_OPTION = new Option(
    '--trace_to_cloud [boolean]',
    'Optional. Whether to enable cloud trace for telemetry.')
    .default(false);

const ENABLE_FEATURES_OPTION = new Option(
    '--enable_features <features...>',
    'Optional. Comma-separated list of feature names to enable. ' +
    'This provides an alternative to environment variables for enabling experimental features. ' +
    'Example: --enable_features JSON_SCHEMA_FOR_FUNC_DECL,PROGRESSIVE_SSE_STREAMING');

/**
 * Apply feature overrides from CLI options.
 *
 * @param options The CLI options object.
 */
function maybeApplyFeatureOverrides(options: Record<string, unknown>): void {
  const enableFeatures = options['enable_features'];
  if (enableFeatures && Array.isArray(enableFeatures)) {
    applyFeatureOverrides(enableFeatures as string[]);
  }
}

program.command('web')
    .description('Start ADK web server')
    .addArgument(AGENT_DIR_ARGUMENT)
    .addOption(HOST_OPTION)
    .addOption(PORT_OPTION)
    .addOption(ORIGINS_OPTION)
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .addOption(ARTIFACT_SERVICE_URI_OPTION)
    .addOption(SESSION_SERVICE_URI_OPTION)
    .addOption(MEMORY_SERVICE_URI_OPTION)
    .addOption(USE_LOCAL_STORAGE_OPTION)
    .addOption(TRACE_TO_CLOUD_OPTION)
    .addOption(A2A_OPTION)
    .addOption(EVAL_STORAGE_URI_OPTION)
    .addOption(URL_PREFIX_OPTION)
    .addOption(LOGO_TEXT_OPTION)
    .addOption(LOGO_IMAGE_URL_OPTION)
    .addOption(ENABLE_FEATURES_OPTION)
    .action(async (agentsDir: string, options: Record<string, string>) => {
      maybeApplyFeatureOverrides(options);
      setLogLevel(getLogLevelFromOptions(options));

      const absoluteAgentsDir = getAbsolutePath(agentsDir);
      const useLocalStorage = String(options['use_local_storage']) !== 'false';

      // Create services from URI options (supports Cloud Run/K8s detection)
      const sessionService = await createSessionServiceFromOptions({
        baseDir: absoluteAgentsDir,
        sessionServiceUri: options['session_service_uri'],
        useLocalStorage,
      });

      const artifactService = await createArtifactServiceFromOptions({
        baseDir: absoluteAgentsDir,
        artifactServiceUri: options['artifact_service_uri'],
        useLocalStorage,
      });

      const memoryService = await createMemoryServiceFromOptions({
        baseDir: absoluteAgentsDir,
        memoryServiceUri: options['memory_service_uri'],
      });

      const server = new AdkWebServer({
        agentsDir: absoluteAgentsDir,
        host: options['host'],
        port: parseInt(options['port'], 10),
        serveDebugUI: true,
        allowOrigins: options['allow_origins'],
        sessionService,
        artifactService,
        memoryService,
        traceToCloud: !!options['trace_to_cloud'],
        enableA2a: !!options['a2a'],
        evalStorageUri: options['eval_storage_uri'],
        urlPrefix: options['url_prefix'],
        logoText: options['logo_text'],
        logoImageUrl: options['logo_image_url'],
      });

      server.start();
    });

program.command('api_server')
    .description('Start ADK API server')
    .addArgument(AGENT_DIR_ARGUMENT)
    .addOption(HOST_OPTION)
    .addOption(PORT_OPTION)
    .addOption(ORIGINS_OPTION)
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .addOption(ARTIFACT_SERVICE_URI_OPTION)
    .addOption(SESSION_SERVICE_URI_OPTION)
    .addOption(MEMORY_SERVICE_URI_OPTION)
    .addOption(USE_LOCAL_STORAGE_OPTION)
    .addOption(TRACE_TO_CLOUD_OPTION)
    .addOption(A2A_OPTION)
    .addOption(URL_PREFIX_OPTION)
    .addOption(ENABLE_FEATURES_OPTION)
    .action(async (agentsDir: string, options: Record<string, string>) => {
      maybeApplyFeatureOverrides(options);
      setLogLevel(getLogLevelFromOptions(options));

      const absoluteAgentsDir = getAbsolutePath(agentsDir);
      const useLocalStorage = String(options['use_local_storage']) !== 'false';

      // Create services from URI options (supports Cloud Run/K8s detection)
      const sessionService = await createSessionServiceFromOptions({
        baseDir: absoluteAgentsDir,
        sessionServiceUri: options['session_service_uri'],
        useLocalStorage,
      });

      const artifactService = await createArtifactServiceFromOptions({
        baseDir: absoluteAgentsDir,
        artifactServiceUri: options['artifact_service_uri'],
        useLocalStorage,
      });

      const memoryService = await createMemoryServiceFromOptions({
        baseDir: absoluteAgentsDir,
        memoryServiceUri: options['memory_service_uri'],
      });

      const server = new AdkWebServer({
        agentsDir: absoluteAgentsDir,
        host: options['host'],
        port: parseInt(options['port'], 10),
        serveDebugUI: false,
        allowOrigins: options['allow_origins'],
        sessionService,
        artifactService,
        memoryService,
        traceToCloud: !!options['trace_to_cloud'],
        enableA2a: !!options['a2a'],
        urlPrefix: options['url_prefix'],
      });
      server.start();
    });

program.command('create')
    .description('Creates a new agent')
    .argument('[agent]', 'Name to give the new agent', 'adk_agent')
    .option('-y, --yes', 'Optional. Skip confirmation prompts.')
    .option('--model <string>', 'Optional. THe model used for the root_agent')
    .option(
        '--api_key <string>',
        'Optional. The API Key needed to access the model, e.g. Google AI API Key.')
    .option(
        '--project <string>',
        'Optional. The Google Cloud Project for using VertexAI as backend.')
    .option(
        '--region <string>',
        'Optional. The Google Cloud Region for using VertexAI as backend.')
    .option(
        '--language <string>',
        'Optional. Either ts or js as the language to output.')
    .action((agentName: string, options: Record<string, string>) => {
      createAgent({
        agentName,
        forceYes: !!options['yes'],
        model: options['model'],
        apiKey: options['api_key'],
        project: options['project'],
        region: options['region'],
        language: options['language'],
      });
    });


program.command('run')
    .description('Runs agent')
    .argument('<agent>', 'Agent file path (.js or .ts)')
    .option(
        '--save_session [boolean]',
        'Optional. Whether to save the session to a json file on exit.', false)
    .option(
        '--session_id <string>',
        'Optional. The session ID to save the session to on exit when --save_session is set to true. User will be prompted to enter a session ID if not set.')
    .option(
        '--replay <string>',
        'The json file that contains the initial state of the session and user queries. A new session will be created using this state. And user queries are run against the newly created session. Users cannot continue to interact with the agent.')
    .option(
        '--resume <string>',
        'The json file that contains a previously saved session (by --save_session option). The previous session will be re-displayed. And user can continue to interact with the agent.')
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .addOption(ARTIFACT_SERVICE_URI_OPTION)
    .addOption(SESSION_SERVICE_URI_OPTION)
    .addOption(USE_LOCAL_STORAGE_OPTION)
    .addOption(ENABLE_FEATURES_OPTION)
    .action(async (agentPath: string, options: Record<string, string>) => {
      maybeApplyFeatureOverrides(options);
      setLogLevel(getLogLevelFromOptions(options));

      const baseDir = path.dirname(getAbsolutePath(agentPath));
      const useLocalStorage = String(options['use_local_storage']) !== 'false';

      // Create services from options (supports URI-based configuration)
      const sessionService = await createSessionServiceFromOptions({
        baseDir,
        sessionServiceUri: options['session_service_uri'],
        useLocalStorage,
      });

      const artifactService = await createArtifactServiceFromOptions({
        baseDir,
        artifactServiceUri: options['artifact_service_uri'],
        useLocalStorage,
      });

      runAgent({
        agentPath,
        inputFile: options['replay'],
        savedSessionFile: options['resume'],
        saveSession: !!options['save_session'],
        sessionId: options['session_id'],
        artifactService,
        sessionService,
      });
    });

const DEPLOY_COMMAND = program.command('deploy')
                           .description('Deploy agent')
                           .allowUnknownOption()
                           .allowExcessArguments();

DEPLOY_COMMAND.command('cloud_run')
    .addArgument(AGENT_DIR_ARGUMENT)
    .addOption(PORT_OPTION)
    .option(
        '--project [string]',
        'Optional. Google Cloud project to deploy the agent. If not set, default project from gcloud config is used')
    .option(
        '--region [string]',
        'Optional. Google Cloud region to deploy the agent. If not set, default run/region from gcloud config is used')
    .option(
        '--service_name [string]',
        'Optional. The service name to use in Cloud Run. Default: "adk-default-service-name"',
        'adk-default-service-name')
    .option(
        '--temp_folder [string]',
        'Optional. Temp folder for the generated Cloud Run source files (default: a timestamped folder in the system temp directory).',
        getTempDir('cloud_run_deploy_src'))
    .option(
        '--adk_version [string]',
        'Optional. ADK version to use in the Cloud Run service. If not set, default to the latest version available on npm',
        'latest')
    .option(
        '--with_ui [boolean]',
        'Optional. Deploy ADK Web UI if set. (default: deploy ADK API server only)',
        false)
    .option(
        '--trace_to_cloud [boolean]',
        'Optional. Whether to enable cloud trace for telemetry.',
        false)
    .addOption(ORIGINS_OPTION)
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .addOption(ARTIFACT_SERVICE_URI_OPTION)
    .action((agentPath: string, options: Record<string, string>) => {
      const extraGcloudArgs = [];
      for (const arg of process.argv.slice(5)) {
        let argName = arg.replace(/^-+/, '');
        if (argName.includes('=')) {
          argName = argName.split('=')[0];
        }
        if (argName in options) {
          continue;
        }

        extraGcloudArgs.push(arg);
      }

      deployToCloudRun({
        agentPath: getAbsolutePath(agentPath),
        project: options['project'],
        region: options['region'],
        serviceName: options['service_name'],
        tempFolder: options['temp_folder'],
        port: parseInt(options['port'], 10),
        withUi: !!options['with_ui'],
        logLevel: options['log_level'],
        adkVersion: options['adk_version'],
        allowOrigins: options['allow_origins'],
        extraGcloudArgs,
        artifactServiceUri: options['artifact_service_uri'],
        traceToCloud: !!options['trace_to_cloud'],
      });
    });

DEPLOY_COMMAND.command('agent_engine')
    .description('Deploy agent to Vertex AI Agent Engine')
    .addArgument(AGENT_DIR_ARGUMENT)
    .option(
        '--project [string]',
        'Optional. Google Cloud project ID. If not set, uses default from gcloud config or .env')
    .option(
        '--region [string]',
        'Optional. Google Cloud region. If not set, uses default from gcloud config or .env')
    .option(
        '--api_key [string]',
        'Optional. API key for Express Mode. Overrides GOOGLE_API_KEY from .env')
    .option(
        '--agent_engine_id [string]',
        'Optional. Agent Engine ID to update. If not set, creates a new Agent Engine')
    .option(
        '--display_name [string]',
        'Optional. Display name for the Agent Engine')
    .option(
        '--description [string]',
        'Optional. Description of the Agent Engine')
    .option(
        '--adk_app [string]',
        'Optional. Name of the ADK app module file (without extension)',
        'agent_engine_app')
    .option(
        '--adk_app_object [string]',
        'Optional. The ADK app object to use: "rootAgent", "root_agent", or "app"',
        'rootAgent')
    .option(
        '--temp_folder [string]',
        'Optional. Temp folder for the generated Agent Engine source files')
    .option(
        '--env_file [string]',
        'Optional. Path to .env file for environment variables')
    .option(
        '--agent_engine_config_file [string]',
        'Optional. Path to .agent_engine_config.json file')
    .option(
        '--trace_to_cloud [boolean]',
        'Optional. Whether to enable Cloud Trace for telemetry',
        false)
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .action(async (agentPath: string, options: Record<string, string>) => {
      setLogLevel(getLogLevelFromOptions(options));

      await deployToAgentEngine({
        agentPath: getAbsolutePath(agentPath),
        project: options['project'],
        region: options['region'],
        apiKey: options['api_key'],
        agentEngineId: options['agent_engine_id'],
        displayName: options['display_name'],
        description: options['description'],
        adkApp: options['adk_app'],
        adkAppObject: options['adk_app_object'],
        tempFolder: options['temp_folder'],
        envFile: options['env_file'],
        agentEngineConfigFile: options['agent_engine_config_file'],
        traceToCloud: !!options['trace_to_cloud'],
      });
    });

DEPLOY_COMMAND.command('gke')
    .description('Deploy agent to Google Kubernetes Engine (GKE)')
    .addArgument(AGENT_DIR_ARGUMENT)
    .addOption(PORT_OPTION)
    .option(
        '--project [string]',
        'Optional. Google Cloud project ID. If not set, uses default from gcloud config')
    .option(
        '--region [string]',
        'Optional. Google Cloud region. If not set, uses default from gcloud config')
    .requiredOption(
        '--cluster_name <string>',
        'Required. The name of the GKE cluster to deploy to')
    .option(
        '--service_name [string]',
        'Optional. The service name in GKE. Default: "adk-default-service-name"',
        'adk-default-service-name')
    .option(
        '--temp_folder [string]',
        'Optional. Temp folder for the generated GKE deployment files',
        getTempDir('gke_deploy_src'))
    .option(
        '--adk_version [string]',
        'Optional. ADK version to use. Default: "latest"',
        'latest')
    .option(
        '--with_ui [boolean]',
        'Optional. Deploy ADK Web UI if set. (default: deploy ADK API server only)',
        false)
    .option(
        '--trace_to_cloud [boolean]',
        'Optional. Whether to enable cloud trace for telemetry.',
        false)
    .addOption(ORIGINS_OPTION)
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .addOption(ARTIFACT_SERVICE_URI_OPTION)
    .action(async (agentPath: string, options: Record<string, string>) => {
      setLogLevel(getLogLevelFromOptions(options));

      await deployToGke({
        agentPath: getAbsolutePath(agentPath),
        project: options['project'],
        region: options['region'],
        clusterName: options['cluster_name'],
        serviceName: options['service_name'],
        tempFolder: options['temp_folder'],
        port: parseInt(options['port'], 10),
        withUi: !!options['with_ui'],
        logLevel: options['log_level'],
        adkVersion: options['adk_version'],
        allowOrigins: options['allow_origins'],
        artifactServiceUri: options['artifact_service_uri'],
        traceToCloud: !!options['trace_to_cloud'],
      });
    });

// Evaluation command
program.command('eval')
    .description('Run evaluations on an agent using eval sets')
    .argument('<agent>', 'Agent file path (.js or .ts)')
    .argument('[eval_sets...]', 'Eval set file paths or IDs (format: id or id:case1,case2)')
    .option(
        '--config <path>',
        'Optional. Path to evaluation config file (JSON). Default uses tool_trajectory and response_match metrics.')
    .option(
        '--print_detailed_results [boolean]',
        'Optional. Print detailed results for each eval case.',
        false)
    .addOption(EVAL_STORAGE_URI_OPTION)
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .addOption(ENABLE_FEATURES_OPTION)
    .action(async (agentPath: string, evalSets: string[], options: Record<string, string | boolean>) => {
      maybeApplyFeatureOverrides(options as Record<string, unknown>);
      setLogLevel(getLogLevelFromOptions(options as {verbose?: boolean; log_level?: string}));

      const exitCode = await runEvaluation({
        agentPath: getAbsolutePath(agentPath),
        evalSets,
        configFile: options['config'] as string | undefined,
        printDetailedResults: !!options['print_detailed_results'],
        evalStorageUri: options['eval_storage_uri'] as string | undefined,
      });

      process.exit(exitCode);
    });

// Eval set management commands
const EVAL_SET_COMMAND = program.command('eval_set')
    .description('Manage evaluation sets')
    .allowUnknownOption()
    .allowExcessArguments();

EVAL_SET_COMMAND.command('create')
    .description('Create a new eval set')
    .argument('<agent>', 'Agent file path (.js or .ts)')
    .argument('<eval_set_id>', 'ID for the new eval set')
    .option('--name <string>', 'Optional. Human-readable name for the eval set')
    .option('--description <string>', 'Optional. Description of the eval set')
    .addOption(EVAL_STORAGE_URI_OPTION)
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .action(async (agentPath: string, evalSetId: string, options: Record<string, string>) => {
      setLogLevel(getLogLevelFromOptions(options));

      await createEvalSetCommand({
        agentPath: getAbsolutePath(agentPath),
        evalSetId,
        name: options['name'],
        description: options['description'],
        evalStorageUri: options['eval_storage_uri'],
      });
    });

EVAL_SET_COMMAND.command('add_eval_case')
    .description('Add eval cases to an existing eval set')
    .argument('<agent>', 'Agent file path (.js or .ts)')
    .argument('<eval_set_id>', 'ID of the eval set')
    .option(
        '--scenarios_file <path>',
        'Optional. Path to JSON file with conversation scenarios')
    .option(
        '--session_input_file <path>',
        'Optional. Path to JSON file with session inputs')
    .addOption(EVAL_STORAGE_URI_OPTION)
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .action(async (agentPath: string, evalSetId: string, options: Record<string, string>) => {
      setLogLevel(getLogLevelFromOptions(options));

      await addEvalCaseCommand({
        agentPath: getAbsolutePath(agentPath),
        evalSetId,
        scenariosFile: options['scenarios_file'],
        sessionInputFile: options['session_input_file'],
        evalStorageUri: options['eval_storage_uri'],
      });
    });

EVAL_SET_COMMAND.command('list')
    .description('List all eval sets for an agent')
    .argument('<agent>', 'Agent file path (.js or .ts)')
    .addOption(EVAL_STORAGE_URI_OPTION)
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .action(async (agentPath: string, options: Record<string, string>) => {
      setLogLevel(getLogLevelFromOptions(options));
      await listEvalSetsCommand(getAbsolutePath(agentPath), options['eval_storage_uri']);
    });

EVAL_SET_COMMAND.command('show')
    .description('Show details of an eval set')
    .argument('<agent>', 'Agent file path (.js or .ts)')
    .argument('<eval_set_id>', 'ID of the eval set')
    .addOption(EVAL_STORAGE_URI_OPTION)
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .action(async (agentPath: string, evalSetId: string, options: Record<string, string>) => {
      setLogLevel(getLogLevelFromOptions(options));
      await showEvalSetCommand(getAbsolutePath(agentPath), evalSetId, options['eval_storage_uri']);
    });

EVAL_SET_COMMAND.command('delete')
    .description('Delete an eval set')
    .argument('<agent>', 'Agent file path (.js or .ts)')
    .argument('<eval_set_id>', 'ID of the eval set to delete')
    .addOption(EVAL_STORAGE_URI_OPTION)
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .action(async (agentPath: string, evalSetId: string, options: Record<string, string>) => {
      setLogLevel(getLogLevelFromOptions(options));
      await deleteEvalSetCommand(getAbsolutePath(agentPath), evalSetId, options['eval_storage_uri']);
    });

// Conformance testing commands
const CONFORMANCE_COMMAND = program.command('conformance')
    .description('Run conformance tests for regression testing')
    .allowUnknownOption()
    .allowExcessArguments();

CONFORMANCE_COMMAND.command('record')
    .description('Record agent interactions for conformance tests')
    .argument('[paths...]', 'Directories containing test cases (spec.yaml files)', ['tests/'])
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .action(async (paths: string[], options: Record<string, string>) => {
      setLogLevel(getLogLevelFromOptions(options));
      const absolutePaths = paths.map(p => getAbsolutePath(p));
      await runConformanceRecord(absolutePaths);
    });

CONFORMANCE_COMMAND.command('test')
    .description('Run conformance tests against recorded interactions')
    .argument('[paths...]', 'Directories containing test cases (spec.yaml files)', ['tests/'])
    .option(
        '--mode <string>',
        'Test mode: "replay" (use recorded responses) or "live" (make real calls)',
        'replay')
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .action(async (paths: string[], options: Record<string, string>) => {
      setLogLevel(getLogLevelFromOptions(options));
      const absolutePaths = paths.map(p => getAbsolutePath(p));
      const mode = options['mode'] as 'replay' | 'live';
      const exitCode = await runConformanceTest(absolutePaths, mode);
      process.exit(exitCode);
    });

// Migration commands
const MIGRATE_COMMAND = program.command('migrate')
    .description('Migrate data between different storage backends')
    .allowUnknownOption()
    .allowExcessArguments();

MIGRATE_COMMAND.command('session')
    .description('Migrate session data from one storage backend to another')
    .requiredOption(
        '--source_uri <string>',
        'Source session service URI (e.g., sqlite:///old.db, agentengine://<resource>)')
    .requiredOption(
        '--dest_uri <string>',
        'Destination session service URI (e.g., sqlite:///new.db, agentengine://<resource>)')
    .requiredOption(
        '--app_name <string>',
        'App name to filter sessions')
    .requiredOption(
        '--user_id <string>',
        'User ID to filter sessions')
    .option(
        '--skip_existing [boolean]',
        'Skip sessions that already exist in destination (default: true)',
        true)
    .option(
        '--limit <number>',
        'Maximum number of sessions to migrate (useful for testing)')
    .option(
        '--dry_run [boolean]',
        'Run in dry-run mode without making any writes',
        false)
    .addOption(VERBOSE_OPTION)
    .addOption(LOG_LEVEL_OPTION)
    .action(async (options: Record<string, string | boolean>) => {
      setLogLevel(getLogLevelFromOptions(options as {verbose?: boolean; log_level?: string}));

      const exitCode = await runMigrateSession({
        source_uri: options['source_uri'] as string,
        dest_uri: options['dest_uri'] as string,
        app_name: options['app_name'] as string,
        user_id: options['user_id'] as string,
        skip_existing: options['skip_existing'] !== false,
        limit: options['limit'] as string | undefined,
        dry_run: !!options['dry_run'],
      });

      process.exit(exitCode);
    });

program.parse(process.argv);