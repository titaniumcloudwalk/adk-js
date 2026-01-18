/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {InvocationContext} from '../agents/invocation_context.js';
import {logger} from '../utils/logger.js';

import {
  BaseCodeExecutor,
  ExecuteCodeParams,
} from './base_code_executor.js';
import {
  CodeExecutionInput,
  CodeExecutionResult,
  File,
} from './code_execution_utils.js';

/**
 * Warning message displayed for experimental Agent Engine Sandbox Code Executor.
 */
const EXPERIMENTAL_WARNING = `
[WARNING] You are using AgentEngineSandboxCodeExecutor which is experimental.
The API may change in future releases.
`;

/** Track if warning has been shown to avoid repeated warnings */
let warningShown = false;

/**
 * Logs a warning message for experimental features.
 * The warning is only logged once per session.
 */
function logExperimentalWarning(): void {
  if (!warningShown) {
    logger.warn(EXPERIMENTAL_WARNING);
    warningShown = true;
  }
}

/**
 * Options for configuring the AgentEngineSandboxCodeExecutor.
 */
export interface AgentEngineSandboxCodeExecutorOptions {
  /**
   * If set, load the existing resource name of the code interpreter extension
   * instead of creating a new one.
   * Format: projects/123/locations/us-central1/reasoningEngines/456/sandboxEnvironments/789
   */
  sandboxResourceName?: string;

  /**
   * The resource name of the agent engine to use to create the code execution sandbox.
   * Format: projects/123/locations/us-central1/reasoningEngines/456
   * When both sandboxResourceName and agentEngineResourceName are set,
   * agentEngineResourceName will be ignored.
   */
  agentEngineResourceName?: string;
}

/**
 * Response structure from sandbox execute_code API.
 */
interface ExecuteCodeOutput {
  data: Uint8Array | string;
  mimeType: string;
  mime_type?: string;
  metadata?: {
    attributes?: Record<string, Uint8Array | string>;
  };
}

/**
 * Response structure from sandbox create API.
 */
interface CreateSandboxResponse {
  name: string;
}

/**
 * A code executor that uses Agent Engine Code Execution Sandbox to execute code.
 *
 * This executor provides low-latency code execution using Agent Engine sandboxed
 * environments. It supports both using an existing sandbox or creating a new one
 * from an agent engine.
 *
 * @example
 * ```typescript
 * // Using an existing sandbox
 * const executor = await AgentEngineSandboxCodeExecutor.create({
 *   sandboxResourceName:
 *     'projects/my-project/locations/us-central1/reasoningEngines/123/sandboxEnvironments/456',
 * });
 *
 * // Creating a new sandbox from an agent engine
 * const executor = await AgentEngineSandboxCodeExecutor.create({
 *   agentEngineResourceName:
 *     'projects/my-project/locations/us-central1/reasoningEngines/123',
 * });
 * ```
 *
 * @experimental This class is experimental and may change in future releases.
 */
export class AgentEngineSandboxCodeExecutor extends BaseCodeExecutor {
  /**
   * The resource name of the code execution sandbox.
   */
  readonly sandboxResourceName: string;

  private readonly projectId: string;
  private readonly location: string;

  /**
   * Regex pattern for validating sandbox resource names.
   */
  private static readonly SANDBOX_RESOURCE_NAME_PATTERN =
    /^projects\/([a-zA-Z0-9-_]+)\/locations\/([a-zA-Z0-9-_]+)\/reasoningEngines\/(\d+)\/sandboxEnvironments\/(\d+)$/;

  /**
   * Regex pattern for validating agent engine resource names.
   */
  private static readonly AGENT_ENGINE_RESOURCE_NAME_PATTERN =
    /^projects\/([a-zA-Z0-9-_]+)\/locations\/([a-zA-Z0-9-_]+)\/reasoningEngines\/(\d+)$/;

  /**
   * Private constructor. Use AgentEngineSandboxCodeExecutor.create() instead.
   */
  private constructor(
    sandboxResourceName: string,
    projectId: string,
    location: string
  ) {
    super();
    logExperimentalWarning();
    this.sandboxResourceName = sandboxResourceName;
    this.projectId = projectId;
    this.location = location;
  }

  /**
   * Creates a new AgentEngineSandboxCodeExecutor.
   *
   * If sandboxResourceName is provided, it will use the existing sandbox.
   * If agentEngineResourceName is provided, it will create a new sandbox.
   *
   * @param options Configuration options.
   * @returns A promise that resolves to the initialized executor.
   * @throws Error if neither sandboxResourceName nor agentEngineResourceName is provided.
   * @throws Error if the resource name format is invalid.
   */
  static async create(
    options: AgentEngineSandboxCodeExecutorOptions
  ): Promise<AgentEngineSandboxCodeExecutor> {
    const {sandboxResourceName, agentEngineResourceName} = options;

    if (sandboxResourceName) {
      const [projectId, location] =
        AgentEngineSandboxCodeExecutor.getProjectIdAndLocationFromResourceName(
          sandboxResourceName,
          AgentEngineSandboxCodeExecutor.SANDBOX_RESOURCE_NAME_PATTERN
        );
      return new AgentEngineSandboxCodeExecutor(
        sandboxResourceName,
        projectId,
        location
      );
    } else if (agentEngineResourceName) {
      const [projectId, location] =
        AgentEngineSandboxCodeExecutor.getProjectIdAndLocationFromResourceName(
          agentEngineResourceName,
          AgentEngineSandboxCodeExecutor.AGENT_ENGINE_RESOURCE_NAME_PATTERN
        );

      // Create a new sandbox
      const client = new VertexAiSandboxClient({
        project: projectId,
        location,
      });

      const response = await client.agentEngines.sandboxes.create({
        name: agentEngineResourceName,
        spec: {codeExecutionEnvironment: {}},
        config: {displayName: 'default_sandbox'},
      });

      return new AgentEngineSandboxCodeExecutor(
        response.name,
        projectId,
        location
      );
    } else {
      throw new Error(
        'Either sandboxResourceName or agentEngineResourceName must be set.'
      );
    }
  }

  /**
   * Executes code in the Agent Engine sandbox.
   *
   * @param params The execution parameters.
   * @returns A promise that resolves to the code execution result.
   */
  override async executeCode(
    params: ExecuteCodeParams
  ): Promise<CodeExecutionResult> {
    const {codeExecutionInput} = params;

    const client = this.getApiClient();
    const response = await client.agentEngines.sandboxes.executeCode({
      name: this.sandboxResourceName,
      inputData: this.buildInputData(codeExecutionInput),
    });

    logger.debug(`Executed code:\n\`\`\`\n${codeExecutionInput.code}\n\`\`\``);

    return this.parseExecutionResponse(response.outputs || []);
  }

  /**
   * Builds the input data structure for the execute_code API.
   */
  private buildInputData(
    codeExecutionInput: CodeExecutionInput
  ): Record<string, unknown> {
    const inputData: Record<string, unknown> = {
      code: codeExecutionInput.code,
    };

    if (codeExecutionInput.inputFiles && codeExecutionInput.inputFiles.length > 0) {
      inputData['files'] = codeExecutionInput.inputFiles.map((f) => ({
        name: f.name,
        contents: f.content,
        mimeType: f.mimeType,
      }));
    }

    return inputData;
  }

  /**
   * Parses the execution response from the API.
   */
  private parseExecutionResponse(outputs: ExecuteCodeOutput[]): CodeExecutionResult {
    const savedFiles: File[] = [];
    let stdout = '';
    let stderr = '';

    for (const output of outputs) {
      const mimeType = output.mimeType || output.mime_type || '';
      const isJsonOutput =
        mimeType === 'application/json' &&
        (!output.metadata?.attributes ||
          !('file_name' in output.metadata.attributes));

      if (isJsonOutput) {
        // Parse stdout/stderr from JSON output
        const data = this.decodeOutputData(output.data);
        try {
          const jsonData = JSON.parse(data);
          stdout = jsonData.stdout || '';
          stderr = jsonData.stderr || '';
        } catch {
          // If JSON parsing fails, treat as stdout
          stdout = data;
        }
      } else {
        // This is a saved file
        let fileName = '';
        if (output.metadata?.attributes?.['file_name']) {
          fileName = this.decodeOutputData(output.metadata.attributes['file_name']);
        }

        let fileMimeType = mimeType;
        if (!fileMimeType && fileName) {
          fileMimeType = this.guessMimeType(fileName);
        }

        savedFiles.push({
          name: fileName,
          content: this.encodeOutputData(output.data),
          mimeType: fileMimeType,
        });
      }
    }

    return {
      stdout,
      stderr,
      outputFiles: savedFiles,
    };
  }

  /**
   * Decodes output data to string.
   * The API returns data as base64-encoded strings.
   */
  private decodeOutputData(data: Uint8Array | string): string {
    if (typeof data === 'string') {
      // REST API returns base64-encoded data
      try {
        return atob(data);
      } catch {
        // If not base64, return as-is
        return data;
      }
    }
    return new TextDecoder('utf-8').decode(data);
  }

  /**
   * Encodes output data to base64 string.
   */
  private encodeOutputData(data: Uint8Array | string): string {
    if (typeof data === 'string') {
      // If already a string, assume it's base64 encoded or plain text
      return data;
    }
    // Convert Uint8Array to base64
    const binary = Array.from(data)
      .map((byte) => String.fromCharCode(byte))
      .join('');
    return btoa(binary);
  }

  /**
   * Guesses the MIME type from a filename.
   */
  private guessMimeType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
      html: 'text/html',
      xml: 'application/xml',
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      py: 'text/x-python',
      js: 'text/javascript',
      ts: 'text/typescript',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }

  /**
   * Gets an API client for the given project and location.
   */
  private getApiClient(): VertexAiSandboxClient {
    return new VertexAiSandboxClient({
      project: this.projectId,
      location: this.location,
    });
  }

  /**
   * Extracts project ID and location from a resource name.
   *
   * @param resourceName The resource name to parse.
   * @param pattern The regex pattern to match.
   * @returns A tuple of [projectId, location].
   * @throws Error if the resource name doesn't match the pattern.
   */
  private static getProjectIdAndLocationFromResourceName(
    resourceName: string,
    pattern: RegExp
  ): [string, string] {
    const match = resourceName.match(pattern);
    if (!match) {
      throw new Error(`Resource name ${resourceName} is not valid.`);
    }
    return [match[1], match[2]];
  }
}

/**
 * Resets the experimental warning state (for testing purposes).
 */
export function resetExperimentalWarning(): void {
  warningShown = false;
}

/**
 * Vertex AI Agent Engine Sandbox REST API client.
 * Implements the sandboxes API using fetch.
 */
class VertexAiSandboxClient {
  private readonly project: string;
  private readonly location: string;
  private accessToken?: string;
  private tokenExpiry?: number;

  constructor(options: {project: string; location: string}) {
    this.project = options.project;
    this.location = options.location;
  }

  /**
   * The agent engines/sandboxes API namespace.
   */
  readonly agentEngines = {
    sandboxes: {
      /**
       * Creates a new sandbox environment.
       */
      create: async (options: {
        name: string;
        spec: {codeExecutionEnvironment: Record<string, unknown>};
        config: {displayName: string};
      }): Promise<CreateSandboxResponse> => {
        const path = `/${options.name}/sandboxEnvironments`;
        return this.makeRequest<CreateSandboxResponse>('POST', path, {
          spec: options.spec,
          display_name: options.config.displayName,
        });
      },

      /**
       * Executes code in a sandbox environment.
       */
      executeCode: async (options: {
        name: string;
        inputData: Record<string, unknown>;
      }): Promise<{outputs: ExecuteCodeOutput[]}> => {
        const path = `/${options.name}:executeCode`;
        return this.makeRequest<{outputs: ExecuteCodeOutput[]}>('POST', path, {
          input_data: options.inputData,
        });
      },
    },
  };

  private async getAccessToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    // Use google-auth-library to get access token
    try {
      const {GoogleAuth} = await import('google-auth-library');
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();

      if (!tokenResponse.token) {
        throw new Error('Failed to get access token');
      }

      this.accessToken = tokenResponse.token;
      // Cache token for 55 minutes (tokens typically valid for 60 minutes)
      this.tokenExpiry = Date.now() + 55 * 60 * 1000;

      return this.accessToken;
    } catch (error) {
      throw new Error(
        `Failed to authenticate with Google Cloud. ` +
          `Make sure you have valid credentials configured. ` +
          `Original error: ${error}`
      );
    }
  }

  private getBaseUrl(): string {
    return `https://${this.location}-aiplatform.googleapis.com/v1beta1`;
  }

  private async makeRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/projects/${this.project}/locations/${this.location}${path}`;

    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(
        `API request failed: ${response.status} - ${errorText}`
      );
      (error as unknown as {code: number}).code = response.status;
      throw error;
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
}
