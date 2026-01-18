/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, GroundingMetadata} from '@google/genai';

import {createEvent, Event} from '../events/event.js';
import {createEventActions, EventActions} from '../events/event_actions.js';
import {logger} from '../utils/logger.js';

import {
  BaseSessionService,
  CreateSessionRequest,
  DeleteSessionRequest,
  GetSessionConfig,
  GetSessionRequest,
  ListSessionsRequest,
  ListSessionsResponse,
} from './base_session_service.js';
import {createSession, Session} from './session.js';
import {State} from './state.js';

/**
 * Options for configuring the VertexAiSessionService.
 */
export interface VertexAiSessionServiceOptions {
  /**
   * The project id of the project to use.
   */
  project?: string;

  /**
   * The location of the project to use.
   */
  location?: string;

  /**
   * The resource ID of the agent engine to use.
   */
  agentEngineId?: string;

  /**
   * The API key to use for Express Mode.
   * If not provided, the API key from the GOOGLE_API_KEY environment variable
   * will be used. It will only be used if GOOGLE_GENAI_USE_VERTEXAI is true.
   * Do not use Google AI Studio API key for this field.
   * @see https://cloud.google.com/vertex-ai/generative-ai/docs/start/express-mode/overview
   */
  expressModeApiKey?: string;
}

/**
 * Session data returned from the Vertex AI API.
 */
interface ApiSession {
  name: string;
  userId?: string;
  user_id?: string;
  sessionState?: Record<string, unknown>;
  session_state?: Record<string, unknown>;
  updateTime?: Date|string;
  update_time?: Date|string;
}

/**
 * Event metadata from the Vertex AI API.
 */
interface ApiEventMetadata {
  partial?: boolean;
  turnComplete?: boolean;
  turn_complete?: boolean;
  interrupted?: boolean;
  branch?: string;
  customMetadata?: Record<string, unknown>;
  custom_metadata?: Record<string, unknown>;
  longRunningToolIds?: string[];
  long_running_tool_ids?: string[];
  groundingMetadata?: GroundingMetadata;
  grounding_metadata?: GroundingMetadata;
}

/**
 * Event actions from the Vertex AI API.
 */
interface ApiEventActions {
  skipSummarization?: boolean;
  skip_summarization?: boolean;
  stateDelta?: Record<string, unknown>;
  state_delta?: Record<string, unknown>;
  artifactDelta?: Record<string, number>;
  artifact_delta?: Record<string, number>;
  transferAgent?: string;
  transfer_agent?: string;
  escalate?: boolean;
  requestedAuthConfigs?: Record<string, unknown>;
  requested_auth_configs?: Record<string, unknown>;
}

/**
 * Event data returned from the Vertex AI API.
 */
interface ApiEvent {
  name: string;
  invocationId?: string;
  invocation_id?: string;
  author?: string;
  content?: Content;
  actions?: ApiEventActions;
  timestamp?: Date|string;
  errorCode?: string;
  error_code?: string;
  errorMessage?: string;
  error_message?: string;
  eventMetadata?: ApiEventMetadata;
  event_metadata?: ApiEventMetadata;
}

/**
 * Vertex AI Agent Engine Sessions REST API client.
 * Implements the sessions API using fetch.
 * @see https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/sessions/overview
 */
class VertexAiSessionsClient {
  private readonly project?: string;
  private readonly location?: string;
  private readonly apiKey?: string;
  private accessToken?: string;
  private tokenExpiry?: number;

  constructor(options: {
    project?: string;
    location?: string;
    apiKey?: string;
  }) {
    this.project = options.project;
    this.location = options.location || 'us-central1';
    this.apiKey = options.apiKey;
  }

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
          `Original error: ${error}`);
    }
  }

  private getBaseUrl(): string {
    const location = this.location || 'us-central1';
    return `https://${location}-aiplatform.googleapis.com/v1beta1`;
  }

  private async makeRequest<T>(
      method: string,
      path: string,
      body?: Record<string, unknown>,
  ): Promise<T> {
    const baseUrl = this.getBaseUrl();
    let url = `${baseUrl}${path}`;

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
      const error = new Error(`API request failed: ${response.status} - ${errorText}`);
      (error as unknown as {code: number}).code = response.status;
      throw error;
    }

    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  async createSession(options: {
    reasoningEngineId: string;
    userId: string;
    sessionState?: Record<string, unknown>;
  }): Promise<ApiSession> {
    const project = this.project || await this.getDefaultProject();
    const location = this.location || 'us-central1';
    const path = `/projects/${project}/locations/${location}/reasoningEngines/${options.reasoningEngineId}/sessions`;

    const body: Record<string, unknown> = {
      userId: options.userId,
    };
    if (options.sessionState) {
      body['sessionState'] = options.sessionState;
    }

    return this.makeRequest<ApiSession>('POST', path, body);
  }

  async getSession(options: {
    reasoningEngineId: string;
    sessionId: string;
  }): Promise<ApiSession> {
    const project = this.project || await this.getDefaultProject();
    const location = this.location || 'us-central1';
    const path = `/projects/${project}/locations/${location}/reasoningEngines/${options.reasoningEngineId}/sessions/${options.sessionId}`;

    return this.makeRequest<ApiSession>('GET', path);
  }

  async listSessions(options: {
    reasoningEngineId: string;
    filter?: string;
  }): Promise<{sessions: ApiSession[]}> {
    const project = this.project || await this.getDefaultProject();
    const location = this.location || 'us-central1';
    let path = `/projects/${project}/locations/${location}/reasoningEngines/${options.reasoningEngineId}/sessions`;

    if (options.filter) {
      path += `?filter=${encodeURIComponent(options.filter)}`;
    }

    const response = await this.makeRequest<{sessions?: ApiSession[]}>('GET', path);
    return {sessions: response.sessions || []};
  }

  async deleteSession(options: {
    reasoningEngineId: string;
    sessionId: string;
  }): Promise<void> {
    const project = this.project || await this.getDefaultProject();
    const location = this.location || 'us-central1';
    const path = `/projects/${project}/locations/${location}/reasoningEngines/${options.reasoningEngineId}/sessions/${options.sessionId}`;

    await this.makeRequest<void>('DELETE', path);
  }

  async listEvents(options: {
    reasoningEngineId: string;
    sessionId: string;
    filter?: string;
  }): Promise<{events: ApiEvent[]}> {
    const project = this.project || await this.getDefaultProject();
    const location = this.location || 'us-central1';
    let path = `/projects/${project}/locations/${location}/reasoningEngines/${options.reasoningEngineId}/sessions/${options.sessionId}/events`;

    if (options.filter) {
      path += `?filter=${encodeURIComponent(options.filter)}`;
    }

    const response = await this.makeRequest<{events?: ApiEvent[]}>('GET', path);
    return {events: response.events || []};
  }

  async appendEvent(options: {
    reasoningEngineId: string;
    sessionId: string;
    author?: string;
    invocationId: string;
    timestamp: Date;
    content?: unknown;
    actions?: unknown;
    eventMetadata?: unknown;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    const project = this.project || await this.getDefaultProject();
    const location = this.location || 'us-central1';
    const path = `/projects/${project}/locations/${location}/reasoningEngines/${options.reasoningEngineId}/sessions/${options.sessionId}/events:append`;

    const body: Record<string, unknown> = {
      author: options.author,
      invocationId: options.invocationId,
      timestamp: options.timestamp.toISOString(),
    };

    if (options.content) {
      body['content'] = options.content;
    }
    if (options.actions) {
      body['actions'] = options.actions;
    }
    if (options.eventMetadata) {
      body['eventMetadata'] = options.eventMetadata;
    }
    if (options.errorCode) {
      body['errorCode'] = options.errorCode;
    }
    if (options.errorMessage) {
      body['errorMessage'] = options.errorMessage;
    }

    await this.makeRequest<void>('POST', path, body);
  }

  private async getDefaultProject(): Promise<string> {
    // Try to get project from environment
    const envProject = process.env['GOOGLE_CLOUD_PROJECT'] ||
                       process.env['GCLOUD_PROJECT'] ||
                       process.env['GCP_PROJECT'];
    if (envProject) {
      return envProject;
    }

    // Try to get from metadata service (for Cloud Run, GKE, etc.)
    try {
      const response = await fetch(
          'http://metadata.google.internal/computeMetadata/v1/project/project-id',
          {headers: {'Metadata-Flavor': 'Google'}});
      if (response.ok) {
        return await response.text();
      }
    } catch {
      // Ignore metadata service errors
    }

    throw new Error(
        'Could not determine Google Cloud project. ' +
        'Please set the GOOGLE_CLOUD_PROJECT environment variable or ' +
        'provide the project in the constructor options.');
  }
}

/**
 * Gets the Express Mode API key.
 * Returns the API key for Vertex AI Express Mode if applicable.
 */
function getExpressModeApiKey(
    project?: string,
    location?: string,
    expressModeApiKey?: string,
): string|undefined {
  if ((project || location) && expressModeApiKey) {
    throw new Error(
        'Cannot specify project or location and expressModeApiKey. ' +
        'Either use project and location, or just the expressModeApiKey.');
  }

  const useVertexAi = (process.env['GOOGLE_GENAI_USE_VERTEXAI'] || '')
                          .toLowerCase();
  if (['true', '1'].includes(useVertexAi)) {
    return expressModeApiKey || process.env['GOOGLE_API_KEY'];
  }

  return undefined;
}

/**
 * Converts an API event object to an Event object.
 */
function fromApiEvent(apiEvent: ApiEvent): Event {
  // Handle actions
  const apiActions = apiEvent.actions;
  let eventActions: EventActions;

  if (apiActions) {
    // Handle both camelCase and snake_case from API
    eventActions = createEventActions({
      skipSummarization: apiActions.skipSummarization ??
          apiActions.skip_summarization,
      stateDelta: apiActions.stateDelta ?? apiActions.state_delta ?? {},
      artifactDelta: apiActions.artifactDelta ?? apiActions.artifact_delta ?? {},
      transferToAgent: apiActions.transferAgent ?? apiActions.transfer_agent,
      escalate: apiActions.escalate,
      requestedAuthConfigs: (apiActions.requestedAuthConfigs ??
                             apiActions.requested_auth_configs ??
                             {}) as Record<string, unknown>,
    });
  } else {
    eventActions = createEventActions();
  }

  // Handle event metadata
  const eventMetadata =
      apiEvent.eventMetadata ?? apiEvent.event_metadata;
  let longRunningToolIds: string[]|undefined;
  let partial: boolean|undefined;
  let turnComplete: boolean|undefined;
  let interrupted: boolean|undefined;
  let branch: string|undefined;
  let customMetadata: Record<string, unknown>|undefined;
  let groundingMetadata: GroundingMetadata|undefined;

  if (eventMetadata) {
    const toolIds = eventMetadata.longRunningToolIds ??
        eventMetadata.long_running_tool_ids;
    longRunningToolIds = toolIds ? [...toolIds] : undefined;
    partial = eventMetadata.partial;
    turnComplete =
        eventMetadata.turnComplete ?? eventMetadata.turn_complete;
    interrupted = eventMetadata.interrupted;
    branch = eventMetadata.branch;
    customMetadata =
        eventMetadata.customMetadata ?? eventMetadata.custom_metadata;
    groundingMetadata =
        eventMetadata.groundingMetadata ?? eventMetadata.grounding_metadata;
  }

  // Extract event ID from resource name (last segment)
  const eventId = apiEvent.name.split('/').pop() || '';

  // Parse timestamp
  const timestampValue = apiEvent.timestamp;
  let timestamp: number;
  if (timestampValue instanceof Date) {
    timestamp = timestampValue.getTime();
  } else if (typeof timestampValue === 'string') {
    timestamp = new Date(timestampValue).getTime();
  } else {
    timestamp = Date.now();
  }

  return createEvent({
    id: eventId,
    invocationId: apiEvent.invocationId ?? apiEvent.invocation_id ?? '',
    author: apiEvent.author,
    actions: eventActions,
    content: apiEvent.content,
    timestamp,
    errorCode: apiEvent.errorCode ?? apiEvent.error_code,
    errorMessage: apiEvent.errorMessage ?? apiEvent.error_message,
    partial,
    turnComplete,
    interrupted,
    branch,
    customMetadata,
    groundingMetadata,
    longRunningToolIds,
  });
}

/**
 * Connects to the Vertex AI Agent Engine Session Service.
 *
 * @see https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/sessions/overview
 *
 * @example
 * ```typescript
 * const service = new VertexAiSessionService({
 *   project: 'my-project',
 *   location: 'us-central1',
 *   agentEngineId: '1234567890',
 * });
 *
 * const session = await service.createSession({
 *   appName: '1234567890',  // or full resource name
 *   userId: 'user-123',
 *   state: { counter: 0 }
 * });
 * ```
 */
export class VertexAiSessionService extends BaseSessionService {
  private readonly project?: string;
  private readonly location?: string;
  private readonly agentEngineId?: string;
  private readonly expressModeApiKey?: string;
  private client?: VertexAiSessionsClient;

  /**
   * Creates a new VertexAiSessionService.
   *
   * @param options Configuration options for the service.
   */
  constructor(options: VertexAiSessionServiceOptions = {}) {
    super();
    this.project = options.project;
    this.location = options.location;
    this.agentEngineId = options.agentEngineId;
    this.expressModeApiKey = getExpressModeApiKey(
        options.project,
        options.location,
        options.expressModeApiKey,
    );
  }

  /**
   * Creates a new session.
   *
   * Note: User-provided session IDs are not supported for VertexAiSessionService.
   * The session ID will be generated by the Vertex AI service.
   *
   * @param request The request to create a session.
   * @returns A promise that resolves to the newly created session instance.
   * @throws Error if a session ID is provided (not supported).
   */
  override async createSession({
    appName,
    userId,
    state,
    sessionId,
  }: CreateSessionRequest): Promise<Session> {
    if (sessionId) {
      throw new Error(
          'User-provided Session id is not supported for VertexAiSessionService.');
    }

    const reasoningEngineId = this.getReasoningEngineId(appName);
    const client = this.getApiClient();

    const apiResponse = await client.createSession({
      reasoningEngineId,
      userId,
      sessionState: state,
    });

    logger.debug('Create session response:', apiResponse);

    const newSessionId = apiResponse.name.split('/').pop() || '';

    // Parse update time
    const updateTimeValue =
        apiResponse.updateTime ?? apiResponse.update_time;
    let lastUpdateTime: number;
    if (updateTimeValue instanceof Date) {
      lastUpdateTime = updateTimeValue.getTime();
    } else if (typeof updateTimeValue === 'string') {
      lastUpdateTime = new Date(updateTimeValue).getTime();
    } else {
      lastUpdateTime = Date.now();
    }

    const sessionState = apiResponse.sessionState ??
        apiResponse.session_state ?? {};

    return createSession({
      id: newSessionId,
      appName,
      userId,
      state: sessionState,
      events: [],
      lastUpdateTime,
    });
  }

  /**
   * Gets a session.
   *
   * @param request The request to get a session.
   * @returns A promise that resolves to the session instance or undefined if not found.
   */
  override async getSession({
    appName,
    userId,
    sessionId,
    config,
  }: GetSessionRequest): Promise<Session|undefined> {
    const reasoningEngineId = this.getReasoningEngineId(appName);
    const client = this.getApiClient();

    // Build event filter
    let eventsFilter: string|undefined;
    if (config && !config.numRecentEvents && config.afterTimestamp) {
      // Filter events based on timestamp
      const afterDate = new Date(config.afterTimestamp);
      eventsFilter = `timestamp>="${afterDate.toISOString()}"`;
    }

    try {
      // Get session resource and events in parallel
      const [getSessionResponse, eventsResponse] = await Promise.all([
        client.getSession({reasoningEngineId, sessionId}),
        client.listEvents({reasoningEngineId, sessionId, filter: eventsFilter}),
      ]);

      // Check user ownership
      const responseUserId =
          getSessionResponse.userId ?? getSessionResponse.user_id;
      if (responseUserId !== userId) {
        throw new Error(
            `Session ${sessionId} does not belong to user ${userId}.`);
      }

      // Parse update time
      const updateTimeValue =
          getSessionResponse.updateTime ?? getSessionResponse.update_time;
      let lastUpdateTime: number;
      if (updateTimeValue instanceof Date) {
        lastUpdateTime = updateTimeValue.getTime();
      } else if (typeof updateTimeValue === 'string') {
        lastUpdateTime = new Date(updateTimeValue).getTime();
      } else {
        lastUpdateTime = Date.now();
      }

      const sessionState = getSessionResponse.sessionState ??
          getSessionResponse.session_state ?? {};

      const session = createSession({
        id: sessionId,
        appName,
        userId,
        state: sessionState,
        events: [],
        lastUpdateTime,
      });

      // Collect all events
      // Preserve the entire event stream that Vertex returns rather than trying
      // to discard events written milliseconds after the session resource was
      // updated. Clock skew between those writes can otherwise drop tool_result
      // events and permanently break the replayed conversation.
      for (const apiEvent of eventsResponse.events) {
        session.events.push(fromApiEvent(apiEvent));
      }

      // Apply numRecentEvents filter if specified
      if (config?.numRecentEvents && session.events.length > 0) {
        session.events = session.events.slice(-config.numRecentEvents);
      }

      return session;
    } catch (error: unknown) {
      // Handle 404 (session not found)
      if (error && typeof error === 'object' && 'code' in error &&
          error.code === 404) {
        logger.debug(
            `Session ${sessionId} not found in Vertex AI Agent Engine.`);
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Lists sessions for an app/user.
   *
   * @param request The request to list sessions.
   * @returns A promise that resolves to a list of sessions.
   */
  override async listSessions({
    appName,
    userId,
  }: ListSessionsRequest): Promise<ListSessionsResponse> {
    const reasoningEngineId = this.getReasoningEngineId(appName);
    const client = this.getApiClient();

    const filter = userId ? `user_id="${userId}"` : undefined;

    const response = await client.listSessions({
      reasoningEngineId,
      filter,
    });

    const sessions: Session[] = [];

    for (const apiSession of response.sessions) {
      const apiUserId = apiSession.userId ?? apiSession.user_id ?? '';
      const apiSessionId = apiSession.name.split('/').pop() || '';

      // Parse update time
      const updateTimeValue =
          apiSession.updateTime ?? apiSession.update_time;
      let lastUpdateTime: number;
      if (updateTimeValue instanceof Date) {
        lastUpdateTime = updateTimeValue.getTime();
      } else if (typeof updateTimeValue === 'string') {
        lastUpdateTime = new Date(updateTimeValue).getTime();
      } else {
        lastUpdateTime = Date.now();
      }

      const sessionState =
          apiSession.sessionState ?? apiSession.session_state ?? {};

      sessions.push(createSession({
        id: apiSessionId,
        appName,
        userId: apiUserId,
        state: sessionState,
        events: [],
        lastUpdateTime,
      }));
    }

    return {sessions};
  }

  /**
   * Deletes a session.
   *
   * @param request The request to delete a session.
   * @returns A promise that resolves when the session is deleted.
   */
  override async deleteSession({
    appName,
    userId,
    sessionId,
  }: DeleteSessionRequest): Promise<void> {
    const reasoningEngineId = this.getReasoningEngineId(appName);
    const client = this.getApiClient();

    try {
      await client.deleteSession({reasoningEngineId, sessionId});
    } catch (error) {
      logger.error(`Error deleting session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Appends an event to a session.
   *
   * @param request The request to append an event.
   * @returns A promise that resolves to the event that was appended.
   */
  override async appendEvent({
    session,
    event,
  }: {
    session: Session;
    event: Event;
  }): Promise<Event> {
    // Update the in-memory session
    await super.appendEvent({session, event});

    // Skip partial events (not persisted)
    if (event.partial) {
      return event;
    }

    const reasoningEngineId = this.getReasoningEngineId(session.appName);

    // Build config for API call
    const config: Record<string, unknown> = {};

    if (event.content) {
      config['content'] = event.content;
    }

    if (event.actions) {
      // Trim temp state before sending to API
      const trimmedStateDelta: Record<string, unknown> = {};
      if (event.actions.stateDelta) {
        for (const [key, value] of Object.entries(event.actions.stateDelta)) {
          if (!key.startsWith(State.TEMP_PREFIX)) {
            trimmedStateDelta[key] = value;
          }
        }
      }

      config['actions'] = {
        skip_summarization: event.actions.skipSummarization,
        state_delta: trimmedStateDelta,
        artifact_delta: event.actions.artifactDelta,
        transfer_agent: event.actions.transferToAgent,
        escalate: event.actions.escalate,
        requested_auth_configs: event.actions.requestedAuthConfigs,
        // TODO: add requested_tool_confirmations, compaction, agent_state once
        // they are available in the API.
      };
    }

    if (event.errorCode) {
      config['error_code'] = event.errorCode;
    }
    if (event.errorMessage) {
      config['error_message'] = event.errorMessage;
    }

    // Build event metadata
    const metadataDict: Record<string, unknown> = {
      partial: event.partial,
      turn_complete: event.turnComplete,
      interrupted: event.interrupted,
      branch: event.branch,
      custom_metadata: event.customMetadata,
      long_running_tool_ids: event.longRunningToolIds ?
          [...event.longRunningToolIds] :
          undefined,
    };

    if (event.groundingMetadata) {
      metadataDict['grounding_metadata'] = event.groundingMetadata;
    }

    const client = this.getApiClient();

    await client.appendEvent({
      reasoningEngineId,
      sessionId: session.id,
      author: event.author,
      invocationId: event.invocationId,
      timestamp: new Date(event.timestamp),
      content: config['content'],
      actions: config['actions'],
      eventMetadata: metadataDict,
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
    });

    return event;
  }

  /**
   * Gets the reasoning engine ID from the app name.
   * The app name can be:
   * - Just the reasoning engine ID (numeric)
   * - Full resource name: projects/{project}/locations/{location}/reasoningEngines/{id}
   *
   * @param appName The app name to parse.
   * @returns The reasoning engine ID.
   */
  private getReasoningEngineId(appName: string): string {
    if (this.agentEngineId) {
      return this.agentEngineId;
    }

    // Check if it's just a numeric ID
    if (/^\d+$/.test(appName)) {
      return appName;
    }

    // Try to parse full resource name
    const pattern =
        /^projects\/([a-zA-Z0-9-_]+)\/locations\/([a-zA-Z0-9-_]+)\/reasoningEngines\/(\d+)$/;
    const match = appName.match(pattern);

    if (!match) {
      throw new Error(
          `App name ${appName} is not valid. It should either be the full ` +
          'ReasoningEngine resource name, or the reasoning engine id.');
    }

    return match[3];
  }

  /**
   * Gets the API client instance (lazily created).
   */
  private getApiClient(): VertexAiSessionsClient {
    if (!this.client) {
      this.client = new VertexAiSessionsClient({
        project: this.project,
        location: this.location,
        apiKey: this.expressModeApiKey,
      });
    }
    return this.client;
  }
}
