/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, Part} from '@google/genai';

import {Event} from '../events/event.js';
import {Session} from '../sessions/session.js';
import {logger} from '../utils/logger.js';

import {
  BaseMemoryService,
  SearchMemoryRequest,
  SearchMemoryResponse,
} from './base_memory_service.js';
import {MemoryEntry} from './memory_entry.js';

/**
 * Options for configuring the VertexAiMemoryBankService.
 */
export interface VertexAiMemoryBankServiceOptions {
  /**
   * The project ID of the Memory Bank to use.
   */
  project?: string;

  /**
   * The location of the Memory Bank to use.
   */
  location?: string;

  /**
   * The ID of the agent engine to use for the Memory Bank,
   * e.g. '456' in 'projects/my-project/locations/us-central1/reasoningEngines/456'.
   * To extract from api_resource.name, use:
   * `agentEngine.apiResource.name.split('/').pop()`
   */
  agentEngineId?: string;

  /**
   * The API key to use for Express Mode. If not provided, the API key from
   * the GOOGLE_API_KEY environment variable will be used. It will only be
   * used if GOOGLE_GENAI_USE_VERTEXAI is true. Do not use Google AI Studio
   * API key for this field.
   * @see https://cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview
   */
  expressModeApiKey?: string;
}

/**
 * Response structure from memory retrieve API.
 */
interface RetrievedMemory {
  memory: {
    fact: string;
    updateTime: Date | string;
    update_time?: Date | string;
  };
}

/**
 * Implementation of the BaseMemoryService using Vertex AI Memory Bank.
 *
 * This service provides LLM-powered memory extraction from conversations
 * and semantic search for retrieval. It requires a Vertex AI Agent Engine
 * instance to be deployed.
 *
 * @example
 * ```typescript
 * const memoryService = new VertexAiMemoryBankService({
 *   project: 'my-project',
 *   location: 'us-central1',
 *   agentEngineId: '456',
 * });
 *
 * // Add session to memory for fact extraction
 * await memoryService.addSessionToMemory(session);
 *
 * // Search for relevant memories
 * const memories = await memoryService.searchMemory({
 *   appName: 'myApp',
 *   userId: 'user123',
 *   query: 'user preferences',
 * });
 * ```
 */
export class VertexAiMemoryBankService implements BaseMemoryService {
  private readonly project?: string;
  private readonly location?: string;
  private readonly agentEngineId?: string;
  private readonly expressModeApiKey?: string;

  constructor(options: VertexAiMemoryBankServiceOptions = {}) {
    this.project = options.project;
    this.location = options.location;
    this.agentEngineId = options.agentEngineId;
    this.expressModeApiKey = getExpressModeApiKey(
      options.project,
      options.location,
      options.expressModeApiKey
    );

    if (options.agentEngineId && options.agentEngineId.includes('/')) {
      logger.warn(
        `agentEngineId appears to be a full resource path: '${options.agentEngineId}'. ` +
          `Expected just the ID (e.g., '456'). ` +
          `Extract the ID using: agentEngine.apiResource.name.split('/').pop()`
      );
    }
  }

  /**
   * Adds a session to the memory by extracting key facts and insights.
   *
   * This method filters out events without meaningful content (text, inline data,
   * or file data) and sends the remaining events to the Vertex AI Memory Bank
   * for LLM-powered fact extraction.
   *
   * @param session The session to add to the memory.
   */
  async addSessionToMemory(session: Session): Promise<void> {
    if (!this.agentEngineId) {
      throw new Error('Agent Engine ID is required for Memory Bank.');
    }

    const events: Array<{content: Record<string, unknown>}> = [];
    for (const event of session.events) {
      if (shouldFilterOutEvent(event.content)) {
        continue;
      }
      if (event.content) {
        // Serialize content to JSON-compatible format, excluding null/undefined
        events.push({
          content: serializeContent(event.content),
        });
      }
    }

    if (events.length > 0) {
      const client = await this.getApiClient();
      const operation = await client.agentEngines.memories.generate({
        name: 'reasoningEngines/' + this.agentEngineId,
        directContentsSource: {events},
        scope: {
          appName: session.appName,
          userId: session.userId,
        },
        config: {waitForCompletion: false},
      });
      logger.info('Generate memory response received.');
      logger.debug(`Generate memory response: ${JSON.stringify(operation)}`);
    } else {
      logger.info('No events to add to memory.');
    }
  }

  /**
   * Searches for memories that match the query using semantic similarity.
   *
   * @param request The search request containing appName, userId, and query.
   * @returns A promise that resolves to SearchMemoryResponse containing matching memories.
   */
  async searchMemory(request: SearchMemoryRequest): Promise<SearchMemoryResponse> {
    if (!this.agentEngineId) {
      throw new Error('Agent Engine ID is required for Memory Bank.');
    }

    const client = await this.getApiClient();
    const retrievedMemories = await client.agentEngines.memories.retrieve({
      name: 'reasoningEngines/' + this.agentEngineId,
      scope: {
        appName: request.appName,
        userId: request.userId,
      },
      similaritySearchParams: {
        searchQuery: request.query,
      },
    });

    logger.info('Search memory response received.');

    const memories: MemoryEntry[] = [];
    for (const retrievedMemory of retrievedMemories) {
      logger.debug(`Retrieved memory: ${JSON.stringify(retrievedMemory)}`);
      const updateTime =
        retrievedMemory.memory.updateTime || retrievedMemory.memory.update_time;
      memories.push({
        author: 'user',
        content: {
          parts: [{text: retrievedMemory.memory.fact}],
          role: 'user',
        },
        timestamp: formatTimestamp(updateTime),
      });
    }

    return {memories};
  }

  /**
   * Gets an API client for the Vertex AI Memory Bank.
   *
   * The client is instantiated inside each request so that event loop
   * management can be properly propagated.
   *
   * @returns An API client for the given project and location or express mode API key.
   */
  private async getApiClient(): Promise<VertexAiMemoriesClient> {
    return new VertexAiMemoriesClient({
      project: this.project,
      location: this.location,
      apiKey: this.expressModeApiKey,
    });
  }
}

/**
 * Gets the Express Mode API key.
 * Returns the API key for Vertex AI Express Mode if applicable.
 */
function getExpressModeApiKey(
  project?: string,
  location?: string,
  expressModeApiKey?: string
): string | undefined {
  if ((project || location) && expressModeApiKey) {
    throw new Error(
      'Cannot specify project or location and expressModeApiKey. ' +
        'Either use project and location, or just the expressModeApiKey.'
    );
  }

  const useVertexAi = (process.env['GOOGLE_GENAI_USE_VERTEXAI'] || '').toLowerCase();
  if (['true', '1'].includes(useVertexAi)) {
    return expressModeApiKey || process.env['GOOGLE_API_KEY'];
  }

  return undefined;
}

/**
 * Returns whether the event should be filtered out.
 * Events without text, inline_data, or file_data content are filtered.
 */
function shouldFilterOutEvent(content?: Content): boolean {
  if (!content || !content.parts) {
    return true;
  }
  for (const part of content.parts) {
    if (part.text || part.inlineData || part.fileData) {
      return false;
    }
  }
  return true;
}

/**
 * Serializes Content to a JSON-compatible format.
 */
function serializeContent(content: Content): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (content.role) {
    result['role'] = content.role;
  }

  if (content.parts && content.parts.length > 0) {
    result['parts'] = content.parts
      .map((part) => serializePart(part))
      .filter((p) => p !== null);
  }

  return result;
}

/**
 * Serializes a Part to a JSON-compatible format.
 */
function serializePart(part: Part): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};

  if (part.text !== undefined && part.text !== null) {
    result['text'] = part.text;
  }
  if (part.inlineData) {
    result['inlineData'] = part.inlineData;
  }
  if (part.fileData) {
    result['fileData'] = part.fileData;
  }

  // Return null if no relevant content
  if (Object.keys(result).length === 0) {
    return null;
  }

  return result;
}

/**
 * Formats a timestamp to ISO 8601 string format.
 */
function formatTimestamp(timestamp: Date | string | undefined): string {
  if (!timestamp) {
    return new Date().toISOString();
  }
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  // If already a string, try to parse and re-format for consistency
  const parsed = new Date(timestamp);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  // Return as-is if parsing fails
  return timestamp;
}

/**
 * Vertex AI Memory Bank REST API client.
 * Implements the memories API using fetch.
 */
class VertexAiMemoriesClient {
  private readonly project?: string;
  private readonly location?: string;
  private readonly apiKey?: string;
  private accessToken?: string;
  private tokenExpiry?: number;

  constructor(options: {project?: string; location?: string; apiKey?: string}) {
    this.project = options.project;
    this.location = options.location || 'us-central1';
    this.apiKey = options.apiKey;
  }

  /**
   * The memories API namespace.
   */
  readonly agentEngines = {
    memories: {
      /**
       * Generates memories from session events.
       */
      generate: async (options: {
        name: string;
        directContentsSource: {events: Array<{content: Record<string, unknown>}>};
        scope: {appName: string; userId: string};
        config: {waitForCompletion: boolean};
      }): Promise<unknown> => {
        const path = `/${options.name}:generateMemories`;
        return this.makeRequest('POST', path, {
          direct_contents_source: {events: options.directContentsSource.events},
          scope: {
            app_name: options.scope.appName,
            user_id: options.scope.userId,
          },
          config: {wait_for_completion: options.config.waitForCompletion},
        });
      },

      /**
       * Retrieves memories matching a query.
       */
      retrieve: async (options: {
        name: string;
        scope: {appName: string; userId: string};
        similaritySearchParams: {searchQuery: string};
      }): Promise<RetrievedMemory[]> => {
        const path = `/${options.name}:retrieveMemories`;
        const response = await this.makeRequest<{memories?: RetrievedMemory[]}>(
          'POST',
          path,
          {
            scope: {
              app_name: options.scope.appName,
              user_id: options.scope.userId,
            },
            similarity_search_params: {
              search_query: options.similaritySearchParams.searchQuery,
            },
          }
        );
        return response.memories || [];
      },
    },
  };

  private async getAccessToken(): Promise<string> {
    // If using API key, return empty string (API key is passed as query param)
    if (this.apiKey) {
      return '';
    }

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

  private async getDefaultProject(): Promise<string> {
    // Try to get project from environment
    const envProject =
      process.env['GOOGLE_CLOUD_PROJECT'] ||
      process.env['GCLOUD_PROJECT'] ||
      process.env['GCP_PROJECT'];
    if (envProject) {
      return envProject;
    }

    // Try to get from metadata service (for Cloud Run, GKE, etc.)
    try {
      const response = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/project/project-id',
        {headers: {'Metadata-Flavor': 'Google'}}
      );
      if (response.ok) {
        return await response.text();
      }
    } catch {
      // Ignore metadata service errors
    }

    throw new Error(
      'Could not determine Google Cloud project. ' +
        'Please set the GOOGLE_CLOUD_PROJECT environment variable or ' +
        'provide the project in the constructor options.'
    );
  }

  private getBaseUrl(): string {
    const location = this.location || 'us-central1';
    return `https://${location}-aiplatform.googleapis.com/v1beta1`;
  }

  private async makeRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const project = this.project || (await this.getDefaultProject());
    const baseUrl = this.getBaseUrl();
    let url = `${baseUrl}/projects/${project}/locations/${this.location}${path}`;

    // Add API key as query param if using Express Mode
    if (this.apiKey) {
      url += (url.includes('?') ? '&' : '?') + `key=${this.apiKey}`;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add Authorization header if not using API key
    if (!this.apiKey) {
      const token = await this.getAccessToken();
      headers['Authorization'] = `Bearer ${token}`;
    }

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
