/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseSessionService,
  Session,
  Event,
  LogLevel,
  setLogLevel,
} from '@google/adk';

// Simple console cliLogger for CLI
const cliLogger = {
  info: (...args: unknown[]) => console.log('[INFO]', ...args),
  warn: (...args: unknown[]) => console.warn('[WARN]', ...args),
  error: (...args: unknown[]) => console.error('[ERROR]', ...args),
  debug: (...args: unknown[]) => console.log('[DEBUG]', ...args),
};

/**
 * Options for the session migration command.
 */
export interface MigrateSessionOptions {
  /**
   * URI of the source session service.
   * Supported formats:
   * - sqlite:///path/to/database.db
   * - agentengine://<resource-name>
   * - memory://
   */
  sourceUri: string;

  /**
   * URI of the destination session service.
   * Supported formats:
   * - sqlite:///path/to/database.db
   * - agentengine://<resource-name>
   * - memory://
   */
  destUri: string;

  /**
   * Optional app name filter. If provided, only sessions for this app are migrated.
   */
  appName?: string;

  /**
   * Optional user ID filter. If provided, only sessions for this user are migrated.
   */
  userId?: string;

  /**
   * Whether to skip sessions that already exist in the destination.
   * Default: true (skip existing sessions)
   */
  skipExisting?: boolean;

  /**
   * Maximum number of sessions to migrate. Useful for testing.
   * Default: no limit
   */
  limit?: number;

  /**
   * Whether to run in dry-run mode (no actual writes).
   */
  dryRun?: boolean;
}

/**
 * Result of the session migration.
 */
export interface MigrationResult {
  /**
   * Total number of sessions found in source.
   */
  totalSessions: number;

  /**
   * Number of sessions successfully migrated.
   */
  migratedSessions: number;

  /**
   * Number of sessions skipped (already exist in destination).
   */
  skippedSessions: number;

  /**
   * Number of sessions that failed to migrate.
   */
  failedSessions: number;

  /**
   * Total number of events migrated across all sessions.
   */
  totalEvents: number;

  /**
   * List of errors encountered during migration.
   */
  errors: Array<{sessionId: string; error: string}>;
}

/**
 * Progress callback for migration operations.
 */
export type MigrationProgressCallback = (progress: {
  current: number;
  total: number;
  sessionId: string;
  status: 'migrating' | 'skipped' | 'failed' | 'success';
  message?: string;
}) => void;

/**
 * Creates a session service from a URI string.
 * This is a simplified version that creates raw service instances
 * for migration purposes.
 */
async function createServiceFromUri(uri: string): Promise<BaseSessionService> {
  if (uri === 'memory://') {
    const {InMemorySessionService} = await import('@google/adk');
    return new InMemorySessionService();
  }

  if (uri.startsWith('sqlite://')) {
    const {DatabaseSessionService} = await import('@google/adk');
    const service = new DatabaseSessionService({dbUrl: uri});
    await service.initialize();
    return service;
  }

  if (uri.startsWith('agentengine://')) {
    const {VertexAiSessionService} = await import('@google/adk');
    const resourceName = uri.substring('agentengine://'.length);
    // Parse resource name: projects/{project}/locations/{location}/reasoningEngines/{id}
    const parts = resourceName.split('/');
    if (parts.length >= 6 && parts[0] === 'projects' && parts[2] === 'locations') {
      const project = parts[1];
      const location = parts[3];
      const agentEngineId = parts[5];
      const service = new VertexAiSessionService({project, location, agentEngineId});
      return service;
    } else {
      // Assume it's just an agent engine ID
      const service = new VertexAiSessionService({agentEngineId: resourceName});
      return service;
    }
  }

  throw new Error(
    `Unsupported session service URI: ${uri}. ` +
    'Supported formats: sqlite:///<path>, agentengine://<resource>, memory://'
  );
}

/**
 * Validates that source and destination URIs are different and valid.
 */
function validateUris(sourceUri: string, destUri: string): void {
  if (sourceUri === destUri) {
    throw new Error(
      'Source and destination URIs must be different. ' +
      'In-place migration is not supported for safety reasons.'
    );
  }

  // Basic URI validation
  const validPrefixes = ['sqlite://', 'agentengine://', 'memory://'];
  const isSourceValid = validPrefixes.some(p => sourceUri.startsWith(p));
  const isDestValid = validPrefixes.some(p => destUri.startsWith(p));

  if (!isSourceValid) {
    throw new Error(`Invalid source URI: ${sourceUri}`);
  }

  if (!isDestValid) {
    throw new Error(`Invalid destination URI: ${destUri}`);
  }
}

/**
 * Migrates sessions from one session service to another.
 *
 * This function reads sessions from the source service and writes them
 * to the destination service, including all events and state.
 *
 * @param options Migration options
 * @param progressCallback Optional callback for progress updates
 * @returns Migration result with statistics
 *
 * @example
 * ```typescript
 * const result = await migrateSession({
 *   sourceUri: 'sqlite:///old-database.db',
 *   destUri: 'sqlite:///new-database.db',
 * });
 * console.log(`Migrated ${result.migratedSessions} sessions`);
 * ```
 */
export async function migrateSession(
  options: MigrateSessionOptions,
  progressCallback?: MigrationProgressCallback
): Promise<MigrationResult> {
  const {
    sourceUri,
    destUri,
    appName,
    userId,
    skipExisting = true,
    limit,
    dryRun = false,
  } = options;

  // Validate URIs
  validateUris(sourceUri, destUri);

  cliLogger.info(`Starting session migration`);
  cliLogger.info(`  Source: ${sourceUri}`);
  cliLogger.info(`  Destination: ${destUri}`);
  if (appName) cliLogger.info(`  App filter: ${appName}`);
  if (userId) cliLogger.info(`  User filter: ${userId}`);
  if (dryRun) cliLogger.info(`  Mode: DRY RUN (no writes)`);

  // Initialize services
  let sourceService: BaseSessionService;
  let destService: BaseSessionService;

  try {
    sourceService = await createServiceFromUri(sourceUri);
    cliLogger.info('Source service initialized');
  } catch (error) {
    throw new Error(`Failed to initialize source service: ${error}`);
  }

  try {
    destService = await createServiceFromUri(destUri);
    cliLogger.info('Destination service initialized');
  } catch (error) {
    // Clean up source service if dest fails
    if ('close' in sourceService && typeof sourceService.close === 'function') {
      await (sourceService as {close: () => Promise<void>}).close();
    }
    throw new Error(`Failed to initialize destination service: ${error}`);
  }

  const result: MigrationResult = {
    totalSessions: 0,
    migratedSessions: 0,
    skippedSessions: 0,
    failedSessions: 0,
    totalEvents: 0,
    errors: [],
  };

  try {
    // Get sessions to migrate
    // Note: We need appName and userId to list sessions
    if (!appName || !userId) {
      throw new Error(
        'Both --app_name and --user_id are required for migration. ' +
        'The session service API requires these to list sessions.'
      );
    }

    const {sessions: sourceSessions} = await sourceService.listSessions({
      appName,
      userId,
    });

    result.totalSessions = sourceSessions.length;
    cliLogger.info(`Found ${result.totalSessions} sessions to migrate`);

    // Apply limit if specified
    const sessionsToMigrate = limit
      ? sourceSessions.slice(0, limit)
      : sourceSessions;

    // Migrate each session
    for (let i = 0; i < sessionsToMigrate.length; i++) {
      const sessionSummary = sessionsToMigrate[i];
      const sessionId = sessionSummary.id;

      progressCallback?.({
        current: i + 1,
        total: sessionsToMigrate.length,
        sessionId,
        status: 'migrating',
        message: `Migrating session ${sessionId}`,
      });

      try {
        // Check if session already exists in destination
        if (skipExisting) {
          const existingSession = await destService.getSession({
            appName,
            userId,
            sessionId,
          });

          if (existingSession) {
            cliLogger.debug(`Session ${sessionId} already exists, skipping`);
            result.skippedSessions++;
            progressCallback?.({
              current: i + 1,
              total: sessionsToMigrate.length,
              sessionId,
              status: 'skipped',
              message: 'Session already exists in destination',
            });
            continue;
          }
        }

        // Get full session with events from source
        const fullSession = await sourceService.getSession({
          appName,
          userId,
          sessionId,
        });

        if (!fullSession) {
          throw new Error('Session disappeared during migration');
        }

        if (dryRun) {
          cliLogger.info(
            `[DRY RUN] Would migrate session ${sessionId} with ${fullSession.events.length} events`
          );
          result.migratedSessions++;
          result.totalEvents += fullSession.events.length;
          progressCallback?.({
            current: i + 1,
            total: sessionsToMigrate.length,
            sessionId,
            status: 'success',
            message: `[DRY RUN] Would migrate ${fullSession.events.length} events`,
          });
          continue;
        }

        // Create session in destination
        // Note: Session.state is already Record<string, unknown>, not a State object
        const newSession = await destService.createSession({
          appName,
          userId,
          sessionId,
          state: fullSession.state as Record<string, unknown>,
        });

        // Migrate events
        let eventCount = 0;
        for (const event of fullSession.events) {
          await destService.appendEvent({
            session: newSession,
            event,
          });
          eventCount++;
        }

        result.migratedSessions++;
        result.totalEvents += eventCount;

        cliLogger.info(
          `Migrated session ${sessionId} with ${eventCount} events`
        );
        progressCallback?.({
          current: i + 1,
          total: sessionsToMigrate.length,
          sessionId,
          status: 'success',
          message: `Migrated ${eventCount} events`,
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        cliLogger.error(`Failed to migrate session ${sessionId}: ${errorMessage}`);
        result.failedSessions++;
        result.errors.push({sessionId, error: errorMessage});

        progressCallback?.({
          current: i + 1,
          total: sessionsToMigrate.length,
          sessionId,
          status: 'failed',
          message: errorMessage,
        });
      }
    }

  } finally {
    // Clean up services
    try {
      if ('close' in sourceService && typeof sourceService.close === 'function') {
        await (sourceService as {close: () => Promise<void>}).close();
      }
    } catch (e) {
      cliLogger.warn('Failed to close source service:', e);
    }

    try {
      if ('close' in destService && typeof destService.close === 'function') {
        await (destService as {close: () => Promise<void>}).close();
      }
    } catch (e) {
      cliLogger.warn('Failed to close destination service:', e);
    }
  }

  // Log summary
  cliLogger.info('');
  cliLogger.info('=== Migration Summary ===');
  cliLogger.info(`Total sessions:     ${result.totalSessions}`);
  cliLogger.info(`Migrated:           ${result.migratedSessions}`);
  cliLogger.info(`Skipped (existing): ${result.skippedSessions}`);
  cliLogger.info(`Failed:             ${result.failedSessions}`);
  cliLogger.info(`Total events:       ${result.totalEvents}`);

  if (result.errors.length > 0) {
    cliLogger.error('');
    cliLogger.error('=== Errors ===');
    for (const {sessionId, error} of result.errors) {
      cliLogger.error(`  ${sessionId}: ${error}`);
    }
  }

  return result;
}

/**
 * CLI handler for the 'adk migrate session' command.
 */
export async function runMigrateSession(options: {
  source_uri: string;
  dest_uri: string;
  app_name?: string;
  user_id?: string;
  skip_existing?: boolean;
  limit?: string;
  dry_run?: boolean;
}): Promise<number> {
  try {
    const result = await migrateSession({
      sourceUri: options.source_uri,
      destUri: options.dest_uri,
      appName: options.app_name,
      userId: options.user_id,
      skipExisting: options.skip_existing !== false,
      limit: options.limit ? parseInt(options.limit, 10) : undefined,
      dryRun: !!options.dry_run,
    }, (progress) => {
      // Print progress to console
      const statusIcon = {
        migrating: '⏳',
        skipped: '⏭️',
        failed: '❌',
        success: '✅',
      }[progress.status];

      console.log(
        `[${progress.current}/${progress.total}] ${statusIcon} ${progress.sessionId}: ${progress.message || progress.status}`
      );
    });

    // Return exit code based on result
    if (result.failedSessions > 0) {
      return 1; // Some failures
    }
    return 0; // Success
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : error);
    return 2; // Fatal error
  }
}
