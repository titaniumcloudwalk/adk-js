/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type BetterSqlite3 from 'better-sqlite3';

import {AlreadyExistsError} from '../errors/already_exists_error.js';
import {Event} from '../events/event.js';
import {randomUUID} from '../utils/env_aware_utils.js';
import {logger} from '../utils/logger.js';

import {
  AppendEventRequest,
  BaseSessionService,
  CreateSessionRequest,
  DeleteSessionRequest,
  GetSessionRequest,
  ListSessionsRequest,
  ListSessionsResponse,
} from './base_session_service.js';
import {createSession, Session} from './session.js';
import {extractStateDelta, mergeState} from './session_util.js';
import {State} from './state.js';

/**
 * Type aliases for better-sqlite3 (lazy loaded peer dependency).
 */
type BetterSqlite3Database = BetterSqlite3.Database;
type BetterSqlite3Statement = BetterSqlite3.Statement;

/**
 * Schema version for the database.
 */
const SCHEMA_VERSION = '1';
const SCHEMA_VERSION_KEY = 'adk_schema_version';

/**
 * SQL statements for table creation.
 */
const CREATE_TABLES_SQL = `
-- Metadata table for internal ADK information
CREATE TABLE IF NOT EXISTS adk_internal_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  app_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT '{}',
  create_time REAL NOT NULL,
  update_time REAL NOT NULL,
  PRIMARY KEY (app_name, user_id, id)
);

-- Events table
CREATE TABLE IF NOT EXISTS events (
  id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  invocation_id TEXT NOT NULL,
  timestamp REAL NOT NULL,
  event_data TEXT NOT NULL,
  PRIMARY KEY (id, app_name, user_id, session_id),
  FOREIGN KEY (app_name, user_id, session_id) REFERENCES sessions(app_name, user_id, id) ON DELETE CASCADE
);

-- App-level state table
CREATE TABLE IF NOT EXISTS app_states (
  app_name TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT '{}',
  update_time REAL NOT NULL
);

-- User-level state table
CREATE TABLE IF NOT EXISTS user_states (
  app_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT '{}',
  update_time REAL NOT NULL,
  PRIMARY KEY (app_name, user_id)
);

-- Create index for event queries
CREATE INDEX IF NOT EXISTS idx_events_session ON events(app_name, user_id, session_id, timestamp DESC);
`;

/**
 * Options for configuring the DatabaseSessionService.
 */
export interface DatabaseSessionServiceOptions {
  /**
   * The database URL. Supports SQLite URLs in the format:
   * - `sqlite:///path/to/database.db` - File-based SQLite database
   * - `sqlite://:memory:` - In-memory SQLite database
   */
  dbUrl: string;
}

/**
 * A session service that persists sessions to a SQLite database.
 *
 * This implementation uses better-sqlite3 for SQLite database operations.
 * The database schema includes tables for sessions, events, app-level state,
 * and user-level state.
 *
 * State is partitioned by prefix:
 * - `app:*` keys are stored in app_states (shared across all users)
 * - `user:*` keys are stored in user_states (shared within a user's sessions)
 * - `temp:*` keys are not persisted (temporary state)
 * - Other keys are stored in session.state (session-specific)
 *
 * @example
 * ```typescript
 * const service = new DatabaseSessionService({
 *   dbUrl: 'sqlite:///path/to/database.db'
 * });
 *
 * await service.initialize();
 *
 * const session = await service.createSession({
 *   appName: 'my-app',
 *   userId: 'user-123',
 *   state: { counter: 0 }
 * });
 * ```
 */
export class DatabaseSessionService extends BaseSessionService {
  private db: BetterSqlite3Database|null = null;
  private dbUrl: string;
  private tablesCreated = false;

  /**
   * Creates a new DatabaseSessionService.
   *
   * @param options Configuration options for the service.
   */
  constructor(options: DatabaseSessionServiceOptions) {
    super();
    this.dbUrl = options.dbUrl;
  }

  /**
   * Parses a database URL and returns the file path.
   * Supports formats:
   * - sqlite:///path/to/db.db
   * - sqlite://:memory:
   *
   * @param dbUrl The database URL to parse.
   * @returns The file path for the database.
   */
  private parseDbUrl(dbUrl: string): string {
    if (!dbUrl.startsWith('sqlite://')) {
      throw new Error(
          `Invalid database URL format: '${dbUrl}'. Expected sqlite:// prefix.`);
    }

    const path = dbUrl.substring('sqlite://'.length);

    // Handle :memory: specially
    if (path === ':memory:' || path === '/:memory:') {
      return ':memory:';
    }

    // Handle file paths (remove leading slash on Windows if present)
    if (path.startsWith('/')) {
      return path;
    }

    return path;
  }

  /**
   * Initializes the database connection and creates tables if needed.
   * This method must be called before using the service.
   */
  async initialize(): Promise<void> {
    if (this.db) {
      return;
    }

    const dbPath = this.parseDbUrl(this.dbUrl);

    // Dynamically import better-sqlite3
    let Database: new(filename: string) => BetterSqlite3Database;
    try {
      const betterSqlite3 = await import('better-sqlite3');
      Database = betterSqlite3.default as unknown as new(filename: string) =>
          BetterSqlite3Database;
    } catch (error) {
      throw new Error(
          'Failed to load better-sqlite3. Please install it: npm install better-sqlite3\n' +
          `Original error: ${error}`);
    }

    try {
      this.db = new Database(dbPath);
    } catch (error) {
      throw new Error(
          `Failed to open database at '${dbPath}': ${error}`);
    }

    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Create tables if needed
    await this.prepareTables();
  }

  /**
   * Ensures database tables are ready for use.
   */
  private async prepareTables(): Promise<void> {
    if (this.tablesCreated || !this.db) {
      return;
    }

    // Create all tables
    this.db.exec(CREATE_TABLES_SQL);

    // Check/set schema version
    const stmt = this.db.prepare(
        'SELECT value FROM adk_internal_metadata WHERE key = ?');
    const result = stmt.get(SCHEMA_VERSION_KEY) as {value: string}|undefined;

    if (!result) {
      const insertStmt = this.db.prepare(
          'INSERT INTO adk_internal_metadata (key, value) VALUES (?, ?)');
      insertStmt.run(SCHEMA_VERSION_KEY, SCHEMA_VERSION);
    } else if (result.value !== SCHEMA_VERSION) {
      logger.warn(
          `Database schema version mismatch. Expected ${SCHEMA_VERSION}, found ${result.value}. ` +
          'Migration may be required.');
    }

    this.tablesCreated = true;
  }

  /**
   * Ensures the database is initialized before operations.
   */
  private ensureInitialized(): void {
    if (!this.db) {
      throw new Error(
          'DatabaseSessionService not initialized. Call initialize() first.');
    }
  }

  /**
   * Creates a new session in the database.
   */
  override async createSession({
    appName,
    userId,
    state,
    sessionId,
  }: CreateSessionRequest): Promise<Session> {
    this.ensureInitialized();
    const db = this.db!;

    const id = sessionId || randomUUID();
    const now = Date.now();

    // Check if session already exists
    const existingStmt = db.prepare(
        'SELECT id FROM sessions WHERE app_name = ? AND user_id = ? AND id = ?');
    const existing = existingStmt.get(appName, userId, id);
    if (existing) {
      throw new AlreadyExistsError(`Session with id ${id} already exists.`);
    }

    // Extract state deltas
    const deltas = extractStateDelta(state);

    // Perform all operations in a transaction
    const runTransaction = db.transaction(() => {
      // Get or create app state
      let appStateRow = db.prepare(
          'SELECT state FROM app_states WHERE app_name = ?')
                            .get(appName) as {state: string}|undefined;
      let currentAppState: Record<string, unknown> = {};

      if (!appStateRow) {
        db.prepare(
            'INSERT INTO app_states (app_name, state, update_time) VALUES (?, ?, ?)')
            .run(appName, '{}', now);
      } else {
        currentAppState = JSON.parse(appStateRow.state);
      }

      // Get or create user state
      let userStateRow =
          db.prepare(
                'SELECT state FROM user_states WHERE app_name = ? AND user_id = ?')
              .get(appName, userId) as {state: string}|undefined;
      let currentUserState: Record<string, unknown> = {};

      if (!userStateRow) {
        db.prepare(
            'INSERT INTO user_states (app_name, user_id, state, update_time) VALUES (?, ?, ?, ?)')
            .run(appName, userId, '{}', now);
      } else {
        currentUserState = JSON.parse(userStateRow.state);
      }

      // Apply state deltas
      if (Object.keys(deltas.app).length > 0) {
        const newAppState = {...currentAppState, ...deltas.app};
        db.prepare('UPDATE app_states SET state = ?, update_time = ? WHERE app_name = ?')
            .run(JSON.stringify(newAppState), now, appName);
        currentAppState = newAppState;
      }

      if (Object.keys(deltas.user).length > 0) {
        const newUserState = {...currentUserState, ...deltas.user};
        db.prepare(
            'UPDATE user_states SET state = ?, update_time = ? WHERE app_name = ? AND user_id = ?')
            .run(JSON.stringify(newUserState), now, appName, userId);
        currentUserState = newUserState;
      }

      // Create the session
      db.prepare(
          'INSERT INTO sessions (app_name, user_id, id, state, create_time, update_time) VALUES (?, ?, ?, ?, ?, ?)')
          .run(appName, userId, id, JSON.stringify(deltas.session), now, now);

      // Merge states for response
      return mergeState(currentAppState, currentUserState, deltas.session);
    });

    const mergedState = runTransaction();

    return createSession({
      id,
      appName,
      userId,
      state: mergedState,
      events: [],
      lastUpdateTime: now,
    });
  }

  /**
   * Gets a session from the database.
   */
  override async getSession({
    appName,
    userId,
    sessionId,
    config,
  }: GetSessionRequest): Promise<Session|undefined> {
    this.ensureInitialized();
    const db = this.db!;

    // Get session
    const sessionStmt = db.prepare(
        'SELECT id, state, update_time FROM sessions WHERE app_name = ? AND user_id = ? AND id = ?');
    const sessionRow = sessionStmt.get(appName, userId, sessionId) as
        {id: string; state: string; update_time: number;}|undefined;

    if (!sessionRow) {
      return undefined;
    }

    // Get events
    let eventsStmt: BetterSqlite3Statement;
    let eventsParams: unknown[];

    if (config?.afterTimestamp) {
      if (config.numRecentEvents) {
        eventsStmt = db.prepare(
            'SELECT event_data FROM events ' +
            'WHERE app_name = ? AND user_id = ? AND session_id = ? AND timestamp >= ? ' +
            'ORDER BY timestamp DESC LIMIT ?');
        eventsParams =
            [appName, userId, sessionId, config.afterTimestamp, config.numRecentEvents];
      } else {
        eventsStmt = db.prepare(
            'SELECT event_data FROM events ' +
            'WHERE app_name = ? AND user_id = ? AND session_id = ? AND timestamp >= ? ' +
            'ORDER BY timestamp DESC');
        eventsParams = [appName, userId, sessionId, config.afterTimestamp];
      }
    } else if (config?.numRecentEvents) {
      eventsStmt = db.prepare(
          'SELECT event_data FROM events ' +
          'WHERE app_name = ? AND user_id = ? AND session_id = ? ' +
          'ORDER BY timestamp DESC LIMIT ?');
      eventsParams = [appName, userId, sessionId, config.numRecentEvents];
    } else {
      eventsStmt = db.prepare(
          'SELECT event_data FROM events ' +
          'WHERE app_name = ? AND user_id = ? AND session_id = ? ' +
          'ORDER BY timestamp DESC');
      eventsParams = [appName, userId, sessionId];
    }

    const eventRows = eventsStmt.all(...eventsParams) as {event_data: string}[];
    // Reverse to get chronological order (oldest first)
    const events = eventRows.reverse().map((row: {event_data: string}) => {
      const eventData = JSON.parse(row.event_data) as Event;
      return eventData;
    });

    // Get app state
    const appStateRow =
        db.prepare('SELECT state FROM app_states WHERE app_name = ?')
            .get(appName) as {state: string}|undefined;
    const appState = appStateRow ? JSON.parse(appStateRow.state) : {};

    // Get user state
    const userStateRow =
        db.prepare('SELECT state FROM user_states WHERE app_name = ? AND user_id = ?')
            .get(appName, userId) as {state: string}|undefined;
    const userState = userStateRow ? JSON.parse(userStateRow.state) : {};

    // Merge states
    const sessionState = JSON.parse(sessionRow.state);
    const mergedState = mergeState(appState, userState, sessionState);

    return createSession({
      id: sessionId,
      appName,
      userId,
      state: mergedState,
      events,
      lastUpdateTime: sessionRow.update_time,
    });
  }

  /**
   * Lists sessions for an app/user.
   */
  override async listSessions({
    appName,
    userId,
  }: ListSessionsRequest): Promise<ListSessionsResponse> {
    this.ensureInitialized();
    const db = this.db!;

    // Get sessions
    const sessionsStmt = db.prepare(
        'SELECT id, state, update_time FROM sessions WHERE app_name = ? AND user_id = ?');
    const sessionRows = sessionsStmt.all(appName, userId) as
        {id: string; state: string; update_time: number;}[];

    // Get app state
    const appStateRow =
        db.prepare('SELECT state FROM app_states WHERE app_name = ?')
            .get(appName) as {state: string}|undefined;
    const appState = appStateRow ? JSON.parse(appStateRow.state) : {};

    // Get user state
    const userStateRow =
        db.prepare('SELECT state FROM user_states WHERE app_name = ? AND user_id = ?')
            .get(appName, userId) as {state: string}|undefined;
    const userState = userStateRow ? JSON.parse(userStateRow.state) : {};

    // Build sessions (without events for listing)
    const sessions: Session[] = sessionRows.map((row) => {
      const sessionState = JSON.parse(row.state);
      const mergedState = mergeState(appState, userState, sessionState);

      return createSession({
        id: row.id,
        appName,
        userId,
        state: mergedState,
        events: [],
        lastUpdateTime: row.update_time,
      });
    });

    return {sessions};
  }

  /**
   * Deletes a session from the database.
   * Events are automatically deleted via CASCADE.
   */
  override async deleteSession({
    appName,
    userId,
    sessionId,
  }: DeleteSessionRequest): Promise<void> {
    this.ensureInitialized();
    const db = this.db!;

    const stmt = db.prepare(
        'DELETE FROM sessions WHERE app_name = ? AND user_id = ? AND id = ?');
    stmt.run(appName, userId, sessionId);
  }

  /**
   * Appends an event to a session in the database.
   */
  override async appendEvent({session, event}: AppendEventRequest):
      Promise<Event> {
    // Skip partial events
    if (event.partial) {
      return event;
    }

    this.ensureInitialized();
    const db = this.db!;

    // Trim temp state before persisting
    const trimmedEvent = this.trimTempDeltaState(event);

    const runTransaction = db.transaction(() => {
      // Get current session
      const sessionRow =
          db.prepare(
                'SELECT update_time FROM sessions WHERE app_name = ? AND user_id = ? AND id = ?')
              .get(session.appName, session.userId, session.id) as
          {update_time: number}|undefined;

      if (!sessionRow) {
        throw new Error(
            `Session ${session.id} not found for appName=${session.appName}, userId=${session.userId}`);
      }

      // Check for stale session
      if (sessionRow.update_time > session.lastUpdateTime) {
        throw new Error(
            `The last_update_time provided in the session object (${session.lastUpdateTime}) is ` +
            `earlier than the update_time in storage (${sessionRow.update_time}). ` +
            'Please check if this is a stale session.');
      }

      // Extract state delta
      if (trimmedEvent.actions?.stateDelta) {
        const deltas = extractStateDelta(trimmedEvent.actions.stateDelta);

        // Update app state
        if (Object.keys(deltas.app).length > 0) {
          const appStateRow =
              db.prepare('SELECT state FROM app_states WHERE app_name = ?')
                  .get(session.appName) as {state: string}|undefined;
          const currentAppState =
              appStateRow ? JSON.parse(appStateRow.state) : {};
          const newAppState = {...currentAppState, ...deltas.app};
          db.prepare(
              'UPDATE app_states SET state = ?, update_time = ? WHERE app_name = ?')
              .run(
                  JSON.stringify(newAppState), trimmedEvent.timestamp,
                  session.appName);
        }

        // Update user state
        if (Object.keys(deltas.user).length > 0) {
          const userStateRow =
              db.prepare(
                    'SELECT state FROM user_states WHERE app_name = ? AND user_id = ?')
                  .get(session.appName, session.userId) as {state: string}|
              undefined;
          const currentUserState =
              userStateRow ? JSON.parse(userStateRow.state) : {};
          const newUserState = {...currentUserState, ...deltas.user};
          db.prepare(
              'UPDATE user_states SET state = ?, update_time = ? WHERE app_name = ? AND user_id = ?')
              .run(
                  JSON.stringify(newUserState), trimmedEvent.timestamp,
                  session.appName, session.userId);
        }

        // Update session state
        if (Object.keys(deltas.session).length > 0) {
          const currentSessionRow =
              db.prepare(
                    'SELECT state FROM sessions WHERE app_name = ? AND user_id = ? AND id = ?')
                  .get(session.appName, session.userId, session.id) as
              {state: string};
          const currentSessionState = JSON.parse(currentSessionRow.state);
          const newSessionState = {...currentSessionState, ...deltas.session};
          db.prepare(
              'UPDATE sessions SET state = ?, update_time = ? WHERE app_name = ? AND user_id = ? AND id = ?')
              .run(
                  JSON.stringify(newSessionState), trimmedEvent.timestamp,
                  session.appName, session.userId, session.id);
        } else {
          // Just update timestamp
          db.prepare(
              'UPDATE sessions SET update_time = ? WHERE app_name = ? AND user_id = ? AND id = ?')
              .run(
                  trimmedEvent.timestamp, session.appName, session.userId,
                  session.id);
        }
      } else {
        // Just update timestamp
        db.prepare(
            'UPDATE sessions SET update_time = ? WHERE app_name = ? AND user_id = ? AND id = ?')
            .run(
                trimmedEvent.timestamp, session.appName, session.userId,
                session.id);
      }

      // Store the event
      const eventData = JSON.stringify(trimmedEvent);
      db.prepare(
          'INSERT INTO events (id, app_name, user_id, session_id, invocation_id, timestamp, event_data) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(
              trimmedEvent.id, session.appName, session.userId, session.id,
              trimmedEvent.invocationId, trimmedEvent.timestamp, eventData);

      return trimmedEvent.timestamp;
    });

    const newUpdateTime = runTransaction();

    // Update in-memory session
    session.lastUpdateTime = newUpdateTime;
    await super.appendEvent({session, event: trimmedEvent});

    return trimmedEvent;
  }

  /**
   * Removes temp: prefixed keys from the event's state delta before persisting.
   */
  private trimTempDeltaState(event: Event): Event {
    if (!event.actions?.stateDelta) {
      return event;
    }

    const trimmedDelta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event.actions.stateDelta)) {
      if (!key.startsWith(State.TEMP_PREFIX)) {
        trimmedDelta[key] = value;
      }
    }

    return {
      ...event,
      actions: {
        ...event.actions,
        stateDelta: trimmedDelta,
      },
    };
  }

  /**
   * Closes the database connection.
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.tablesCreated = false;
    }
  }
}
