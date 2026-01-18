/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {BaseAgent} from '../agents/base_agent.js';
import {ContextCacheConfig} from '../models/cache_metadata.js';
import {BasePlugin} from '../plugins/base_plugin.js';

import {BaseEventsSummarizer} from './base_events_summarizer.js';

/**
 * Configuration for automatic event compaction.
 *
 * Event compaction uses a sliding window approach to summarize older
 * agent workflow events, reducing memory usage while preserving context.
 *
 * @example
 * ```typescript
 * const config: EventsCompactionConfig = {
 *   compactionInterval: 10,  // Compact after every 10 new invocations
 *   overlapSize: 2,          // Include 2 previous invocations for context
 * };
 * ```
 */
export interface EventsCompactionConfig {
  /**
   * The event summarizer to use for compaction.
   *
   * If not provided, a default LlmEventSummarizer will be created
   * using the root agent's model when compaction is triggered.
   */
  summarizer?: BaseEventsSummarizer;

  /**
   * Number of new user-initiated invocations that trigger compaction.
   *
   * When this many new invocations have occurred since the last
   * compaction, a new compaction will be performed.
   *
   * @default 10
   */
  compactionInterval: number;

  /**
   * Number of preceding invocations to include from the end of
   * the last compacted range.
   *
   * This creates overlap between consecutive compacted summaries,
   * helping preserve context across compaction boundaries.
   *
   * @default 2
   */
  overlapSize: number;
}

/**
 * Configuration for session resumability.
 *
 * When enabled, allows pausing invocations on long-running function calls
 * and resuming from the last event if paused or failed midway.
 *
 * Uses best-effort semantics with at-least-once behavior.
 */
export interface ResumabilityConfig {
  /**
   * Whether the app supports agent resumption.
   */
  isResumable: boolean;
}

/**
 * Configuration for creating an App instance.
 */
export interface AppConfig {
  /**
   * The name of the application.
   *
   * Must be a valid JavaScript identifier (letters, digits, underscores only).
   * Cannot be "user" as it's reserved for end-user input.
   */
  name: string;

  /**
   * The root agent in the application hierarchy.
   *
   * This is the entry point for all agent interactions.
   */
  rootAgent: BaseAgent;

  /**
   * Optional application-wide plugins.
   *
   * These plugins will be applied to all agent invocations.
   */
  plugins?: BasePlugin[];

  /**
   * Configuration for automatic event compaction.
   *
   * When set, older events will be automatically summarized
   * using a sliding window approach.
   */
  eventsCompactionConfig?: EventsCompactionConfig;

  /**
   * Context cache configuration for all LLM agents.
   *
   * Allows storing frequently used content to reduce costs
   * and improve performance for long conversations.
   */
  contextCacheConfig?: ContextCacheConfig;

  /**
   * Configuration for session resumability.
   *
   * Enables pausing and resuming long-running agent workflows.
   */
  resumabilityConfig?: ResumabilityConfig;
}

/**
 * Top-level container for an LLM-backed agentic application.
 *
 * An App manages a root agent and application-wide configuration,
 * including event compaction, context caching, and plugins.
 *
 * @example
 * ```typescript
 * const app = new App({
 *   name: 'my_assistant',
 *   rootAgent: new LlmAgent({
 *     name: 'assistant',
 *     model: new Gemini({ model: 'gemini-2.0-flash' }),
 *   }),
 *   eventsCompactionConfig: {
 *     compactionInterval: 10,
 *     overlapSize: 2,
 *   },
 * });
 * ```
 */
export class App {
  /**
   * The name of the application.
   */
  readonly name: string;

  /**
   * The root agent in the application hierarchy.
   */
  readonly rootAgent: BaseAgent;

  /**
   * Application-wide plugins.
   */
  readonly plugins: BasePlugin[];

  /**
   * Configuration for automatic event compaction.
   */
  eventsCompactionConfig?: EventsCompactionConfig;

  /**
   * Context cache configuration for all LLM agents.
   */
  readonly contextCacheConfig?: ContextCacheConfig;

  /**
   * Configuration for session resumability.
   */
  readonly resumabilityConfig?: ResumabilityConfig;

  constructor(config: AppConfig) {
    this.name = validateAppName(config.name);
    this.rootAgent = config.rootAgent;
    this.plugins = config.plugins ?? [];
    this.eventsCompactionConfig = config.eventsCompactionConfig;
    this.contextCacheConfig = config.contextCacheConfig;
    this.resumabilityConfig = config.resumabilityConfig;
  }
}

/**
 * Validates an application name.
 *
 * App names must be valid JavaScript identifiers (starting with a letter
 * or underscore, containing only letters, digits, and underscores).
 * The name "user" is reserved and cannot be used.
 *
 * @param name The name to validate.
 * @returns The validated name.
 * @throws Error if the name is invalid.
 */
export function validateAppName(name: string): string {
  // Check if it's a valid identifier
  // Pattern matches: starts with letter/underscore, followed by alphanumeric/underscore
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
        `Invalid app name: "${name}". App name must be a valid identifier ` +
        '(start with a letter or underscore, contain only letters, digits, and underscores).');
  }

  // Check reserved name
  if (name === 'user') {
    throw new Error(
        'App name cannot be "user". "user" is reserved for end-user input.');
  }

  return name;
}

/**
 * Creates default EventsCompactionConfig with sensible defaults.
 *
 * @param params Optional partial config to override defaults.
 * @returns A complete EventsCompactionConfig.
 */
export function createEventsCompactionConfig(
    params: Partial<EventsCompactionConfig> = {}): EventsCompactionConfig {
  return {
    compactionInterval: params.compactionInterval ?? 10,
    overlapSize: params.overlapSize ?? 2,
    summarizer: params.summarizer,
  };
}
