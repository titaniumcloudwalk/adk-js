/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * HTTP client for interacting with the ADK web server for conformance tests.
 *
 * Provides methods for session management and agent execution with
 * Server-Sent Events streaming support.
 */

import {Event, Session} from '@google/adk';

/**
 * Request parameters for running an agent.
 */
export interface RunAgentRequest {
  /** Name of the application/agent. */
  appName: string;
  /** User identifier. */
  userId: string;
  /** Session identifier. */
  sessionId: string;
  /** The new message content to send. */
  newMessage: unknown;
  /** Whether to enable streaming mode. */
  streaming?: boolean;
  /** State changes to apply. */
  stateDelta?: Record<string, unknown>;
}

/**
 * HTTP client for interacting with the ADK web server for conformance tests.
 *
 * Usage patterns:
 *
 *   // Pattern 1: Manual lifecycle management
 *   const client = new AdkWebServerClient();
 *   const session = await client.createSession({appName: 'app', userId: 'user'});
 *   for await (const event of client.runAgent(request)) {
 *     // Process events...
 *   }
 *   await client.close();
 *
 *   // Pattern 2: Using try/finally
 *   const client = new AdkWebServerClient();
 *   try {
 *     const session = await client.createSession({appName: 'app', userId: 'user'});
 *     for await (const event of client.runAgent(request)) {
 *       // Process events...
 *     }
 *   } finally {
 *     await client.close();
 *   }
 */
export class AdkWebServerClient {
  private baseUrl: string;
  private timeout: number;

  /**
   * Initialize the ADK web server client for conformance testing.
   *
   * @param baseUrl Base URL of the ADK web server (default: http://127.0.0.1:8000)
   * @param timeout Request timeout in milliseconds (default: 30000)
   */
  constructor(baseUrl: string = 'http://127.0.0.1:8000', timeout: number = 30000) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = timeout;
  }

  /**
   * Close the HTTP client and clean up resources.
   */
  async close(): Promise<void> {
    // In Node.js fetch API, there's no persistent connection to close
    // This method is kept for API compatibility with Python
  }

  /**
   * Retrieve a specific session from the ADK web server.
   *
   * @param params Session retrieval parameters
   * @returns The requested Session object
   * @throws Error if the request fails or session not found
   */
  async getSession({
    appName,
    userId,
    sessionId,
  }: {
    appName: string;
    userId: string;
    sessionId: string;
  }): Promise<Session> {
    const url = `${this.baseUrl}/apps/${appName}/users/${userId}/sessions/${sessionId}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {'Content-Type': 'application/json'},
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to get session: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as Session;
  }

  /**
   * Create a new session in the ADK web server.
   *
   * @param params Session creation parameters
   * @returns The newly created Session object
   * @throws Error if the request fails
   */
  async createSession({
    appName,
    userId,
    state,
  }: {
    appName: string;
    userId: string;
    state?: Record<string, unknown>;
  }): Promise<Session> {
    const url = `${this.baseUrl}/apps/${appName}/users/${userId}/sessions`;
    const payload: Record<string, unknown> = {};
    if (state !== undefined) {
      payload.state = state;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as Session;
  }

  /**
   * Delete a session from the ADK web server.
   *
   * @param params Session deletion parameters
   * @throws Error if the request fails or session not found
   */
  async deleteSession({
    appName,
    userId,
    sessionId,
  }: {
    appName: string;
    userId: string;
    sessionId: string;
  }): Promise<void> {
    const url = `${this.baseUrl}/apps/${appName}/users/${userId}/sessions/${sessionId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {'Content-Type': 'application/json'},
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to delete session: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Update session state without running the agent.
   *
   * @param params Session update parameters
   * @returns The updated Session object
   * @throws Error if the request fails or session not found
   */
  async updateSession({
    appName,
    userId,
    sessionId,
    stateDelta,
  }: {
    appName: string;
    userId: string;
    sessionId: string;
    stateDelta: Record<string, unknown>;
  }): Promise<Session> {
    const url = `${this.baseUrl}/apps/${appName}/users/${userId}/sessions/${sessionId}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({state_delta: stateDelta}),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(`Failed to update session: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as Session;
  }

  /**
   * Run an agent with streaming Server-Sent Events response.
   *
   * @param request The RunAgentRequest containing agent execution parameters
   * @param mode Optional conformance mode ("record" or "replay") to trigger recording
   * @param testCaseDir Optional test case directory path for conformance recording
   * @param userMessageIndex Optional user message index for conformance recording
   * @yields Event objects streamed from the agent execution
   * @throws Error if mode is provided but testCaseDir or userMessageIndex is missing
   */
  async *runAgent(
    request: RunAgentRequest,
    mode?: 'record' | 'replay',
    testCaseDir?: string,
    userMessageIndex?: number
  ): AsyncGenerator<Event, void, unknown> {
    // Add recording parameters to state_delta for conformance tests
    if (mode) {
      if (testCaseDir === undefined || userMessageIndex === undefined) {
        throw new Error(
          'testCaseDir and userMessageIndex must be provided when mode is specified'
        );
      }

      if (!request.stateDelta) {
        request.stateDelta = {};
      }

      if (mode === 'replay') {
        request.stateDelta._adk_replay_config = {
          dir: testCaseDir,
          user_message_index: userMessageIndex,
        };
      } else {
        request.stateDelta._adk_recordings_config = {
          dir: testCaseDir,
          user_message_index: userMessageIndex,
        };
      }
    }

    const url = `${this.baseUrl}/run_sse`;
    const payload = {
      appName: request.appName,
      userId: request.userId,
      sessionId: request.sessionId,
      newMessage: request.newMessage,
      streaming: request.streaming ?? false,
      stateDelta: request.stateDelta,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeout * 10), // Longer timeout for streaming
    });

    if (!response.ok) {
      throw new Error(`Failed to run agent: ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body reader available');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, {stream: true});

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data) {
              try {
                const event = JSON.parse(data) as Event;
                yield event;
              } catch (e) {
                console.warn('Failed to parse SSE event data:', data);
              }
            }
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.trim()) {
        const lines = buffer.split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data) {
              try {
                const event = JSON.parse(data) as Event;
                yield event;
              } catch (e) {
                console.warn('Failed to parse final SSE event data:', data);
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
