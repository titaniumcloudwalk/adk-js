/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Service factory utilities for creating session, artifact, and memory services
 * based on CLI options and environment configuration.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  BaseArtifactService,
  BaseMemoryService,
  BaseSessionService,
  DatabaseSessionService,
  GcsArtifactService,
  InMemoryArtifactService,
  InMemoryMemoryService,
  InMemorySessionService,
  VertexAiSessionService,
  VertexAiMemoryBankService,
  VertexAiRagMemoryService,
} from '@google/adk';

// Simple logger for service factory
const logger = {
  info: (message: string) => console.log(`[ServiceFactory] INFO: ${message}`),
  warn: (message: string) => console.warn(`[ServiceFactory] WARN: ${message}`),
  error: (message: string) => console.error(`[ServiceFactory] ERROR: ${message}`),
  debug: (message: string) => {
    if (process.env['DEBUG']) {
      console.log(`[ServiceFactory] DEBUG: ${message}`);
    }
  },
};

// Environment variable names
const DISABLE_LOCAL_STORAGE_ENV = 'ADK_DISABLE_LOCAL_STORAGE';
const FORCE_LOCAL_STORAGE_ENV = 'ADK_FORCE_LOCAL_STORAGE';
const CLOUD_RUN_SERVICE_ENV = 'K_SERVICE';
const KUBERNETES_HOST_ENV = 'KUBERNETES_SERVICE_HOST';

/**
 * Checks if an environment variable is enabled (truthy).
 */
function isEnvEnabled(envName: string): boolean {
  const value = process.env[envName];
  if (!value) return false;
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

/**
 * Returns true when running in Cloud Run.
 */
function isCloudRun(): boolean {
  return !!process.env[CLOUD_RUN_SERVICE_ENV];
}

/**
 * Returns true when running in Kubernetes (including GKE).
 */
function isKubernetes(): boolean {
  return !!process.env[KUBERNETES_HOST_ENV];
}

/**
 * Checks if a directory exists and is writable.
 */
function isDirWritable(dirPath: string): boolean {
  try {
    if (!fs.existsSync(dirPath)) return false;
    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) return false;
    // Check write access
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Result of local storage resolution.
 */
interface LocalStorageResolution {
  useLocalStorage: boolean;
  warningMessage?: string;
}

/**
 * Resolves effective local storage setting with safe defaults.
 */
function resolveUseLocalStorage(
    basePath: string,
    requested: boolean,
): LocalStorageResolution {
  if (isEnvEnabled(DISABLE_LOCAL_STORAGE_ENV)) {
    return {
      useLocalStorage: false,
      warningMessage:
          `Local storage is disabled by ${DISABLE_LOCAL_STORAGE_ENV}; ` +
          `using in-memory services. Set --session_service_uri/--artifact_service_uri ` +
          `for production deployments.`,
    };
  }

  if (isEnvEnabled(FORCE_LOCAL_STORAGE_ENV)) {
    if (!isDirWritable(basePath)) {
      return {
        useLocalStorage: false,
        warningMessage:
            `Local storage is forced by ${FORCE_LOCAL_STORAGE_ENV}, ` +
            `but ${basePath} is not writable; using in-memory services.`,
      };
    }
    return {useLocalStorage: true};
  }

  if (!requested) {
    return {useLocalStorage: false};
  }

  if (isCloudRun() || isKubernetes()) {
    return {
      useLocalStorage: false,
      warningMessage:
          `Detected Cloud Run/Kubernetes runtime; using in-memory services ` +
          `instead of local .adk storage. Set ${FORCE_LOCAL_STORAGE_ENV}=1 to force local storage.`,
    };
  }

  if (!isDirWritable(basePath)) {
    return {
      useLocalStorage: false,
      warningMessage:
          `Agents directory ${basePath} is not writable; using in-memory services ` +
          `instead of local .adk storage. Set ${FORCE_LOCAL_STORAGE_ENV}=1 to force local storage.`,
    };
  }

  return {useLocalStorage: true};
}

/**
 * Service factory function type.
 */
type ServiceFactory<T> = (uri: string, options?: Record<string, unknown>) => T | Promise<T>;

/**
 * Service registry for URI scheme to service factory mappings.
 */
class ServiceRegistry {
  private sessionFactories: Map<string, ServiceFactory<BaseSessionService>> =
      new Map();
  private artifactFactories: Map<string, ServiceFactory<BaseArtifactService>> =
      new Map();
  private memoryFactories: Map<string, ServiceFactory<BaseMemoryService>> =
      new Map();

  registerSessionService(
      scheme: string,
      factory: ServiceFactory<BaseSessionService>,
  ): void {
    this.sessionFactories.set(scheme, factory);
  }

  registerArtifactService(
      scheme: string,
      factory: ServiceFactory<BaseArtifactService>,
  ): void {
    this.artifactFactories.set(scheme, factory);
  }

  registerMemoryService(
      scheme: string,
      factory: ServiceFactory<BaseMemoryService>,
  ): void {
    this.memoryFactories.set(scheme, factory);
  }

  async createSessionService(
      uri: string,
      options?: Record<string, unknown>,
  ): Promise<BaseSessionService | undefined> {
    const scheme = this.getScheme(uri);
    const factory = this.sessionFactories.get(scheme);
    if (factory) {
      return await factory(uri, options);
    }
    return undefined;
  }

  async createArtifactService(
      uri: string,
      options?: Record<string, unknown>,
  ): Promise<BaseArtifactService | undefined> {
    const scheme = this.getScheme(uri);
    const factory = this.artifactFactories.get(scheme);
    if (factory) {
      return await factory(uri, options);
    }
    return undefined;
  }

  async createMemoryService(
      uri: string,
      options?: Record<string, unknown>,
  ): Promise<BaseMemoryService | undefined> {
    const scheme = this.getScheme(uri);
    const factory = this.memoryFactories.get(scheme);
    if (factory) {
      return await factory(uri, options);
    }
    return undefined;
  }

  private getScheme(uri: string): string {
    const colonIndex = uri.indexOf('://');
    if (colonIndex === -1) {
      const singleColonIndex = uri.indexOf(':');
      if (singleColonIndex !== -1) {
        return uri.substring(0, singleColonIndex);
      }
      return '';
    }
    return uri.substring(0, colonIndex);
  }
}

// Singleton instance
let registryInstance: ServiceRegistry | undefined;

/**
 * Gets the singleton ServiceRegistry instance, initializing it if needed.
 */
export function getServiceRegistry(): ServiceRegistry {
  if (!registryInstance) {
    registryInstance = new ServiceRegistry();
    registerBuiltinServices(registryInstance);
  }
  return registryInstance;
}

/**
 * Parses agent engine resource name or ID from URI.
 */
function parseAgentEngineParams(
    uriPart: string,
    agentsDir?: string,
): {project?: string; location?: string; agentEngineId: string} {
  if (!uriPart) {
    throw new Error('Agent engine resource name or resource id cannot be empty.');
  }

  // If uriPart is just an ID (no slashes), load project/location from env
  if (!uriPart.includes('/')) {
    const project = process.env['GOOGLE_CLOUD_PROJECT'];
    const location = process.env['GOOGLE_CLOUD_LOCATION'];
    if (!project || !location) {
      throw new Error(
          'GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION must be set for short-form agent engine IDs.',
      );
    }
    return {project, location, agentEngineId: uriPart};
  }

  // Full resource name: projects/{project}/locations/{location}/reasoningEngines/{id}
  const parts = uriPart.split('/');
  if (
    parts.length !== 6 ||
    parts[0] !== 'projects' ||
    parts[2] !== 'locations' ||
    parts[4] !== 'reasoningEngines'
  ) {
    throw new Error(
        'Agent engine resource name is mal-formatted. It should be: ' +
        'projects/{project_id}/locations/{location}/reasoningEngines/{resource_id}',
    );
  }

  return {
    project: parts[1],
    location: parts[3],
    agentEngineId: parts[5],
  };
}

/**
 * Registers built-in service implementations.
 */
function registerBuiltinServices(registry: ServiceRegistry): void {
  // -- Session Services --

  // memory:// - In-memory session service
  registry.registerSessionService('memory', () => {
    return new InMemorySessionService();
  });

  // sqlite:///path/to/db.db - SQLite session service
  registry.registerSessionService('sqlite', async (uri) => {
    const url = new URL(uri);
    let dbPath = url.pathname;

    // Handle sqlite:// without path as in-memory
    if (!dbPath || dbPath === '/') {
      return new InMemorySessionService();
    }

    // Remove leading slash for relative paths
    if (dbPath.startsWith('/') && !dbPath.startsWith('//')) {
      dbPath = dbPath.substring(1);
    }

    const service = new DatabaseSessionService({dbUrl: uri});
    await service.initialize();
    return service;
  });

  // agentengine://{resource_name_or_id} - Vertex AI Agent Engine session service
  registry.registerSessionService('agentengine', (uri) => {
    const url = new URL(uri);
    const resourcePart = url.hostname + url.pathname;
    const params = parseAgentEngineParams(resourcePart);
    return new VertexAiSessionService(params);
  });

  // -- Artifact Services --

  // memory:// - In-memory artifact service
  registry.registerArtifactService('memory', () => {
    return new InMemoryArtifactService();
  });

  // gs://bucket-name - GCS artifact service
  registry.registerArtifactService('gs', (uri) => {
    const url = new URL(uri);
    const bucket = url.hostname;
    if (!bucket) {
      throw new Error('GCS artifact service URI must include a bucket name: gs://bucket-name');
    }
    return new GcsArtifactService(bucket);
  });

  // file:///path/to/artifacts - File-based artifact service (not yet implemented in TS)
  // registry.registerArtifactService('file', (uri) => {
  //   // FileArtifactService not yet implemented in TypeScript
  //   throw new Error('file:// artifact service is not yet implemented');
  // });

  // -- Memory Services --

  // memory:// - In-memory memory service (default)
  registry.registerMemoryService('memory', () => {
    return new InMemoryMemoryService();
  });

  // agentengine://{resource_name_or_id} - Vertex AI Memory Bank service
  registry.registerMemoryService('agentengine', (uri) => {
    const url = new URL(uri);
    const resourcePart = url.hostname + url.pathname;
    const params = parseAgentEngineParams(resourcePart);
    return new VertexAiMemoryBankService(params);
  });

  // rag://{corpus_id} - Vertex AI RAG memory service
  registry.registerMemoryService('rag', (uri) => {
    const url = new URL(uri);
    const ragCorpus = url.hostname;
    if (!ragCorpus) {
      throw new Error('RAG memory service URI must include a corpus ID: rag://corpus-id');
    }

    const project = process.env['GOOGLE_CLOUD_PROJECT'];
    const location = process.env['GOOGLE_CLOUD_LOCATION'];
    if (!project || !location) {
      throw new Error(
          'GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION must be set for RAG memory service.',
      );
    }

    return new VertexAiRagMemoryService({
      ragCorpus: `projects/${project}/locations/${location}/ragCorpora/${ragCorpus}`,
    });
  });
}

/**
 * Options for creating a session service.
 */
export interface CreateSessionServiceOptions {
  /** Base directory for agents (used for local storage). */
  baseDir: string;
  /** URI of the session service (e.g., sqlite:///path/to/db.db). */
  sessionServiceUri?: string;
  /** Whether to use local storage when no URI is provided. */
  useLocalStorage?: boolean;
}

/**
 * Creates a session service based on CLI/web options.
 */
export async function createSessionServiceFromOptions(
    options: CreateSessionServiceOptions,
): Promise<BaseSessionService> {
  const {baseDir, sessionServiceUri, useLocalStorage = true} = options;
  const registry = getServiceRegistry();

  // If a URI is provided, use the registry to create the service
  if (sessionServiceUri) {
    logger.info(`Using session service URI: ${sessionServiceUri}`);
    const service = await registry.createSessionService(sessionServiceUri, {
      agentsDir: baseDir,
    });

    if (service) {
      return service;
    }

    // Fallback to DatabaseSessionService for SQLAlchemy-compatible URIs
    logger.info(
        `Falling back to DatabaseSessionService for URI: ${sessionServiceUri}`,
    );
    const dbService = new DatabaseSessionService({dbUrl: sessionServiceUri});
    await dbService.initialize();
    return dbService;
  }

  // Resolve local storage setting
  const {useLocalStorage: effectiveUseLocal, warningMessage} =
      resolveUseLocalStorage(baseDir, useLocalStorage);

  if (!effectiveUseLocal) {
    if (warningMessage) {
      logger.warn(warningMessage);
    }
    return new InMemorySessionService();
  }

  // Default to local SQLite storage
  const adkDir = path.join(baseDir, '.adk');
  try {
    if (!fs.existsSync(adkDir)) {
      fs.mkdirSync(adkDir, {recursive: true});
    }
    const dbPath = path.join(adkDir, 'sessions.db');
    const service = new DatabaseSessionService({dbUrl: `sqlite:///${dbPath}`});
    await service.initialize();
    return service;
  } catch (error) {
    logger.warn(
        `Failed to initialize local session storage under ${baseDir}: ${error}; ` +
        `falling back to in-memory session service.`,
    );
    return new InMemorySessionService();
  }
}

/**
 * Options for creating an artifact service.
 */
export interface CreateArtifactServiceOptions {
  /** Base directory for agents (used for local storage). */
  baseDir: string;
  /** URI of the artifact service (e.g., gs://bucket-name). */
  artifactServiceUri?: string;
  /** Whether to use local storage when no URI is provided. */
  useLocalStorage?: boolean;
  /** Whether to throw on unsupported URI (vs. fallback to in-memory). */
  strictUri?: boolean;
}

/**
 * Creates an artifact service based on CLI/web options.
 */
export async function createArtifactServiceFromOptions(
    options: CreateArtifactServiceOptions,
): Promise<BaseArtifactService> {
  const {
    baseDir,
    artifactServiceUri,
    useLocalStorage = true,
    strictUri = false,
  } = options;
  const registry = getServiceRegistry();

  // If a URI is provided, use the registry to create the service
  if (artifactServiceUri) {
    logger.info(`Using artifact service URI: ${artifactServiceUri}`);
    const service = await registry.createArtifactService(artifactServiceUri, {
      agentsDir: baseDir,
    });

    if (service) {
      return service;
    }

    if (strictUri) {
      throw new Error(`Unsupported artifact service URI: ${artifactServiceUri}`);
    }

    logger.warn(
        `Unsupported artifact service URI: ${artifactServiceUri}, ` +
        `falling back to in-memory artifact service.`,
    );
    return new InMemoryArtifactService();
  }

  // Resolve local storage setting
  const {useLocalStorage: effectiveUseLocal, warningMessage} =
      resolveUseLocalStorage(baseDir, useLocalStorage);

  if (!effectiveUseLocal) {
    if (warningMessage) {
      logger.warn(warningMessage);
    }
    return new InMemoryArtifactService();
  }

  // For now, TypeScript doesn't have FileArtifactService, so use in-memory
  // when local storage is requested
  logger.info(
      'Local artifact storage not yet implemented; using in-memory artifact service.',
  );
  return new InMemoryArtifactService();
}

/**
 * Options for creating a memory service.
 */
export interface CreateMemoryServiceOptions {
  /** Base directory for agents. */
  baseDir: string;
  /** URI of the memory service (e.g., rag://corpus-id). */
  memoryServiceUri?: string;
}

/**
 * Creates a memory service based on CLI/web options.
 */
export async function createMemoryServiceFromOptions(
    options: CreateMemoryServiceOptions,
): Promise<BaseMemoryService> {
  const {baseDir, memoryServiceUri} = options;
  const registry = getServiceRegistry();

  if (memoryServiceUri) {
    logger.info(`Using memory service URI: ${memoryServiceUri}`);
    const service = await registry.createMemoryService(memoryServiceUri, {
      agentsDir: baseDir,
    });

    if (!service) {
      throw new Error(`Unsupported memory service URI: ${memoryServiceUri}`);
    }

    return service;
  }

  logger.info('Using in-memory memory service');
  return new InMemoryMemoryService();
}

// Export utilities for testing
export {
  isCloudRun,
  isKubernetes,
  isDirWritable,
  resolveUseLocalStorage,
  ServiceRegistry,
  parseAgentEngineParams,
};
