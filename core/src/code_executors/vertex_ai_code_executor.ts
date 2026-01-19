/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
 * Environment variable name for the code interpreter extension resource name.
 */
const CODE_INTERPRETER_EXTENSION_NAME_ENV = 'CODE_INTERPRETER_EXTENSION_NAME';

/**
 * Standard library imports prepended to all user code.
 * These provide commonly used data analysis libraries.
 */
const CODE_WITH_IMPORTS = `
import io
import math
import re

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import scipy


def crop(s: str, max_chars: int = 64) -> str:
    """Truncate a string to max_chars characters."""
    if len(s) > max_chars:
        return s[:max_chars] + "..."
    return s


def explore_df(df: pd.DataFrame) -> None:
    """Print useful information about a DataFrame."""
    print(f"Shape: {df.shape}")
    print(f"Columns: {list(df.columns)}")
    print(f"Data types:\\n{df.dtypes}")
    print(f"\\nFirst 5 rows:\\n{df.head()}")
    print(f"\\nBasic statistics:\\n{df.describe()}")
`;

/**
 * Warning message displayed for experimental Vertex AI Code Executor.
 */
const EXPERIMENTAL_WARNING = `
[WARNING] You are using VertexAICodeExecutor which is experimental.
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
 * Options for configuring the VertexAICodeExecutor.
 */
export interface VertexAICodeExecutorOptions {
  /**
   * Full resource name of the code interpreter extension.
   * Format: projects/123/locations/us-central1/extensions/456
   *
   * If not provided, checks CODE_INTERPRETER_EXTENSION_NAME environment variable.
   * If neither is set, a new extension will be created.
   */
  resourceName?: string;

  /**
   * Google Cloud project ID.
   * Required if creating a new extension.
   */
  projectId?: string;

  /**
   * Google Cloud location (e.g., "us-central1").
   * Required if creating a new extension.
   * @default "us-central1"
   */
  location?: string;

  /**
   * The number of attempts to retry on consecutive code execution errors.
   * Default to 2.
   */
  errorRetryAttempts?: number;
}

/**
 * Response structure from the code interpreter extension.
 */
interface CodeInterpreterResponse {
  execution_result?: string;
  execution_error?: string;
  output_files?: Array<{
    name: string;
    contents: string;
  }>;
}

/**
 * A code executor that uses Vertex AI Extensions (Code Interpreter) to execute Python code.
 *
 * This executor leverages Vertex AI's code interpreter extension for secure,
 * managed code execution with built-in support for data analysis libraries
 * like pandas, numpy, matplotlib, and scipy.
 *
 * @example
 * ```typescript
 * // Using an existing extension
 * const executor = await VertexAICodeExecutor.create({
 *   resourceName: 'projects/my-project/locations/us-central1/extensions/123',
 * });
 *
 * // Creating a new extension
 * const executor = await VertexAICodeExecutor.create({
 *   projectId: 'my-project',
 *   location: 'us-central1',
 * });
 * ```
 *
 * @experimental This class is experimental and may change in future releases.
 *
 * @remarks
 * This executor automatically includes common data analysis imports in all code:
 * - pandas, numpy, scipy, matplotlib
 * - io, math, re from standard library
 * - Helper functions: crop(), explore_df()
 */
export class VertexAICodeExecutor extends BaseCodeExecutor {
  private readonly resourceName: string;
  private readonly projectId: string;
  private readonly location: string;
  private sessionId?: string;

  /**
   * Regex pattern for validating extension resource names.
   */
  private static readonly EXTENSION_RESOURCE_NAME_PATTERN =
    /^projects\/([a-zA-Z0-9-_]+)\/locations\/([a-zA-Z0-9-_]+)\/extensions\/(\d+)$/;

  /**
   * Private constructor. Use VertexAICodeExecutor.create() instead.
   */
  private constructor(
    resourceName: string,
    projectId: string,
    location: string,
    errorRetryAttempts?: number
  ) {
    super();
    logExperimentalWarning();
    this.resourceName = resourceName;
    this.projectId = projectId;
    this.location = location;

    // VertexAICodeExecutor supports stateful execution
    this.stateful = true;
    this.optimizeDataFile = false;

    if (errorRetryAttempts !== undefined) {
      this.errorRetryAttempts = errorRetryAttempts;
    }
  }

  /**
   * Creates a new VertexAICodeExecutor.
   *
   * Priority for resource name resolution:
   * 1. Provided resourceName option
   * 2. CODE_INTERPRETER_EXTENSION_NAME environment variable
   * 3. Create a new extension (requires projectId)
   *
   * @param options Configuration options.
   * @returns A promise that resolves to the initialized executor.
   * @throws Error if resourceName is invalid.
   * @throws Error if creating a new extension and projectId is not provided.
   */
  static async create(
    options: VertexAICodeExecutorOptions = {}
  ): Promise<VertexAICodeExecutor> {
    const {
      resourceName,
      projectId,
      location = 'us-central1',
      errorRetryAttempts,
    } = options;

    // Try to get resource name from options, environment, or create new
    let effectiveResourceName = resourceName;

    if (!effectiveResourceName) {
      // Check environment variable
      effectiveResourceName = process.env[CODE_INTERPRETER_EXTENSION_NAME_ENV];
    }

    if (effectiveResourceName) {
      // Validate existing resource name
      const [extractedProjectId, extractedLocation] =
        VertexAICodeExecutor.getProjectIdAndLocationFromResourceName(
          effectiveResourceName
        );

      return new VertexAICodeExecutor(
        effectiveResourceName,
        extractedProjectId,
        extractedLocation,
        errorRetryAttempts
      );
    }

    // Need to create a new extension
    if (!projectId) {
      throw new Error(
        'Either resourceName, CODE_INTERPRETER_EXTENSION_NAME environment variable, ' +
          'or projectId must be provided.'
      );
    }

    // Create a new code interpreter extension
    const client = new VertexAIExtensionsClient({
      project: projectId,
      location,
    });

    const extension = await client.createCodeInterpreterExtension();
    logger.debug(`Created code interpreter extension: ${extension.name}`);

    return new VertexAICodeExecutor(
      extension.name,
      projectId,
      location,
      errorRetryAttempts
    );
  }

  /**
   * Executes code using the Vertex AI Code Interpreter extension.
   *
   * @param params The execution parameters.
   * @returns A promise that resolves to the code execution result.
   */
  override async executeCode(
    params: ExecuteCodeParams
  ): Promise<CodeExecutionResult> {
    const {codeExecutionInput} = params;

    // Build code with standard imports
    const codeWithImports = this.getCodeWithImports(codeExecutionInput.code);

    logger.debug(`Executing code in Vertex AI:\n\`\`\`\n${codeWithImports}\n\`\`\``);

    // Execute via the extension
    const response = await this.executeCodeInterpreter(
      codeWithImports,
      codeExecutionInput
    );

    // Process output files
    const outputFiles = this.processOutputFiles(response.output_files || []);

    return {
      stdout: response.execution_result || '',
      stderr: response.execution_error || '',
      outputFiles,
    };
  }

  /**
   * Executes code through the Code Interpreter extension.
   */
  private async executeCodeInterpreter(
    code: string,
    codeExecutionInput: CodeExecutionInput
  ): Promise<CodeInterpreterResponse> {
    const client = this.getApiClient();

    const operationParams: Record<string, unknown> = {
      code,
    };

    // Add input files if present
    if (codeExecutionInput.inputFiles?.length) {
      operationParams['input_files'] = codeExecutionInput.inputFiles.map((f) => ({
        name: f.name,
        contents: f.content,
      }));
    }

    // Add session ID for stateful execution
    if (codeExecutionInput.executionId) {
      this.sessionId = codeExecutionInput.executionId;
    }
    if (this.sessionId) {
      operationParams['session_id'] = this.sessionId;
    }

    const response = await client.executeExtension({
      name: this.resourceName,
      operationId: 'execute',
      operationParams,
    });

    return response as CodeInterpreterResponse;
  }

  /**
   * Prepends standard library imports to user code.
   */
  private getCodeWithImports(userCode: string): string {
    return `${CODE_WITH_IMPORTS}\n\n# User code\n${userCode}`;
  }

  /**
   * Processes output files from the extension response.
   */
  private processOutputFiles(
    files: Array<{name: string; contents: string}>
  ): File[] {
    return files.map((file) => ({
      name: file.name,
      content: file.contents,
      mimeType: this.guessMimeType(file.name),
    }));
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
   * Gets an API client for the Vertex AI Extensions.
   */
  private getApiClient(): VertexAIExtensionsClient {
    return new VertexAIExtensionsClient({
      project: this.projectId,
      location: this.location,
    });
  }

  /**
   * Extracts project ID and location from an extension resource name.
   *
   * @param resourceName The resource name to parse.
   * @returns A tuple of [projectId, location].
   * @throws Error if the resource name doesn't match the expected pattern.
   */
  private static getProjectIdAndLocationFromResourceName(
    resourceName: string
  ): [string, string] {
    const match = resourceName.match(
      VertexAICodeExecutor.EXTENSION_RESOURCE_NAME_PATTERN
    );
    if (!match) {
      throw new Error(`Resource name ${resourceName} is not valid.`);
    }
    return [match[1], match[2]];
  }
}

/**
 * Resets the experimental warning state (for testing purposes).
 */
export function resetVertexAIExperimentalWarning(): void {
  warningShown = false;
}

/**
 * Vertex AI Extensions REST API client.
 * Implements the extensions API using fetch.
 */
class VertexAIExtensionsClient {
  private readonly project: string;
  private readonly location: string;
  private accessToken?: string;
  private tokenExpiry?: number;

  constructor(options: {project: string; location: string}) {
    this.project = options.project;
    this.location = options.location;
  }

  /**
   * Creates a new Code Interpreter extension.
   */
  async createCodeInterpreterExtension(): Promise<{name: string}> {
    const path = `/projects/${this.project}/locations/${this.location}/extensions`;
    const body = {
      displayName: 'Code Interpreter',
      manifest: {
        name: 'code_interpreter_tool',
        description: 'A tool for executing Python code',
        apiSpec: {
          openApiGcsUri:
            'gs://vertex-extension-public/code_interpreter.yaml',
        },
        authConfig: {
          authType: 'GOOGLE_SERVICE_ACCOUNT_AUTH',
        },
      },
    };

    return this.makeRequest<{name: string}>('POST', path, body);
  }

  /**
   * Executes an extension operation.
   */
  async executeExtension(options: {
    name: string;
    operationId: string;
    operationParams: Record<string, unknown>;
  }): Promise<unknown> {
    const path = `/${options.name}:execute`;
    const body = {
      operation_id: options.operationId,
      operation_params: options.operationParams,
    };

    const response = await this.makeRequest<{output?: unknown}>(
      'POST',
      path,
      body
    );

    return response.output || response;
  }

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
    const url = `${baseUrl}${path}`;

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
