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
  CodeExecutionResult,
} from './code_execution_utils.js';
import {importDocker} from './dynamic_imports.js';

/**
 * Default Docker image tag for the code executor.
 */
const DEFAULT_IMAGE_TAG = 'adk-code-executor:latest';

/**
 * Warning message displayed for experimental Container Code Executor.
 */
const EXPERIMENTAL_WARNING = `
[WARNING] You are using ContainerCodeExecutor which is experimental.
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
 * Options for configuring the ContainerCodeExecutor.
 */
export interface ContainerCodeExecutorOptions {
  /**
   * Base URL of user-hosted Docker client.
   * If not provided, uses the local Docker daemon.
   */
  baseUrl?: string;

  /**
   * Tag of predefined or custom image to run.
   * Either image or dockerfilePath must be provided.
   */
  image?: string;

  /**
   * Path to directory containing Dockerfile.
   * Either image or dockerfilePath must be provided.
   */
  dockerfilePath?: string;

  /**
   * The number of attempts to retry on consecutive code execution errors.
   * Default to 2.
   */
  errorRetryAttempts?: number;
}

/**
 * Docker container interface matching dockerode types.
 */
interface DockerContainer {
  exec(
    options: {Cmd: string[]; AttachStdout: boolean; AttachStderr: boolean}
  ): Promise<DockerExec>;
  stop(): Promise<void>;
  remove(): Promise<void>;
}

/**
 * Docker exec interface matching dockerode types.
 */
interface DockerExec {
  start(options: {Demux: boolean}): Promise<{
    output: {on: (event: string, callback: (data: Buffer) => void) => void};
  }>;
}

/**
 * Docker image interface matching dockerode types.
 */
interface DockerImage {
  id: string;
}

/**
 * Docker client interface matching dockerode types.
 */
interface DockerClient {
  createContainer(options: {
    Image: string;
    Tty: boolean;
    Cmd: string[];
  }): Promise<DockerContainer>;
  getImage(name: string): {
    inspect(): Promise<DockerImage>;
  };
  buildImage(
    context: string,
    options: {t: string}
  ): Promise<NodeJS.ReadableStream>;
  modem: {
    followProgress(
      stream: NodeJS.ReadableStream,
      onFinished: (err: Error | null, result: unknown) => void
    ): void;
  };
}

/**
 * A code executor that uses Docker containers to execute Python code.
 *
 * This executor creates a Docker container and runs Python code within it,
 * providing isolation and a consistent execution environment.
 *
 * @example
 * ```typescript
 * // Using a predefined image
 * const executor = await ContainerCodeExecutor.create({
 *   image: 'python:3.11-slim',
 * });
 *
 * // Using a custom Dockerfile
 * const executor = await ContainerCodeExecutor.create({
 *   dockerfilePath: './my-executor',
 * });
 * ```
 *
 * @experimental This class is experimental and may change in future releases.
 *
 * @remarks
 * Requires the `dockerode` npm package to be installed:
 * ```bash
 * npm install dockerode @types/dockerode
 * ```
 */
export class ContainerCodeExecutor extends BaseCodeExecutor {
  private readonly client: DockerClient;
  private container?: DockerContainer;
  private readonly image: string;
  private readonly dockerfilePath?: string;
  private initialized = false;

  /**
   * Private constructor. Use ContainerCodeExecutor.create() instead.
   */
  private constructor(
    client: DockerClient,
    image: string,
    dockerfilePath?: string,
    errorRetryAttempts?: number
  ) {
    super();
    logExperimentalWarning();
    this.client = client;
    this.image = image;
    this.dockerfilePath = dockerfilePath;
    // ContainerCodeExecutor does not support stateful execution or optimize_data_file
    this.stateful = false;
    this.optimizeDataFile = false;
    if (errorRetryAttempts !== undefined) {
      this.errorRetryAttempts = errorRetryAttempts;
    }
  }

  /**
   * Creates a new ContainerCodeExecutor.
   *
   * @param options Configuration options.
   * @returns A promise that resolves to the initialized executor.
   * @throws Error if neither image nor dockerfilePath is provided.
   * @throws Error if dockerode package is not installed.
   */
  static async create(
    options: ContainerCodeExecutorOptions
  ): Promise<ContainerCodeExecutor> {
    const {baseUrl, image, dockerfilePath, errorRetryAttempts} = options;

    if (!image && !dockerfilePath) {
      throw new Error('Either image or dockerfilePath must be set.');
    }

    // Dynamically import dockerode
    let Docker: new (options?: {host?: string; port?: number}) => DockerClient;
    try {
      Docker = (await importDocker()) as new (options?: {
        host?: string;
        port?: number;
      }) => DockerClient;
    } catch {
      throw new Error(
        'dockerode package is required for ContainerCodeExecutor. ' +
          'Install it with: npm install dockerode @types/dockerode'
      );
    }

    // Create Docker client
    let client: DockerClient;
    if (baseUrl) {
      // Parse URL to extract host and port
      const url = new URL(baseUrl);
      client = new Docker({
        host: url.hostname,
        port: parseInt(url.port || '2375', 10),
      });
    } else {
      client = new Docker();
    }

    const effectiveImage = image || DEFAULT_IMAGE_TAG;
    const executor = new ContainerCodeExecutor(
      client,
      effectiveImage,
      dockerfilePath,
      errorRetryAttempts
    );

    return executor;
  }

  /**
   * Initializes the Docker container.
   * Builds the image if dockerfilePath is set, then starts the container.
   */
  private async initContainer(): Promise<void> {
    if (this.initialized && this.container) {
      return;
    }

    // Build image if dockerfilePath is set
    if (this.dockerfilePath) {
      await this.buildDockerImage();
    }

    // Create and start container
    logger.debug(`Creating container with image: ${this.image}`);
    this.container = await this.client.createContainer({
      Image: this.image,
      Tty: true,
      Cmd: ['/bin/sh', '-c', 'while true; do sleep 1000; done'],
    });

    // Verify Python installation
    await this.verifyPythonInstallation();

    this.initialized = true;
    logger.debug('Container initialized successfully');
  }

  /**
   * Builds a Docker image from the Dockerfile at dockerfilePath.
   */
  private async buildDockerImage(): Promise<void> {
    if (!this.dockerfilePath) {
      return;
    }

    logger.debug(`Building Docker image from: ${this.dockerfilePath}`);
    const stream = await this.client.buildImage(this.dockerfilePath, {
      t: this.image,
    });

    // Wait for build to complete
    await new Promise<void>((resolve, reject) => {
      this.client.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });

    logger.debug(`Docker image built: ${this.image}`);
  }

  /**
   * Verifies that Python3 is installed in the container.
   */
  private async verifyPythonInstallation(): Promise<void> {
    if (!this.container) {
      throw new Error('Container not initialized');
    }

    const exec = await this.container.exec({
      Cmd: ['which', 'python3'],
      AttachStdout: true,
      AttachStderr: true,
    });

    const result = await exec.start({Demux: true});
    let output = '';

    await new Promise<void>((resolve) => {
      result.output.on('data', (data: Buffer) => {
        output += data.toString();
      });
      result.output.on('end', () => {
        resolve();
      });
    });

    if (!output.includes('python3')) {
      throw new Error(
        'Python3 is not installed in the container. ' +
          'Please use an image with Python3 installed.'
      );
    }
  }

  /**
   * Executes code in the Docker container.
   *
   * @param params The execution parameters.
   * @returns A promise that resolves to the code execution result.
   */
  override async executeCode(
    params: ExecuteCodeParams
  ): Promise<CodeExecutionResult> {
    const {codeExecutionInput} = params;

    // Initialize container on first execution
    await this.initContainer();

    if (!this.container) {
      throw new Error('Container not initialized');
    }

    logger.debug(`Executing code in container:\n\`\`\`\n${codeExecutionInput.code}\n\`\`\``);

    // Execute code via docker exec
    const exec = await this.container.exec({
      Cmd: ['python3', '-c', codeExecutionInput.code],
      AttachStdout: true,
      AttachStderr: true,
    });

    const result = await exec.start({Demux: true});

    // Collect stdout and stderr
    let stdout = '';
    let stderr = '';

    await new Promise<void>((resolve) => {
      result.output.on('data', (data: Buffer) => {
        // In demuxed mode, we get separate streams
        // For simplicity, we treat all output as stdout
        stdout += data.toString();
      });
      result.output.on('end', () => {
        resolve();
      });
    });

    return {
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      outputFiles: [],
    };
  }

  /**
   * Cleans up the container.
   * Call this method when done using the executor.
   */
  async cleanup(): Promise<void> {
    if (this.container) {
      try {
        await this.container.stop();
        await this.container.remove();
        logger.debug('Container cleaned up');
      } catch (error) {
        logger.warn(`Failed to cleanup container: ${error}`);
      }
      this.container = undefined;
      this.initialized = false;
    }
  }
}

/**
 * Resets the experimental warning state (for testing purposes).
 */
export function resetContainerExperimentalWarning(): void {
  warningShown = false;
}
