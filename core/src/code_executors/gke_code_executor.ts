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
import {importKubernetes} from './dynamic_imports.js';

/**
 * Default Kubernetes namespace for jobs.
 */
const DEFAULT_NAMESPACE = 'default';

/**
 * Default container image for code execution.
 */
const DEFAULT_IMAGE = 'python:3.11-slim';

/**
 * Default job timeout in seconds.
 */
const DEFAULT_TIMEOUT_SECONDS = 300;

/**
 * Job TTL (time-to-live) for automatic cleanup in seconds.
 */
const JOB_TTL_SECONDS = 600;

/**
 * Warning message displayed for experimental GKE Code Executor.
 */
const EXPERIMENTAL_WARNING = `
[WARNING] You are using GKECodeExecutor which is experimental.
The API may change in future releases.

Required RBAC permissions for the service account:
- ConfigMaps: create, delete, get, patch
- Jobs: get, list, watch, create, delete
- Pods/logs: get, list
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
 * Options for configuring the GKECodeExecutor.
 */
export interface GKECodeExecutorOptions {
  /**
   * Path to kubeconfig file.
   * If not provided, tries in-cluster config or default kubeconfig.
   */
  kubeconfigPath?: string;

  /**
   * Context within kubeconfig to use.
   */
  kubeconfigContext?: string;

  /**
   * Kubernetes namespace for jobs.
   * @default "default"
   */
  namespace?: string;

  /**
   * Container image for code execution.
   * @default "python:3.11-slim"
   */
  image?: string;

  /**
   * Job timeout in seconds.
   * @default 300
   */
  timeoutSeconds?: number;

  /**
   * CPU request (e.g., "200m").
   * @default "200m"
   */
  cpuRequested?: string;

  /**
   * Memory request (e.g., "256Mi").
   * @default "256Mi"
   */
  memRequested?: string;

  /**
   * CPU limit in millicores (e.g., "500m").
   * @default "500m"
   */
  cpuLimit?: string;

  /**
   * Memory limit (e.g., "512Mi").
   * @default "512Mi"
   */
  memLimit?: string;

  /**
   * The number of attempts to retry on consecutive code execution errors.
   * Default to 2.
   */
  errorRetryAttempts?: number;
}

/**
 * Kubernetes API client interface types.
 * These match the @kubernetes/client-node package types.
 */
interface KubeConfig {
  loadFromFile(filePath: string): void;
  loadFromDefault(): void;
  loadFromCluster(): void;
  setCurrentContext(context: string): void;
  makeApiClient<T>(apiClientType: new (server: string) => T): T;
}

interface V1ConfigMap {
  metadata?: {
    name?: string;
    namespace?: string;
    ownerReferences?: Array<{
      apiVersion: string;
      kind: string;
      name: string;
      uid: string;
    }>;
  };
  data?: Record<string, string>;
}

interface V1Job {
  metadata?: {
    name?: string;
    namespace?: string;
    uid?: string;
    annotations?: Record<string, string>;
  };
  spec?: {
    ttlSecondsAfterFinished?: number;
    template?: {
      spec?: {
        runtimeClassName?: string;
        containers?: Array<{
          name?: string;
          image?: string;
          command?: string[];
          volumeMounts?: Array<{
            name?: string;
            mountPath?: string;
          }>;
          resources?: {
            requests?: Record<string, string>;
            limits?: Record<string, string>;
          };
          securityContext?: Record<string, unknown>;
        }>;
        volumes?: Array<{
          name?: string;
          configMap?: {
            name?: string;
          };
        }>;
        restartPolicy?: string;
        securityContext?: Record<string, unknown>;
      };
    };
  };
  status?: {
    succeeded?: number;
    failed?: number;
    conditions?: Array<{
      type: string;
      status: string;
    }>;
  };
}

interface V1Pod {
  metadata?: {
    name?: string;
  };
}

interface CoreV1Api {
  createNamespacedConfigMap(
    namespace: string,
    body: V1ConfigMap
  ): Promise<{body: V1ConfigMap}>;
  patchNamespacedConfigMap(
    name: string,
    namespace: string,
    body: object,
    pretty?: string,
    dryRun?: string,
    fieldManager?: string,
    force?: boolean,
    options?: {headers: Record<string, string>}
  ): Promise<{body: V1ConfigMap}>;
  readNamespacedPodLog(
    name: string,
    namespace: string
  ): Promise<{body: string}>;
  listNamespacedPod(
    namespace: string,
    pretty?: string,
    allowWatchBookmarks?: boolean,
    _continue?: string,
    fieldSelector?: string,
    labelSelector?: string
  ): Promise<{body: {items: V1Pod[]}}>;
}

interface BatchV1Api {
  createNamespacedJob(
    namespace: string,
    body: V1Job
  ): Promise<{body: V1Job}>;
  readNamespacedJob(
    name: string,
    namespace: string
  ): Promise<{body: V1Job}>;
}

interface WatchApi {
  watch(
    path: string,
    queryParams: Record<string, string>,
    callback: (type: string, apiObj: V1Job, watchObj: object) => void,
    done: (err: Error | null) => void
  ): Promise<{abort: () => void}>;
}

/**
 * A code executor that uses Google Kubernetes Engine (GKE) to execute Python code.
 *
 * This executor creates Kubernetes Jobs to run Python code in isolated pods,
 * providing security through gVisor runtime and resource limits.
 *
 * @example
 * ```typescript
 * // Using default kubeconfig
 * const executor = await GKECodeExecutor.create({
 *   namespace: 'my-namespace',
 * });
 *
 * // Using explicit kubeconfig
 * const executor = await GKECodeExecutor.create({
 *   kubeconfigPath: '/path/to/kubeconfig',
 *   kubeconfigContext: 'my-cluster',
 *   namespace: 'my-namespace',
 *   image: 'my-python-image:latest',
 *   cpuLimit: '1000m',
 *   memLimit: '1Gi',
 * });
 * ```
 *
 * @experimental This class is experimental and may change in future releases.
 *
 * @remarks
 * Requires the `@kubernetes/client-node` npm package to be installed:
 * ```bash
 * npm install @kubernetes/client-node
 * ```
 *
 * Required RBAC permissions for the service account:
 * - ConfigMaps: create, delete, get, patch
 * - Jobs: get, list, watch, create, delete
 * - Pods/logs: get, list
 */
export class GKECodeExecutor extends BaseCodeExecutor {
  private readonly kubeConfig: KubeConfig;
  private readonly coreV1Api: CoreV1Api;
  private readonly batchV1Api: BatchV1Api;
  private readonly watchApi: WatchApi;

  private readonly namespace: string;
  private readonly image: string;
  private readonly timeoutSeconds: number;
  private readonly cpuRequested: string;
  private readonly memRequested: string;
  private readonly cpuLimit: string;
  private readonly memLimit: string;

  /**
   * Private constructor. Use GKECodeExecutor.create() instead.
   */
  private constructor(
    kubeConfig: KubeConfig,
    coreV1Api: CoreV1Api,
    batchV1Api: BatchV1Api,
    watchApi: WatchApi,
    options: GKECodeExecutorOptions
  ) {
    super();
    logExperimentalWarning();
    this.kubeConfig = kubeConfig;
    this.coreV1Api = coreV1Api;
    this.batchV1Api = batchV1Api;
    this.watchApi = watchApi;

    this.namespace = options.namespace || DEFAULT_NAMESPACE;
    this.image = options.image || DEFAULT_IMAGE;
    this.timeoutSeconds = options.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS;
    this.cpuRequested = options.cpuRequested || '200m';
    this.memRequested = options.memRequested || '256Mi';
    this.cpuLimit = options.cpuLimit || '500m';
    this.memLimit = options.memLimit || '512Mi';

    // GKECodeExecutor does not support stateful execution or optimize_data_file
    this.stateful = false;
    this.optimizeDataFile = false;
    if (options.errorRetryAttempts !== undefined) {
      this.errorRetryAttempts = options.errorRetryAttempts;
    }
  }

  /**
   * Creates a new GKECodeExecutor.
   *
   * @param options Configuration options.
   * @returns A promise that resolves to the initialized executor.
   * @throws Error if @kubernetes/client-node package is not installed.
   */
  static async create(
    options: GKECodeExecutorOptions = {}
  ): Promise<GKECodeExecutor> {
    // Dynamically import @kubernetes/client-node
    let k8s: {
      KubeConfig: new () => KubeConfig;
      CoreV1Api: new (server: string) => CoreV1Api;
      BatchV1Api: new (server: string) => BatchV1Api;
      Watch: new (kubeConfig: KubeConfig) => WatchApi;
    };

    try {
      k8s = (await importKubernetes()) as typeof k8s;
    } catch {
      throw new Error(
        '@kubernetes/client-node package is required for GKECodeExecutor. ' +
          'Install it with: npm install @kubernetes/client-node'
      );
    }

    const kubeConfig = new k8s.KubeConfig();

    // Load kubeconfig with fallback
    if (options.kubeconfigPath) {
      kubeConfig.loadFromFile(options.kubeconfigPath);
    } else {
      try {
        // Try in-cluster config first (for pods running in K8s)
        kubeConfig.loadFromCluster();
      } catch {
        // Fall back to default kubeconfig
        kubeConfig.loadFromDefault();
      }
    }

    if (options.kubeconfigContext) {
      kubeConfig.setCurrentContext(options.kubeconfigContext);
    }

    const coreV1Api = kubeConfig.makeApiClient(k8s.CoreV1Api);
    const batchV1Api = kubeConfig.makeApiClient(k8s.BatchV1Api);
    const watchApi = new k8s.Watch(kubeConfig);

    return new GKECodeExecutor(
      kubeConfig,
      coreV1Api,
      batchV1Api,
      watchApi,
      options
    );
  }

  /**
   * Executes code in a Kubernetes Job.
   *
   * @param params The execution parameters.
   * @returns A promise that resolves to the code execution result.
   */
  override async executeCode(
    params: ExecuteCodeParams
  ): Promise<CodeExecutionResult> {
    const {invocationContext, codeExecutionInput} = params;
    const invocationId = invocationContext.invocationId;

    // Generate unique job name
    const jobName = `adk-exec-${this.generateShortUuid()}`;
    const configMapName = `${jobName}-code`;

    logger.debug(`Executing code in GKE job: ${jobName}`);

    try {
      // Create ConfigMap with code
      await this.createCodeConfigMap(configMapName, codeExecutionInput.code);

      // Create Job
      const job = await this.createJob(jobName, configMapName, invocationId);

      // Add owner reference to ConfigMap for automatic cleanup
      if (job.metadata?.uid) {
        await this.addOwnerReference(configMapName, job);
      }

      // Watch for job completion
      const result = await this.watchJobCompletion(jobName);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`GKE code execution failed: ${errorMessage}`);
      return {
        stdout: '',
        stderr: `Error executing code: ${errorMessage}`,
        outputFiles: [],
      };
    }
  }

  /**
   * Creates a ConfigMap containing the Python code.
   */
  private async createCodeConfigMap(
    name: string,
    code: string
  ): Promise<void> {
    const configMap: V1ConfigMap = {
      metadata: {
        name,
        namespace: this.namespace,
      },
      data: {
        'code.py': code,
      },
    };

    await this.coreV1Api.createNamespacedConfigMap(this.namespace, configMap);
    logger.debug(`Created ConfigMap: ${name}`);
  }

  /**
   * Creates a Kubernetes Job to execute the code.
   */
  private async createJob(
    jobName: string,
    configMapName: string,
    invocationId: string
  ): Promise<V1Job> {
    const jobManifest: V1Job = {
      metadata: {
        name: jobName,
        namespace: this.namespace,
        annotations: {
          'adk.agent.google.com/invocation-id': invocationId,
        },
      },
      spec: {
        ttlSecondsAfterFinished: JOB_TTL_SECONDS,
        template: {
          spec: {
            // Use gVisor for additional isolation (if available)
            runtimeClassName: 'gvisor',
            containers: [
              {
                name: 'executor',
                image: this.image,
                command: ['python3', '/app/code.py'],
                volumeMounts: [
                  {
                    name: 'code',
                    mountPath: '/app',
                  },
                ],
                resources: {
                  requests: {
                    cpu: this.cpuRequested,
                    memory: this.memRequested,
                  },
                  limits: {
                    cpu: this.cpuLimit,
                    memory: this.memLimit,
                  },
                },
                securityContext: {
                  runAsNonRoot: true,
                  runAsUser: 1001,
                  readOnlyRootFilesystem: true,
                  allowPrivilegeEscalation: false,
                  capabilities: {
                    drop: ['ALL'],
                  },
                },
              },
            ],
            volumes: [
              {
                name: 'code',
                configMap: {
                  name: configMapName,
                },
              },
            ],
            restartPolicy: 'Never',
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1001,
              fsGroup: 1001,
            },
          },
        },
      },
    };

    const response = await this.batchV1Api.createNamespacedJob(
      this.namespace,
      jobManifest
    );
    logger.debug(`Created Job: ${jobName}`);
    return response.body;
  }

  /**
   * Adds an owner reference to the ConfigMap so it's cleaned up with the Job.
   */
  private async addOwnerReference(
    configMapName: string,
    job: V1Job
  ): Promise<void> {
    try {
      const patch = {
        metadata: {
          ownerReferences: [
            {
              apiVersion: 'batch/v1',
              kind: 'Job',
              name: job.metadata?.name || '',
              uid: job.metadata?.uid || '',
            },
          ],
        },
      };

      await this.coreV1Api.patchNamespacedConfigMap(
        configMapName,
        this.namespace,
        patch,
        undefined,
        undefined,
        undefined,
        undefined,
        {headers: {'Content-Type': 'application/strategic-merge-patch+json'}}
      );
    } catch (error) {
      // Log but don't fail - owner reference is for cleanup convenience
      logger.warn(`Failed to add owner reference to ConfigMap: ${error}`);
    }
  }

  /**
   * Watches the Job for completion and returns the result.
   */
  private async watchJobCompletion(jobName: string): Promise<CodeExecutionResult> {
    return new Promise<CodeExecutionResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Job ${jobName} timed out after ${this.timeoutSeconds}s`));
      }, this.timeoutSeconds * 1000);

      const path = `/apis/batch/v1/namespaces/${this.namespace}/jobs`;
      const queryParams = {
        fieldSelector: `metadata.name=${jobName}`,
      };

      this.watchApi
        .watch(
          path,
          queryParams,
          async (type, apiObj) => {
            if (type === 'MODIFIED' || type === 'ADDED') {
              const job = apiObj as V1Job;
              const succeeded = job.status?.succeeded || 0;
              const failed = job.status?.failed || 0;

              if (succeeded > 0 || failed > 0) {
                clearTimeout(timeout);
                try {
                  const logs = await this.getPodLogs(jobName);
                  if (failed > 0) {
                    resolve({
                      stdout: '',
                      stderr: logs || 'Job failed without output',
                      outputFiles: [],
                    });
                  } else {
                    resolve({
                      stdout: logs,
                      stderr: '',
                      outputFiles: [],
                    });
                  }
                } catch (error) {
                  resolve({
                    stdout: '',
                    stderr: `Failed to get logs: ${error}`,
                    outputFiles: [],
                  });
                }
              }
            }
          },
          (err) => {
            clearTimeout(timeout);
            if (err) {
              reject(err);
            }
          }
        )
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  }

  /**
   * Gets logs from the pod created by the Job.
   */
  private async getPodLogs(jobName: string): Promise<string> {
    // Find pod by job-name label
    const podsResponse = await this.coreV1Api.listNamespacedPod(
      this.namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      `job-name=${jobName}`
    );

    const pods = podsResponse.body.items;
    if (!pods.length) {
      throw new Error(`No pods found for job: ${jobName}`);
    }

    const podName = pods[0].metadata?.name;
    if (!podName) {
      throw new Error('Pod name not found');
    }

    const logsResponse = await this.coreV1Api.readNamespacedPodLog(
      podName,
      this.namespace
    );

    return logsResponse.body || '';
  }

  /**
   * Generates a short UUID for job naming.
   */
  private generateShortUuid(): string {
    // Generate a simple random string
    return Math.random().toString(36).substring(2, 12);
  }
}

/**
 * Resets the experimental warning state (for testing purposes).
 */
export function resetGKEExperimentalWarning(): void {
  warningShown = false;
}
