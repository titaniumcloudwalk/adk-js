/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {exec, spawn} from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {promisify} from 'node:util';

import {AgentFileBundleMode, AgentLoader} from '../utils/agent_loader.js';
import {isFile, isFolderExists, loadFileData, saveToFile, tryToFindFileRecursively} from '../utils/file_utils.js';

const execAsync = promisify(exec);
const spawnAsync = promisify(spawn);

const REQUIRED_NPM_PACKAGES = ['@google/adk'];

// Agent Engine specific constants
const ADK_PACKAGE_NAME = '@google/adk';

/**
 * Agent Engine class methods definition for the ADK API.
 * These define the methods that will be exposed by the Agent Engine.
 */
const AGENT_ENGINE_CLASS_METHODS = [
  {
    name: 'get_session',
    description: 'Deprecated. Use async_get_session instead.\n\n        Get a session for the given user.',
    parameters: {
      properties: {
        user_id: {type: 'string'},
        session_id: {type: 'string'},
      },
      required: ['user_id', 'session_id'],
      type: 'object',
    },
    api_mode: '',
  },
  {
    name: 'list_sessions',
    description: 'Deprecated. Use async_list_sessions instead.\n\n        List sessions for the given user.',
    parameters: {
      properties: {user_id: {type: 'string'}},
      required: ['user_id'],
      type: 'object',
    },
    api_mode: '',
  },
  {
    name: 'create_session',
    description: 'Deprecated. Use async_create_session instead.\n\n        Creates a new session.',
    parameters: {
      properties: {
        user_id: {type: 'string'},
        session_id: {type: 'string', nullable: true},
        state: {type: 'object', nullable: true},
      },
      required: ['user_id'],
      type: 'object',
    },
    api_mode: '',
  },
  {
    name: 'delete_session',
    description: 'Deprecated. Use async_delete_session instead.\n\n        Deletes a session for the given user.',
    parameters: {
      properties: {
        user_id: {type: 'string'},
        session_id: {type: 'string'},
      },
      required: ['user_id', 'session_id'],
      type: 'object',
    },
    api_mode: '',
  },
  {
    name: 'async_get_session',
    description: 'Get a session for the given user.\n\n        Args:\n            user_id (str): Required. The ID of the user.\n            session_id (str): Required. The ID of the session.\n\n        Returns:\n            Session: The session instance (if any). It returns None if the session is not found.',
    parameters: {
      properties: {
        user_id: {type: 'string'},
        session_id: {type: 'string'},
      },
      required: ['user_id', 'session_id'],
      type: 'object',
    },
    api_mode: 'async',
  },
  {
    name: 'async_list_sessions',
    description: 'List sessions for the given user.\n\n        Args:\n            user_id (str): Required. The ID of the user.\n\n        Returns:\n            ListSessionsResponse: The list of sessions.',
    parameters: {
      properties: {user_id: {type: 'string'}},
      required: ['user_id'],
      type: 'object',
    },
    api_mode: 'async',
  },
  {
    name: 'async_create_session',
    description: 'Creates a new session.\n\n        Args:\n            user_id (str): Required. The ID of the user.\n            session_id (str): Optional. The ID of the session.\n            state (dict): Optional. The initial state of the session.\n\n        Returns:\n            Session: The newly created session instance.',
    parameters: {
      properties: {
        user_id: {type: 'string'},
        session_id: {type: 'string', nullable: true},
        state: {type: 'object', nullable: true},
      },
      required: ['user_id'],
      type: 'object',
    },
    api_mode: 'async',
  },
  {
    name: 'async_delete_session',
    description: 'Deletes a session for the given user.\n\n        Args:\n            user_id (str): Required. The ID of the user.\n            session_id (str): Required. The ID of the session.',
    parameters: {
      properties: {
        user_id: {type: 'string'},
        session_id: {type: 'string'},
      },
      required: ['user_id', 'session_id'],
      type: 'object',
    },
    api_mode: 'async',
  },
  {
    name: 'async_add_session_to_memory',
    description: 'Generates memories.\n\n        Args:\n            session (Dict[str, Any]): Required. The session to use for generating memories.',
    parameters: {
      properties: {
        session: {additionalProperties: true, type: 'object'},
      },
      required: ['session'],
      type: 'object',
    },
    api_mode: 'async',
  },
  {
    name: 'async_search_memory',
    description: 'Searches memories for the given user.\n\n        Args:\n            user_id: The id of the user.\n            query: The query to match the memories on.\n\n        Returns:\n            A SearchMemoryResponse containing the matching memories.',
    parameters: {
      properties: {
        user_id: {type: 'string'},
        query: {type: 'string'},
      },
      required: ['user_id', 'query'],
      type: 'object',
    },
    api_mode: 'async',
  },
  {
    name: 'stream_query',
    description: 'Deprecated. Use async_stream_query instead.\n\n        Streams responses from the ADK application in response to a message.',
    parameters: {
      properties: {
        message: {
          anyOf: [
            {type: 'string'},
            {additionalProperties: true, type: 'object'},
          ],
        },
        user_id: {type: 'string'},
        session_id: {type: 'string', nullable: true},
        run_config: {type: 'object', nullable: true},
      },
      required: ['message', 'user_id'],
      type: 'object',
    },
    api_mode: 'stream',
  },
  {
    name: 'async_stream_query',
    description: 'Streams responses asynchronously from the ADK application.\n\n        Args:\n            message (str): Required. The message to stream responses for.\n            user_id (str): Required. The ID of the user.\n            session_id (str): Optional. The ID of the session.\n            run_config (dict): Optional. The run config to use for the query.\n\n        Yields:\n            Event dictionaries asynchronously.',
    parameters: {
      properties: {
        message: {
          anyOf: [
            {type: 'string'},
            {additionalProperties: true, type: 'object'},
          ],
        },
        user_id: {type: 'string'},
        session_id: {type: 'string', nullable: true},
        run_config: {type: 'object', nullable: true},
      },
      required: ['message', 'user_id'],
      type: 'object',
    },
    api_mode: 'async_stream',
  },
  {
    name: 'streaming_agent_run_with_events',
    description: 'Streams responses asynchronously from the ADK application.\n\n        This method is primarily meant for invocation from AgentSpace.\n\n        Args:\n            request_json (str): Required. The request to stream responses for.',
    parameters: {
      properties: {request_json: {type: 'string'}},
      required: ['request_json'],
      type: 'object',
    },
    api_mode: 'async_stream',
  },
];

/**
 * Template for generating the Agent Engine app module (JavaScript/TypeScript).
 * This creates the entrypoint file that Agent Engine will use to run the agent.
 */
function generateAgentEngineAppTemplate(options: {
  appName: string;
  traceToCloud: boolean;
  isConfigAgent: boolean;
  agentFolder: string;
  adkAppObject: string;
  adkAppType: string;
  expressMode: boolean;
}): string {
  const {
    traceToCloud,
    isConfigAgent,
    agentFolder,
    adkAppObject,
    adkAppType,
    expressMode,
  } = options;

  // Note: TypeScript/JavaScript uses different import/initialization patterns
  // For now, we generate a JavaScript module that can be used with Agent Engine
  return `
// Auto-generated Agent Engine app entrypoint
import * as vertexai from '@google-cloud/vertexai';

${isConfigAgent ? `
// Config agent - load from YAML
import { configAgentUtils } from '@google/adk';
const rootAgent = configAgentUtils.fromConfig('${agentFolder}/root_agent.yaml');
` : `
// Code-based agent - import from agent module
import { ${adkAppObject} } from './agent.js';
`}

// Initialize Vertex AI
${expressMode ? `
// Express Mode with API key
vertexai.init({ apiKey: process.env.GOOGLE_API_KEY });
` : `
// Standard Vertex AI initialization
vertexai.init({
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.GOOGLE_CLOUD_LOCATION,
});
`}

// Create the AdkApp instance
export const adkApp = {
  ${adkAppType}: ${adkAppObject},
  enableTracing: ${traceToCloud},
};
`.trim();
}

export interface CreateDockerFileContentOptions {
  appName?: string;
  project: string;
  region?: string;
  port: number;
  withUi: boolean;
  logLevel: string;
  allowOrigins?: string;
  artifactServiceUri?: string;
  traceToCloud?: boolean;
}

export interface DeployToCloudRunOptions extends
    CreateDockerFileContentOptions {
  agentPath: string;
  serviceName: string;
  tempFolder: string;
  adkVersion: string;
  extraGcloudArgs?: string[];
}

function validateGcloudExtraArgs(
    extraGcloudArgs: string[],
    adkManagedArgs: string[],
) {
  const userArgNames = new Set<string>();
  for (const arg of extraGcloudArgs) {
    if (arg.startsWith('--')) {
      const argName = arg.split('=')[0];
      userArgNames.add(argName);
    }
  }

  const conflicts = adkManagedArgs.filter(arg => userArgNames.has(arg)).sort();
  if (conflicts.length) {
    throw new Error(`The argument(s) ${
        conflicts.join(
            ', ')} conflict with ADK's automatic configuration. ADK will set these arguments automatically, so please remove them from your command.`);
  }
}

async function copyAgentFiles(
    agentLoader: AgentLoader,
    targetPath: string,
    ): Promise<void> {
  const agentNames = await agentLoader.listAgents();

  for (const agentName of agentNames) {
    const agentFile = await agentLoader.getAgentFile(agentName);
    const fileName = path.parse(agentFile.getFilePath()).base;

    await fs.cp(
        agentFile.getFilePath(),
        path.join(targetPath, fileName),
    );
  }
}

function prepareGCloudArguments(options: DeployToCloudRunOptions): string[] {
  const regionOptions: string[] =
      options.region ? ['--region', options.region] : [];
  const adkManagedArgs = ['--source', '--project', '--port', '--verbosity'];
  if (options.region) {
    adkManagedArgs.push('--region');
  }

  if (options.extraGcloudArgs) {
    validateGcloudExtraArgs(options.extraGcloudArgs, adkManagedArgs);
  }

  const gcloudCommands: string[] = [
    'run',
    'deploy',
    options.serviceName,
    '--source',
    options.tempFolder,
    '--project',
    options.project,
    ...regionOptions,
    '--port',
    options.port.toString(),
    '--verbosity',
    options.logLevel.toLowerCase(),
  ];

  const userLabels = [];
  const extraArgsWithoutLabels = [];
  if (options.extraGcloudArgs?.length) {
    for (const arg of options.extraGcloudArgs) {
      if (arg === '--labels') {
        userLabels.push(arg.slice(9));
      } else {
        extraArgsWithoutLabels.push(arg);
      }
    }
  }

  const allLabels = ['created-by=adk', ...userLabels];
  gcloudCommands.push('--labels', allLabels.join(','));
  gcloudCommands.push(...extraArgsWithoutLabels);

  return gcloudCommands;
}

async function createPackageJson(
    sourceFolder: string,
    targetFolder: string,
) {
  const packageJsonPath =
      await tryToFindFileRecursively(sourceFolder, 'package.json', 3);
  const packageJson =
      await loadFileData<{dependencies: Record<string, string>}>(
          packageJsonPath);
  if (!packageJson || !packageJson.dependencies) {
    throw new Error(
        `No dependencies found in package.json: ${packageJsonPath}`);
  }
  for (const requiredDep of REQUIRED_NPM_PACKAGES) {
    if (!(requiredDep in packageJson.dependencies)) {
      throw new Error(`Package "${
          requiredDep}" is required but not found in package.json: ${
          packageJsonPath}`);
    }
  }

  const targetPackageJsonPath = path.join(targetFolder, 'package.json');

  await Promise.all([
    fs.mkdir(path.join(targetFolder, 'node_modules')),
    saveToFile(path.join(targetFolder, 'package-lock.json'), ''),
    saveToFile(targetPackageJsonPath, {dependencies: packageJson.dependencies}),
  ]);
  console.info('Creating package.json complete', targetPackageJsonPath);
}

function createDockerFileContent(
    options: CreateDockerFileContentOptions,
    ): string {
  const adkCommand = options.withUi ? 'web' : 'api_server';
  const adkServerOptions = [
    `--port=${options.port}`,
    '--host=0.0.0.0',
  ];

  if (options.logLevel) {
    adkServerOptions.push(`--log_level=${options.logLevel}`);
  }

  if (options.allowOrigins) {
    adkServerOptions.push(`--allow_origins=${options.allowOrigins}`);
  }

  if (options.artifactServiceUri) {
    adkServerOptions.push(
        `--artifact_service_uri=${options.artifactServiceUri}`);
  }

  if (options.traceToCloud) {
    adkServerOptions.push('--trace_to_cloud');
  }

  return `
FROM node:lts-alpine
WORKDIR /app

# Create a non-root user
RUN adduser --disabled-password --gecos "" myuser

# Switch to the non-root user
USER myuser

# Set up environment variables - Start
ENV PATH="/home/myuser/.local/bin:$PATH"
ENV GOOGLE_GENAI_USE_VERTEXAI=1
ENV GOOGLE_CLOUD_PROJECT=${options.project}
ENV GOOGLE_CLOUD_LOCATION=${options.region}
# Set up environment variables - End

# Copy application files
COPY --chown=myuser:myuser "agents/${options.appName}/" "/app/agents/${
      options.appName}/"
COPY --chown=myuser:myuser "package.json" "/app/package.json"
COPY --chown=myuser:myuser "package-lock.json" "/app/package-lock.json"
COPY --chown=myuser:myuser "node_modules" "/app/node_modules"
# Copy application files

# Install Agent Deps - Start
RUN npm install @google/adk-devtools@latest
RUN npm install --production
# Install Agent Deps - End

EXPOSE ${options.port}

CMD npx adk ${adkCommand} /app/agents/${options.appName} ${
      adkServerOptions.join(' ')}`;
}

async function resolveDefaultFromGcloudConfig(property: string):
    Promise<string|undefined> {
  const {stdout} = await execAsync('gcloud config get-value ' + property);
  return stdout.trim();
}

async function createDockerFile(
    targetFolder: string,
    options: CreateDockerFileContentOptions,
) {
  const dockerFilePath = path.join(targetFolder, 'Dockerfile');
  await saveToFile(dockerFilePath, createDockerFileContent(options));

  console.info('Creating Dockerfile complete:', dockerFilePath);
}

export async function deployToCloudRun(options: DeployToCloudRunOptions) {
  const project =
      options.project || await resolveDefaultFromGcloudConfig('project');
  if (!project || project === '(unset)') {
    throw new Error(
        'Project is not specified and default value for "project" is not set in gcloud config. Please specify region with --project option or set default value running "gcloud config set project YOUR_PROJECT".');
  }
  if (!options.project) {
    options.project = project;
    console.info(
        '--project option is not provided, using default project from gcloud config:',
        project);
  }

  const region =
      options.region || await resolveDefaultFromGcloudConfig('run/region');
  if (!region) {
    throw new Error(
        'Region is not specified and default value for "run/region" is not set in gcloud config. Please specify region with --region option or set default value running "gcloud config set run/region YOUR_REGION".');
  }
  if (!options.region) {
    options.region = region;
    console.info(
        '--region option is not provided, using default region from gcloud config:',
        region);
  }

  const gcloudCommands = prepareGCloudArguments(options);

  // Request to bundle any js or ts file into a single cjs file to be able to
  // copy file with all it's dependencies correctly.
  const agentLoader =
      new AgentLoader(options.agentPath, {bundle: AgentFileBundleMode.ANY});

  const isFileProvided = await isFile(options.agentPath);
  const agentDir =
      isFileProvided ? path.dirname(options.agentPath) : options.agentPath;
  const appName = options.appName || isFileProvided ?
      path.parse(options.agentPath).name :
      path.basename(options.agentPath);

  console.info('Starting deployment to Cloud Run...');

  if (await isFolderExists(options.tempFolder)) {
    console.info('Cleaning up existing temporary files...');
    await fs.rm(options.tempFolder, {recursive: true, force: true});
  }

  try {
    console.info('Copying agent source files...');
    await copyAgentFiles(
        agentLoader, path.join(options.tempFolder, 'agents', appName));

    console.info('Creating package.json...');
    await createPackageJson(agentDir, options.tempFolder);

    console.info('Creating Dockerfile...');
    await createDockerFile(options.tempFolder, {
      appName,
      project: options.project,
      region: options.region,
      port: options.port,
      withUi: options.withUi,
      logLevel: options.logLevel,
      allowOrigins: options.allowOrigins,
      traceToCloud: options.traceToCloud,
    });

    console.info('Deploying to Cloud Run...');
    await spawnAsync('gcloud', gcloudCommands, {stdio: 'inherit'});
  } catch (e: unknown) {
    console.error(
        '\x1b[31mFailed to deploy to Cloud Run:', (e as Error).message,
        '\x1b[0m');
  } finally {
    console.info('Cleaning up temporary files...');
    await fs.rm(options.tempFolder, {recursive: true, force: true});
    await agentLoader.disposeAll();
    console.info('Temporary files cleaned up.');
  }
}

/**
 * Options for deploying to Agent Engine.
 */
export interface DeployToAgentEngineOptions {
  /** Path to agent directory containing agent source code */
  agentPath: string;
  /** Temp folder for staging files (auto-generated if not provided) */
  tempFolder?: string;
  /** Name of the ADK app module file (without extension) */
  adkApp?: string;
  /** Google Cloud project ID */
  project?: string;
  /** Google Cloud region */
  region?: string;
  /** API key for Express Mode */
  apiKey?: string;
  /** Agent Engine ID to update (creates new if not provided) */
  agentEngineId?: string;
  /** Display name for the Agent Engine */
  displayName?: string;
  /** Description of the Agent Engine */
  description?: string;
  /** The ADK app object to use: 'root_agent' or 'app' */
  adkAppObject?: string;
  /** Enable Cloud Trace telemetry */
  traceToCloud?: boolean;
  /** Custom requirements file path */
  requirementsFile?: string;
  /** Custom .env file path */
  envFile?: string;
  /** Custom agent engine config file path */
  agentEngineConfigFile?: string;
}

/**
 * Agent Engine configuration interface.
 */
interface AgentEngineConfig {
  entrypoint_module?: string;
  entrypoint_object?: string;
  source_packages?: string[];
  class_methods?: typeof AGENT_ENGINE_CLASS_METHODS;
  agent_framework?: string;
  display_name?: string;
  description?: string;
  requirements_file?: string;
  env_vars?: Record<string, string>;
}

/**
 * Read .ae_ignore patterns from the agent folder if present.
 */
async function readAeIgnorePatterns(agentPath: string): Promise<string[]> {
  const aeIgnorePath = path.join(agentPath, '.ae_ignore');
  try {
    const content = await fs.readFile(aeIgnorePath, 'utf-8');
    return content.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Check if a file matches any of the ignore patterns.
 */
function shouldIgnoreFile(filePath: string, ignorePatterns: string[]): boolean {
  const fileName = path.basename(filePath);
  const relativePath = filePath;

  for (const pattern of ignorePatterns) {
    // Simple glob pattern matching
    const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    if (regex.test(fileName) || regex.test(relativePath)) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively copy directory with ignore patterns.
 */
async function copyDirectoryWithIgnore(
    source: string,
    dest: string,
    ignorePatterns: string[],
    baseSource?: string,
): Promise<void> {
  baseSource = baseSource || source;

  await fs.mkdir(dest, {recursive: true});
  const entries = await fs.readdir(source, {withFileTypes: true});

  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(dest, entry.name);
    const relativePath = path.relative(baseSource, srcPath);

    if (shouldIgnoreFile(relativePath, ignorePatterns) ||
        shouldIgnoreFile(entry.name, ignorePatterns)) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyDirectoryWithIgnore(srcPath, destPath, ignorePatterns, baseSource);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Ensure the ADK package is in the package.json dependencies.
 */
async function ensureAdkDependency(packageJsonPath: string): Promise<void> {
  try {
    const packageJson = await loadFileData<{
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    }>(packageJsonPath);

    if (!packageJson) {
      throw new Error(`Could not read package.json at: ${packageJsonPath}`);
    }

    const hasAdkInDeps = packageJson.dependencies?.[ADK_PACKAGE_NAME];
    const hasAdkInDevDeps = packageJson.devDependencies?.[ADK_PACKAGE_NAME];

    if (!hasAdkInDeps && !hasAdkInDevDeps) {
      // Add @google/adk to dependencies
      packageJson.dependencies = packageJson.dependencies || {};
      packageJson.dependencies[ADK_PACKAGE_NAME] = 'latest';
      await saveToFile(packageJsonPath, packageJson);
      console.info(`Added ${ADK_PACKAGE_NAME} to package.json dependencies`);
    }
  } catch (error) {
    console.warn(`Warning: Could not verify ${ADK_PACKAGE_NAME} dependency:`, error);
  }
}

/**
 * Load environment variables from a .env file.
 */
async function loadEnvFile(envFilePath: string): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(envFilePath, 'utf-8');
    const envVars: Record<string, string> = {};

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const equalIndex = trimmed.indexOf('=');
      if (equalIndex === -1) {
        continue;
      }

      const key = trimmed.substring(0, equalIndex).trim();
      let value = trimmed.substring(equalIndex + 1).trim();

      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      envVars[key] = value;
    }

    return envVars;
  } catch {
    return {};
  }
}

/**
 * Console output helpers with colors.
 */
function logSuccess(message: string): void {
  console.log('\x1b[32m✅ ' + message + '\x1b[0m');
}

function logWarning(message: string): void {
  console.log('\x1b[33m⚠️  ' + message + '\x1b[0m');
}

function logError(message: string): void {
  console.error('\x1b[31m❌ ' + message + '\x1b[0m');
}

/**
 * Deploys an agent to Vertex AI Agent Engine.
 *
 * The agent folder should contain:
 * - agent.js or agent.ts - The main agent file exporting rootAgent or app
 * - package.json - With @google/adk as a dependency
 * - .env (optional) - Environment variables
 * - .ae_ignore (optional) - Patterns for files to exclude
 * - .agent_engine_config.json (optional) - Agent Engine configuration
 *
 * @param options Deployment options
 */
export async function deployToAgentEngine(
    options: DeployToAgentEngineOptions
): Promise<void> {
  const agentPath = options.agentPath;
  const appName = path.basename(agentPath);
  const parentFolder = path.dirname(agentPath);
  const adkApp = options.adkApp || 'agent_engine_app';
  let adkAppObject = options.adkAppObject || 'rootAgent';

  // Validate adkAppObject
  if (!['rootAgent', 'root_agent', 'app'].includes(adkAppObject)) {
    logError(`Invalid adkAppObject: ${adkAppObject}. Please use "rootAgent", "root_agent", or "app".`);
    return;
  }

  // Normalize to snake_case for Python compatibility
  if (adkAppObject === 'rootAgent') {
    adkAppObject = 'root_agent';
  }

  // Generate timestamp-based temp folder name
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const tmpAppName = `${appName}_tmp${timestamp}`;
  const tempFolder = options.tempFolder || path.join(parentFolder, tmpAppName);

  console.info(`Starting deployment to Agent Engine...`);
  console.info(`Staging files in: ${tempFolder}`);

  // Clean up existing temp folder if it exists
  if (await isFolderExists(tempFolder)) {
    console.info('Removing existing staging files...');
    await fs.rm(tempFolder, {recursive: true, force: true});
  }

  try {
    // Read .ae_ignore patterns
    const ignorePatterns = await readAeIgnorePatterns(agentPath);
    if (ignorePatterns.length > 0) {
      console.info(`Found .ae_ignore with ${ignorePatterns.length} patterns`);
    }

    // Copy agent source code
    console.info('Copying agent source code...');
    await copyDirectoryWithIgnore(agentPath, tempFolder, ignorePatterns);
    console.info('Agent source code copied.');

    // Resolve project
    let project = options.project;
    if (!project) {
      try {
        project = await resolveDefaultFromGcloudConfig('project');
        if (project && project !== '(unset)') {
          console.info(`Using default project from gcloud config: ${project}`);
        } else {
          project = undefined;
        }
      } catch {
        // Ignore gcloud config errors
      }
    }

    // Resolve region
    let region = options.region;
    if (!region) {
      try {
        region = await resolveDefaultFromGcloudConfig('compute/region');
        if (region && region !== '(unset)') {
          console.info(`Using default region from gcloud config: ${region}`);
        } else {
          region = undefined;
        }
      } catch {
        // Ignore gcloud config errors
      }
    }

    // Load agent engine config
    console.info('Resolving files and dependencies...');
    let agentConfig: AgentEngineConfig = {};

    const configFilePath = options.agentEngineConfigFile ||
        path.join(agentPath, '.agent_engine_config.json');
    if (await isFolderExists(configFilePath)) {
      try {
        agentConfig = await loadFileData<AgentEngineConfig>(configFilePath) || {};
        console.info(`Loaded agent engine config from ${configFilePath}`);
      } catch {
        // Ignore config file errors
      }
    }

    // Override display name and description from options
    const displayName = options.displayName || appName;
    if (displayName) {
      agentConfig.display_name = displayName;
    }
    if (options.description) {
      agentConfig.description = options.description;
    }

    // Handle package.json
    const packageJsonPath = path.join(tempFolder, 'package.json');
    if (await isFolderExists(packageJsonPath)) {
      await ensureAdkDependency(packageJsonPath);
    } else {
      // Create minimal package.json
      const minimalPackageJson = {
        name: appName,
        type: 'module',
        dependencies: {
          [ADK_PACKAGE_NAME]: 'latest',
        },
      };
      await saveToFile(packageJsonPath, minimalPackageJson);
      console.info('Created package.json');
    }

    // Load environment variables
    let envVars: Record<string, string> = {};
    let apiKey = options.apiKey;

    const envFilePath = options.envFile || path.join(agentPath, '.env');
    if (await isFolderExists(envFilePath)) {
      console.info(`Reading environment variables from ${envFilePath}`);
      envVars = await loadEnvFile(envFilePath);

      // Handle GOOGLE_CLOUD_PROJECT from .env
      if (envVars['GOOGLE_CLOUD_PROJECT']) {
        const envProject = envVars['GOOGLE_CLOUD_PROJECT'];
        delete envVars['GOOGLE_CLOUD_PROJECT'];
        if (project) {
          logWarning('Ignoring GOOGLE_CLOUD_PROJECT from .env as --project was provided');
        } else {
          project = envProject;
          console.info(`Using GOOGLE_CLOUD_PROJECT from .env: ${project}`);
        }
      }

      // Handle GOOGLE_CLOUD_LOCATION from .env
      if (envVars['GOOGLE_CLOUD_LOCATION']) {
        const envRegion = envVars['GOOGLE_CLOUD_LOCATION'];
        delete envVars['GOOGLE_CLOUD_LOCATION'];
        if (region) {
          logWarning('Ignoring GOOGLE_CLOUD_LOCATION from .env as --region was provided');
        } else {
          region = envRegion;
          console.info(`Using GOOGLE_CLOUD_LOCATION from .env: ${region}`);
        }
      }

      // Handle GOOGLE_API_KEY from .env
      if (!apiKey && envVars['GOOGLE_API_KEY']) {
        apiKey = envVars['GOOGLE_API_KEY'];
        console.info('Using GOOGLE_API_KEY from .env');
      }
    }

    // Set API key env vars if provided
    if (apiKey) {
      if (envVars['GOOGLE_API_KEY'] && options.apiKey) {
        logWarning('Ignoring GOOGLE_API_KEY from .env as --api_key was provided');
      }
      envVars['GOOGLE_GENAI_USE_VERTEXAI'] = '1';
      envVars['GOOGLE_API_KEY'] = apiKey;
    }

    if (Object.keys(envVars).length > 0) {
      agentConfig.env_vars = envVars;
    }

    // Validate authentication options
    if (!project && !region && !apiKey) {
      logError('No project/region or api_key provided. Please specify either project/region or api_key.');
      return;
    }

    // Check for config agent (root_agent.yaml)
    const configRootAgentFile = path.join(tempFolder, 'root_agent.yaml');
    const isConfigAgent = await isFolderExists(configRootAgentFile);
    if (isConfigAgent) {
      console.info(`Config agent detected: ${configRootAgentFile}`);
    }

    // Generate the Agent Engine app entrypoint
    const adkAppType = adkAppObject === 'app' ? 'app' : 'agent';
    const adkAppFile = path.join(tempFolder, `${adkApp}.js`);

    const appTemplate = generateAgentEngineAppTemplate({
      appName,
      traceToCloud: options.traceToCloud || false,
      isConfigAgent,
      agentFolder: `./${path.basename(tempFolder)}`,
      adkAppObject,
      adkAppType,
      expressMode: !!apiKey && !project,
    });
    await saveToFile(adkAppFile, appTemplate);
    console.info(`Created ${adkAppFile}`);
    console.info('Files and dependencies resolved.');

    // Build the Agent Engine configuration
    console.info('Deploying to Agent Engine...');
    agentConfig.entrypoint_module = `${path.basename(tempFolder)}.${adkApp}`;
    agentConfig.entrypoint_object = 'adkApp';
    agentConfig.source_packages = [path.basename(tempFolder)];
    agentConfig.class_methods = AGENT_ENGINE_CLASS_METHODS;
    agentConfig.agent_framework = 'google-adk';

    // Note: The actual deployment to Vertex AI Agent Engine requires the
    // @google-cloud/vertexai SDK with agent_engines support.
    // For now, we output the configuration and instructions.

    console.info('');
    console.info('='.repeat(60));
    console.info('Agent Engine deployment configuration prepared.');
    console.info('='.repeat(60));
    console.info('');
    console.info('Generated configuration:');
    console.info(JSON.stringify(agentConfig, null, 2));
    console.info('');

    if (project && region) {
      console.info(`Project: ${project}`);
      console.info(`Region: ${region}`);
    } else if (apiKey) {
      console.info('Mode: Express Mode (API Key)');
    }

    // Try to deploy using Vertex AI client
    // Note: The @google-cloud/vertexai SDK's Agent Engine API is still in development.
    // For now, we provide instructions for manual deployment.
    logWarning('Automatic deployment to Agent Engine is not yet available in the TypeScript SDK.');
    console.info('');
    console.info('To deploy to Agent Engine, you can:');
    console.info('');
    console.info('1. Use the Python ADK CLI (recommended):');
    console.info(`   pip install google-adk`);
    console.info(`   adk deploy agent_engine ${agentPath}`);
    console.info('');
    console.info('2. Use the Google Cloud Console:');
    console.info('   https://console.cloud.google.com/vertex-ai/agent-engines');
    console.info('');
    console.info('3. Use gcloud CLI to deploy manually:');
    console.info('   gcloud ai agent-engines create --config=<config-file>');
    console.info('');

    // Output the configuration for manual deployment
    console.info('The staged files and configuration have been prepared.');
    console.info('Configuration file path:', path.join(tempFolder, 'agent_engine_config.json'));

    // Save the config to a file for manual deployment
    const configFileSavePath = path.join(tempFolder, 'agent_engine_config.json');
    await saveToFile(configFileSavePath, agentConfig);
    console.info(`Configuration saved to: ${configFileSavePath}`);

    console.info('');
    console.info('Staged files location:', tempFolder);
    console.info('You can inspect the generated files before cleanup.');

  } catch (e: unknown) {
    logError(`Failed to deploy to Agent Engine: ${(e as Error).message}`);
    console.error(e);
  } finally {
    console.info(`Cleaning up temp folder: ${tempFolder}`);
    await fs.rm(tempFolder, {recursive: true, force: true});
  }
}
