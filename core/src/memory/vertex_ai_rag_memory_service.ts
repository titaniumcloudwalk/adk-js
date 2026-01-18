/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, VertexRagStore, VertexRagStoreRagResource} from '@google/genai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {Event, createEvent} from '../events/event.js';
import {Session} from '../sessions/session.js';
import {logger} from '../utils/logger.js';

import {
  BaseMemoryService,
  SearchMemoryRequest,
  SearchMemoryResponse,
} from './base_memory_service.js';
import {MemoryEntry} from './memory_entry.js';

/**
 * Options for configuring the VertexAiRagMemoryService.
 */
export interface VertexAiRagMemoryServiceOptions {
  /**
   * The RAG corpus identifier. Can be in full format:
   * `projects/{project}/locations/{location}/ragCorpora/{rag_corpus_id}`
   * or just the ID: `{rag_corpus_id}`
   */
  ragCorpus?: string;

  /**
   * The number of contexts to retrieve during searches.
   */
  similarityTopK?: number;

  /**
   * Only returns contexts with vector distance smaller than this threshold.
   * Default is 10.
   */
  vectorDistanceThreshold?: number;

  /**
   * The project ID for Vertex AI RAG API calls.
   * If not provided, will attempt to detect from environment.
   */
  project?: string;

  /**
   * The location for Vertex AI RAG API calls.
   * Default is 'us-central1'.
   */
  location?: string;
}

/**
 * Parsed event data from JSON lines format.
 */
interface ParsedEventData {
  author: string;
  timestamp: string;
  text: string;
}

/**
 * Context returned from RAG retrieval query.
 */
interface RagContext {
  sourceDisplayName?: string;
  text: string;
}

/**
 * Response from RAG retrieval query.
 */
interface RagRetrievalResponse {
  contexts?: RagContext[];
}

/**
 * Implementation of the BaseMemoryService using Vertex AI RAG.
 *
 * This service uses Vertex AI RAG (Retrieval-Augmented Generation) for memory
 * storage and retrieval. It uploads session events as files to a RAG corpus
 * and uses semantic similarity search for retrieval.
 *
 * @example
 * ```typescript
 * const memoryService = new VertexAiRagMemoryService({
 *   ragCorpus: 'projects/my-project/locations/us-central1/ragCorpora/my-corpus',
 *   similarityTopK: 5,
 *   vectorDistanceThreshold: 10,
 * });
 *
 * // Add session to memory
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
export class VertexAiRagMemoryService implements BaseMemoryService {
  private readonly vertexRagStore: VertexRagStore;
  private readonly project?: string;
  private readonly location: string;

  constructor(options: VertexAiRagMemoryServiceOptions = {}) {
    // Build RAG resources from ragCorpus if provided
    let ragResources: VertexRagStoreRagResource[] | undefined;
    if (options.ragCorpus) {
      ragResources = [{ragCorpus: options.ragCorpus}];
    }

    this.vertexRagStore = {
      ragResources,
      similarityTopK: options.similarityTopK,
      vectorDistanceThreshold: options.vectorDistanceThreshold ?? 10,
    };

    this.project = options.project;
    this.location = options.location || 'us-central1';
  }

  /**
   * Gets the RAG resources from the store configuration.
   */
  private getRagResources(): VertexRagStoreRagResource[] {
    if (!this.vertexRagStore.ragResources?.length) {
      throw new Error(
        'RAG resources not set. Provide ragCorpus in constructor options.'
      );
    }
    return this.vertexRagStore.ragResources;
  }

  /**
   * Adds a session to memory by uploading it to the RAG corpus.
   *
   * This method:
   * 1. Creates a temporary file with session events as JSON lines
   * 2. Uploads the file to each RAG resource
   * 3. Cleans up the temporary file
   *
   * @param session The session to add to memory.
   */
  async addSessionToMemory(session: Session): Promise<void> {
    const ragResources = this.getRagResources();
    const displayName = `${session.appName}.${session.userId}.${session.id}`;

    // Create temporary file with .txt extension
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `rag_memory_${Date.now()}.txt`);

    try {
      // Format events as JSON lines
      const lines: string[] = [];
      for (const event of session.events) {
        if (!event.content?.parts?.length) {
          continue;
        }

        // Extract text parts, replacing newlines with spaces
        const textParts: string[] = [];
        for (const part of event.content.parts) {
          if (part.text) {
            textParts.push(part.text.replace(/\n/g, ' '));
          }
        }

        if (textParts.length === 0) {
          continue;
        }

        // Format as JSON line with author, timestamp, and text
        const eventData: ParsedEventData = {
          author: event.author || 'unknown',
          timestamp: formatTimestamp(event.timestamp),
          text: textParts.join('. '),
        };
        lines.push(JSON.stringify(eventData));
      }

      if (lines.length === 0) {
        logger.info('No events with text content to add to RAG memory.');
        return;
      }

      // Write to temp file
      fs.writeFileSync(tempFilePath, lines.join('\n'), 'utf-8');

      // Upload to each RAG resource
      const client = await this.getApiClient();
      for (const ragResource of ragResources) {
        if (!ragResource.ragCorpus) {
          continue;
        }

        await client.uploadFile({
          ragCorpus: ragResource.ragCorpus,
          filePath: tempFilePath,
          displayName,
        });

        logger.info(
          `Uploaded session memory to RAG corpus: ${ragResource.ragCorpus}`
        );
      }
    } finally {
      // Clean up temp file
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (cleanupError) {
        logger.warn(`Failed to clean up temp file: ${cleanupError}`);
      }
    }
  }

  /**
   * Searches for memories matching the query using semantic similarity.
   *
   * This method:
   * 1. Queries the RAG corpus for matching contexts
   * 2. Filters contexts by app_name.user_id prefix
   * 3. Parses JSON lines from each context
   * 4. Merges overlapping event lists
   * 5. Returns sorted memory entries
   *
   * @param request The search request containing appName, userId, and query.
   * @returns A promise that resolves to SearchMemoryResponse.
   */
  async searchMemory(request: SearchMemoryRequest): Promise<SearchMemoryResponse> {
    // Validate RAG resources are configured before making API call
    this.getRagResources();

    const client = await this.getApiClient();

    // Query RAG for matching contexts
    const response = await client.retrievalQuery({
      query: request.query,
      ragStore: this.vertexRagStore,
    });

    // Build prefix for filtering by app_name.user_id
    const userPrefix = `${request.appName}.${request.userId}.`;

    // Group events by session_id
    const sessionEventsMap = new Map<string, Event[]>();

    if (response.contexts) {
      for (const context of response.contexts) {
        // Filter by user prefix in display name
        if (!context.sourceDisplayName?.startsWith(userPrefix)) {
          continue;
        }

        // Extract session_id from display name (format: appName.userId.sessionId)
        const sessionId = context.sourceDisplayName.slice(userPrefix.length);

        // Parse JSON lines from context text
        const events: Event[] = [];
        const lines = context.text.split('\n').filter((line) => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line) as ParsedEventData;
            const event = createEvent({
              author: data.author,
              timestamp: new Date(data.timestamp).getTime(),
              content: {
                parts: [{text: data.text}],
                role: data.author === 'user' ? 'user' : 'model',
              } as Content,
            });
            events.push(event);
          } catch (parseError) {
            logger.debug(`Failed to parse event line: ${parseError}`);
          }
        }

        if (events.length > 0) {
          if (!sessionEventsMap.has(sessionId)) {
            sessionEventsMap.set(sessionId, []);
          }
          sessionEventsMap.get(sessionId)!.push(...events);
        }
      }
    }

    // Get event lists and merge overlapping ones
    const eventLists = Array.from(sessionEventsMap.values());
    const mergedLists = mergeEventLists(eventLists);

    // Flatten and sort by timestamp
    const allEvents: Event[] = [];
    for (const eventList of mergedLists) {
      allEvents.push(...eventList);
    }
    allEvents.sort((a, b) => a.timestamp - b.timestamp);

    // Convert to MemoryEntry
    const memories: MemoryEntry[] = allEvents.map((event) => ({
      content: event.content || {parts: [], role: 'user'},
      author: event.author,
      timestamp: formatTimestamp(event.timestamp),
    }));

    return {memories};
  }

  /**
   * Gets an API client for Vertex AI RAG operations.
   */
  private async getApiClient(): Promise<VertexAiRagClient> {
    return new VertexAiRagClient({
      project: this.project,
      location: this.location,
    });
  }
}

/**
 * Formats a timestamp to ISO 8601 string format.
 */
function formatTimestamp(timestamp: number | Date | string | undefined): string {
  if (!timestamp) {
    return new Date().toISOString();
  }
  if (timestamp instanceof Date) {
    return timestamp.toISOString();
  }
  if (typeof timestamp === 'number') {
    return new Date(timestamp).toISOString();
  }
  // If already a string, try to parse and re-format for consistency
  const parsed = new Date(timestamp);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return timestamp;
}

/**
 * Merges event lists that have overlapping timestamps.
 *
 * This function combines event lists that share common timestamps,
 * removing duplicates in the process.
 *
 * @param eventLists Array of event lists to merge.
 * @returns Array of merged event lists with no overlaps within each list.
 */
function mergeEventLists(eventLists: Event[][]): Event[][] {
  if (eventLists.length === 0) {
    return [];
  }

  // Make a copy to avoid modifying the original
  const lists = eventLists.map((list) => [...list]);
  const result: Event[][] = [];

  while (lists.length > 0) {
    const current = lists.shift()!;
    const currentTimestamps = new Set(current.map((e) => e.timestamp));

    let mergeFound = true;
    while (mergeFound) {
      mergeFound = false;

      for (let i = lists.length - 1; i >= 0; i--) {
        const other = lists[i];
        const otherTimestamps = new Set(other.map((e) => e.timestamp));

        // Check for intersection
        const hasOverlap = [...currentTimestamps].some((ts) =>
          otherTimestamps.has(ts)
        );

        if (hasOverlap) {
          // Add events from other list that aren't already in current
          for (const event of other) {
            if (!currentTimestamps.has(event.timestamp)) {
              current.push(event);
              currentTimestamps.add(event.timestamp);
            }
          }

          // Remove the merged list
          lists.splice(i, 1);
          mergeFound = true;
        }
      }
    }

    result.push(current);
  }

  return result;
}

/**
 * Vertex AI RAG REST API client.
 * Implements the RAG API using fetch.
 */
class VertexAiRagClient {
  private readonly project?: string;
  private readonly location: string;
  private accessToken?: string;
  private tokenExpiry?: number;

  constructor(options: {project?: string; location?: string}) {
    this.project = options.project;
    this.location = options.location || 'us-central1';
  }

  /**
   * Uploads a file to the RAG corpus.
   */
  async uploadFile(options: {
    ragCorpus: string;
    filePath: string;
    displayName: string;
  }): Promise<void> {
    const project = this.project || (await this.getDefaultProject());
    const token = await this.getAccessToken();

    // Determine if ragCorpus is full path or just ID
    let corpusPath = options.ragCorpus;
    if (!corpusPath.startsWith('projects/')) {
      corpusPath = `projects/${project}/locations/${this.location}/ragCorpora/${corpusPath}`;
    }

    const baseUrl = `https://${this.location}-aiplatform.googleapis.com/v1`;
    const url = `${baseUrl}/${corpusPath}/ragFiles:import`;

    // Read file content and encode as base64
    const fileContent = fs.readFileSync(options.filePath);
    const base64Content = fileContent.toString('base64');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        importRagFilesConfig: {
          ragFileChunkingConfig: {
            chunkSize: 1024,
            chunkOverlap: 200,
          },
          ragFileParsingConfig: {
            useAdvancedPdfParsing: false,
          },
        },
        uploadRagFileConfig: {
          ragFile: {
            displayName: options.displayName,
            description: `Memory session: ${options.displayName}`,
          },
        },
        // Use inline content since we have the file locally
        inlineSource: {
          ragFileInputs: [
            {
              content: base64Content,
              displayName: options.displayName,
            },
          ],
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`RAG upload failed: ${response.status} - ${errorText}`);
    }

    logger.debug(`RAG file upload response: ${await response.text()}`);
  }

  /**
   * Queries the RAG store for matching contexts.
   */
  async retrievalQuery(options: {
    query: string;
    ragStore: VertexRagStore;
  }): Promise<RagRetrievalResponse> {
    const project = this.project || (await this.getDefaultProject());
    const token = await this.getAccessToken();

    const baseUrl = `https://${this.location}-aiplatform.googleapis.com/v1`;
    const url = `${baseUrl}/projects/${project}/locations/${this.location}:retrieveContexts`;

    // Build RAG resources for the query
    const ragResources =
      options.ragStore.ragResources?.map((r) => {
        let corpusPath = r.ragCorpus;
        if (corpusPath && !corpusPath.startsWith('projects/')) {
          corpusPath = `projects/${project}/locations/${this.location}/ragCorpora/${corpusPath}`;
        }
        return {ragCorpus: corpusPath};
      }) || [];

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        vertexRagStore: {
          ragResources,
          similarityTopK: options.ragStore.similarityTopK,
          vectorDistanceThreshold: options.ragStore.vectorDistanceThreshold,
        },
        query: {
          text: options.query,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `RAG retrieval query failed: ${response.status} - ${errorText}`
      );
    }

    const result = (await response.json()) as {
      contexts?: {contexts?: Array<{sourceDisplayName?: string; text?: string}>};
    };

    // Map to our expected format
    const contexts: RagContext[] =
      result.contexts?.contexts?.map((c) => ({
        sourceDisplayName: c.sourceDisplayName,
        text: c.text || '',
      })) || [];

    return {contexts};
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
}
