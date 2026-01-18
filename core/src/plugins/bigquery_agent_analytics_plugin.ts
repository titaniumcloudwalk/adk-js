/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, Part} from '@google/genai';
import {AsyncLocalStorage} from 'async_hooks';
import {randomUUID} from 'crypto';

import {BaseAgent} from '../agents/base_agent.js';
import {CallbackContext} from '../agents/callback_context.js';
import {InvocationContext} from '../agents/invocation_context.js';
import type {LlmRequest} from '../models/llm_request.js';
import type {LlmResponse} from '../models/llm_response.js';
import {BaseTool} from '../tools/base_tool.js';
import {ToolContext} from '../tools/tool_context.js';
import {logger} from '../utils/logger.js';

import {BasePlugin} from './base_plugin.js';

// Type declaration for @google-cloud/bigquery (optional peer dependency)
interface BigQueryClient {
  dataset(id: string): {
    table(id: string): {
      insert(rows: Record<string, unknown>[]): Promise<void>;
    };
  };
}

// gRPC Error Codes for retry logic
const GRPC_DEADLINE_EXCEEDED = 4;
const GRPC_INTERNAL = 13;
const GRPC_UNAVAILABLE = 14;

// ==============================================================================
// CONFIGURATION
// ==============================================================================

/**
 * Configuration for retrying failed BigQuery write operations.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts. Default: 3 */
  maxRetries?: number;
  /** Initial delay between retries in milliseconds. Default: 1000 */
  initialDelay?: number;
  /** Multiplier for exponential backoff. Default: 2.0 */
  multiplier?: number;
  /** Maximum delay between retries in milliseconds. Default: 10000 */
  maxDelay?: number;
}

/**
 * Configuration for the BigQueryAgentAnalyticsPlugin.
 */
export interface BigQueryLoggerConfig {
  /** Whether logging is enabled. Default: true */
  enabled?: boolean;
  /** List of event types to log. If undefined, all are allowed. */
  eventAllowlist?: string[];
  /** List of event types to ignore. */
  eventDenylist?: string[];
  /** Max length for text content before truncation. Default: 500KB */
  maxContentLength?: number;
  /** BigQuery table ID. Default: 'agent_events_v2' */
  tableId?: string;
  /** Fields to cluster the table by. Default: ['event_type', 'agent', 'user_id'] */
  clusteringFields?: string[];
  /** Whether to log detailed content parts. Default: true */
  logMultiModalContent?: boolean;
  /** Retry configuration for writes. */
  retryConfig?: RetryConfig;
  /** Number of rows per batch. Default: 1 */
  batchSize?: number;
  /** Max time to wait before flushing a batch in ms. Default: 1000 */
  batchFlushInterval?: number;
  /** Max time to wait for shutdown in ms. Default: 10000 */
  shutdownTimeout?: number;
  /** Max size of the in-memory queue. Default: 10000 */
  queueMaxSize?: number;
  /** Optional custom formatter for content. */
  contentFormatter?: (content: unknown, eventType: string) => unknown;
  /** If provided, large content will be offloaded to this GCS bucket. */
  gcsBucketName?: string;
  /**
   * If provided, this connection ID will be used as the authorizer for ObjectRef columns.
   * Format: "location.connection_id" (e.g. "us.my-connection")
   */
  connectionId?: string;
}

// ==============================================================================
// HELPER: TRACE MANAGER (Async-Safe with AsyncLocalStorage)
// ==============================================================================

interface TraceContext {
  traceId: string;
  rootAgentName?: string;
  spanStack: string[];
  spanTimes: Map<string, number>;
  spanFirstTokenTimes: Map<string, number>;
}

const traceContextStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Manages OpenTelemetry-style trace and span context using AsyncLocalStorage.
 */
export class TraceManager {
  /**
   * Initializes trace context for the current async context.
   */
  static initTrace(callbackContext: CallbackContext): void {
    const existing = traceContextStorage.getStore();
    if (existing) return;

    let rootAgentName: string | undefined;
    try {
      rootAgentName = callbackContext.invocationContext.agent.rootAgent.name;
    } catch {
      // Root agent may not be available in all contexts
    }

    const context: TraceContext = {
      traceId: callbackContext.invocationId,
      rootAgentName,
      spanStack: [],
      spanTimes: new Map(),
      spanFirstTokenTimes: new Map(),
    };

    traceContextStorage.enterWith(context);
  }

  /**
   * Gets the current trace ID.
   */
  static getTraceId(callbackContext: CallbackContext): string | undefined {
    const ctx = traceContextStorage.getStore();
    if (ctx?.traceId) return ctx.traceId;
    // Fallback to invocation ID
    return callbackContext.invocationId;
  }

  /**
   * Pushes a new span onto the stack.
   */
  static pushSpan(callbackContext: CallbackContext, spanId?: string): string {
    let ctx = traceContextStorage.getStore();
    if (!ctx) {
      TraceManager.initTrace(callbackContext);
      ctx = traceContextStorage.getStore()!;
    }

    const newSpanId = spanId ?? randomUUID();
    ctx.spanStack.push(newSpanId);
    ctx.spanTimes.set(newSpanId, Date.now());

    return newSpanId;
  }

  /**
   * Pops the current span from the stack.
   * @returns Tuple of [spanId, durationMs]
   */
  static popSpan(): [string | undefined, number | undefined] {
    const ctx = traceContextStorage.getStore();
    if (!ctx || ctx.spanStack.length === 0) {
      return [undefined, undefined];
    }

    const spanId = ctx.spanStack.pop()!;
    const startTime = ctx.spanTimes.get(spanId);
    ctx.spanTimes.delete(spanId);
    ctx.spanFirstTokenTimes.delete(spanId);

    const durationMs = startTime ? Date.now() - startTime : undefined;
    return [spanId, durationMs];
  }

  /**
   * Gets current span and parent span IDs.
   */
  static getCurrentSpanAndParent(): [string | undefined, string | undefined] {
    const ctx = traceContextStorage.getStore();
    if (!ctx || ctx.spanStack.length === 0) {
      return [undefined, undefined];
    }

    const currentSpan = ctx.spanStack[ctx.spanStack.length - 1];
    const parentSpan =
      ctx.spanStack.length > 1
        ? ctx.spanStack[ctx.spanStack.length - 2]
        : undefined;

    return [currentSpan, parentSpan];
  }

  /**
   * Gets the current span ID.
   */
  static getCurrentSpanId(): string | undefined {
    const ctx = traceContextStorage.getStore();
    return ctx?.spanStack[ctx.spanStack.length - 1];
  }

  /**
   * Gets the root agent name.
   */
  static getRootAgentName(): string | undefined {
    const ctx = traceContextStorage.getStore();
    return ctx?.rootAgentName;
  }

  /**
   * Gets the start time of a span.
   */
  static getStartTime(spanId: string): number | undefined {
    const ctx = traceContextStorage.getStore();
    return ctx?.spanTimes.get(spanId);
  }

  /**
   * Records the current time as first token time if not already recorded.
   * @returns true if this was the first token (newly recorded), false otherwise.
   */
  static recordFirstToken(spanId: string): boolean {
    const ctx = traceContextStorage.getStore();
    if (!ctx) return false;

    if (!ctx.spanFirstTokenTimes.has(spanId)) {
      ctx.spanFirstTokenTimes.set(spanId, Date.now());
      return true;
    }
    return false;
  }

  /**
   * Gets the first token time of a span.
   */
  static getFirstTokenTime(spanId: string): number | undefined {
    const ctx = traceContextStorage.getStore();
    return ctx?.spanFirstTokenTimes.get(spanId);
  }

  /**
   * Runs a callback within a trace context.
   */
  static runWithContext<T>(context: TraceContext, callback: () => T): T {
    return traceContextStorage.run(context, callback);
  }
}

// ==============================================================================
// HELPER: CONTENT PARSING & TRUNCATION
// ==============================================================================

/**
 * Recursively truncates string values within an object.
 * @returns Tuple of [truncatedObject, isTruncated]
 */
export function recursiveSmartTruncate(
  obj: unknown,
  maxLen: number
): [unknown, boolean] {
  if (typeof obj === 'string') {
    if (maxLen !== -1 && obj.length > maxLen) {
      return [obj.substring(0, maxLen) + '...[TRUNCATED]', true];
    }
    return [obj, false];
  }

  if (obj === null || obj === undefined) {
    return [obj, false];
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return [obj, false];
  }

  if (Array.isArray(obj)) {
    let truncatedAny = false;
    const newArray: unknown[] = [];
    for (const item of obj) {
      const [val, trunc] = recursiveSmartTruncate(item, maxLen);
      if (trunc) truncatedAny = true;
      newArray.push(val);
    }
    return [newArray, truncatedAny];
  }

  if (typeof obj === 'object') {
    // Handle Date
    if (obj instanceof Date) {
      return [obj.toISOString(), false];
    }

    // Handle Map
    if (obj instanceof Map) {
      const result: Record<string, unknown> = {};
      let truncatedAny = false;
      for (const [key, value] of obj.entries()) {
        const [val, trunc] = recursiveSmartTruncate(value, maxLen);
        if (trunc) truncatedAny = true;
        result[String(key)] = val;
      }
      return [result, truncatedAny];
    }

    // Handle Set
    if (obj instanceof Set) {
      const [arr, trunc] = recursiveSmartTruncate([...obj], maxLen);
      return [arr, trunc];
    }

    // Handle Buffer/Uint8Array
    if (obj instanceof Uint8Array || obj instanceof Buffer) {
      return [`<bytes: ${obj.length} bytes>`, false];
    }

    // Check for toJSON method
    const objWithJson = obj as {toJSON?: () => unknown};
    if (typeof objWithJson.toJSON === 'function') {
      return recursiveSmartTruncate(objWithJson.toJSON(), maxLen);
    }

    // Plain object
    const record = obj as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    let truncatedAny = false;

    for (const [key, value] of Object.entries(record)) {
      const [val, trunc] = recursiveSmartTruncate(value, maxLen);
      if (trunc) truncatedAny = true;
      result[key] = val;
    }
    return [result, truncatedAny];
  }

  // Fallback: convert to string
  try {
    return [String(obj), false];
  } catch {
    return ['<unserializable>', false];
  }
}

/**
 * Formats content for logging.
 */
function formatContent(
  content: Content | undefined,
  maxLen: number
): [string, boolean] {
  if (!content?.parts || content.parts.length === 0) {
    return ['None', false];
  }

  const parts: string[] = [];
  let truncated = false;

  for (const p of content.parts) {
    if (p.text) {
      if (maxLen !== -1 && p.text.length > maxLen) {
        parts.push(`text: '${p.text.substring(0, maxLen)}...'`);
        truncated = true;
      } else {
        parts.push(`text: '${p.text}'`);
      }
    } else if (p.functionCall) {
      parts.push(`call: ${p.functionCall.name}`);
    } else if (p.functionResponse) {
      parts.push(`resp: ${p.functionResponse.name}`);
    } else {
      parts.push('other');
    }
  }

  return [parts.join(' | '), truncated];
}

// ==============================================================================
// HELPER: CONTENT PART STRUCTURE
// ==============================================================================

interface ContentPartData {
  partIndex: number;
  mimeType: string;
  uri: string | null;
  text: string | null;
  partAttributes: string;
  storageMode: 'INLINE' | 'GCS_REFERENCE' | 'EXTERNAL_URI';
  objectRef: {
    uri: string;
    version: string | null;
    authorizer: string | null;
    details: string | null;
  } | null;
}

// ==============================================================================
// HELPER: BATCH PROCESSOR
// ==============================================================================

interface BigQueryRow {
  timestamp: Date;
  event_type: string;
  agent: string | undefined;
  user_id: string | undefined;
  session_id: string;
  invocation_id: string;
  trace_id: string | undefined;
  span_id: string | undefined;
  parent_span_id: string | undefined;
  content: unknown;
  content_parts: ContentPartData[];
  attributes: string;
  latency_ms: Record<string, number> | null;
  status: string;
  error_message: string | null;
  is_truncated: boolean;
}

/**
 * Handles asynchronous batching and writing of events to BigQuery.
 */
class BatchProcessor {
  private readonly batchSize: number;
  private readonly flushInterval: number;
  private readonly retryConfig: Required<RetryConfig>;
  private readonly shutdownTimeout: number;
  private readonly queueMaxSize: number;

  private queue: BigQueryRow[] = [];
  private isShutdown = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private writeClient: BigQueryClient | null = null;
  private writeStream: string = '';
  private schema: BigQuerySchema;

  constructor(
    private readonly projectId: string,
    private readonly datasetId: string,
    private readonly tableId: string,
    config: {
      batchSize: number;
      flushInterval: number;
      retryConfig: RetryConfig;
      queueMaxSize: number;
      shutdownTimeout: number;
    }
  ) {
    this.batchSize = config.batchSize;
    this.flushInterval = config.flushInterval;
    this.queueMaxSize = config.queueMaxSize;
    this.shutdownTimeout = config.shutdownTimeout;
    this.retryConfig = {
      maxRetries: config.retryConfig.maxRetries ?? 3,
      initialDelay: config.retryConfig.initialDelay ?? 1000,
      multiplier: config.retryConfig.multiplier ?? 2.0,
      maxDelay: config.retryConfig.maxDelay ?? 10000,
    };
    this.schema = getEventsSchema();
    this.writeStream = `projects/${this.projectId}/datasets/${this.datasetId}/tables/${this.tableId}/_default`;
  }

  /**
   * Initializes the BigQuery write client.
   */
  async initialize(): Promise<void> {
    try {
      // Dynamic import to handle optional peer dependency
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bigquery = await import('@google-cloud/bigquery' as any);
      const BigQuery = bigquery.BigQuery;
      this.writeClient = new BigQuery({
        projectId: this.projectId,
      }) as unknown as BigQueryClient;
    } catch (error) {
      logger.error(
        'Failed to initialize BigQuery client. Make sure @google-cloud/bigquery is installed:',
        error
      );
      throw error;
    }
  }

  /**
   * Starts the batch processor flush timer.
   */
  start(): void {
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.isShutdown) return;

    this.flushTimer = setTimeout(async () => {
      await this.flush();
      this.scheduleFlush();
    }, this.flushInterval);
  }

  /**
   * Appends a row to the queue for batching.
   */
  async append(row: BigQueryRow): Promise<void> {
    if (this.isShutdown) {
      logger.warn('BatchProcessor is shutdown, dropping event.');
      return;
    }

    if (this.queue.length >= this.queueMaxSize) {
      logger.warn('BigQuery log queue full, dropping event.');
      return;
    }

    this.queue.push(row);

    // Flush immediately if batch size reached
    if (this.queue.length >= this.batchSize) {
      await this.flush();
    }
  }

  /**
   * Flushes the current batch to BigQuery.
   */
  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.batchSize);
    await this.writeRowsWithRetry(batch);
  }

  /**
   * Writes rows to BigQuery with retry logic.
   */
  private async writeRowsWithRetry(rows: BigQueryRow[]): Promise<void> {
    if (!this.writeClient) {
      logger.warn('BigQuery client not initialized, dropping rows.');
      return;
    }

    let attempt = 0;
    let delay = this.retryConfig.initialDelay;

    while (attempt <= this.retryConfig.maxRetries) {
      try {
        // Convert rows to BigQuery format
        const bqRows = rows.map((row) => this.convertRowToBigQueryFormat(row));

        // Insert rows using insertAll (streaming insert)
        await this.writeClient.dataset(this.datasetId).table(this.tableId).insert(bqRows);

        return;
      } catch (error) {
        const err = error as {code?: number; message?: string; errors?: unknown[]};

        // Check if error is retryable
        const isRetryable =
          err.code === GRPC_DEADLINE_EXCEEDED ||
          err.code === GRPC_INTERNAL ||
          err.code === GRPC_UNAVAILABLE ||
          (err.message && err.message.includes('UNAVAILABLE'));

        if (!isRetryable || attempt >= this.retryConfig.maxRetries) {
          logger.error(
            `BigQuery write failed after ${attempt + 1} attempts:`,
            error
          );
          if (err.errors) {
            logger.error('Row errors:', err.errors);
          }
          return;
        }

        attempt++;
        const sleepTime = Math.min(
          delay * (1 + Math.random()),
          this.retryConfig.maxDelay
        );
        logger.warn(
          `BigQuery write failed (Attempt ${attempt}), retrying in ${sleepTime.toFixed(0)}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, sleepTime));
        delay *= this.retryConfig.multiplier;
      }
    }
  }

  /**
   * Converts a row to BigQuery insert format.
   */
  private convertRowToBigQueryFormat(row: BigQueryRow): Record<string, unknown> {
    return {
      timestamp: row.timestamp.toISOString(),
      event_type: row.event_type,
      agent: row.agent ?? null,
      user_id: row.user_id ?? null,
      session_id: row.session_id,
      invocation_id: row.invocation_id,
      trace_id: row.trace_id ?? null,
      span_id: row.span_id ?? null,
      parent_span_id: row.parent_span_id ?? null,
      content:
        row.content !== null && row.content !== undefined
          ? typeof row.content === 'string'
            ? row.content
            : JSON.stringify(row.content)
          : null,
      content_parts: row.content_parts.map((part) => ({
        mime_type: part.mimeType,
        uri: part.uri,
        object_ref: part.objectRef
          ? {
              uri: part.objectRef.uri,
              version: part.objectRef.version,
              authorizer: part.objectRef.authorizer,
              details: part.objectRef.details,
            }
          : null,
        text: part.text,
        part_index: part.partIndex,
        part_attributes: part.partAttributes,
        storage_mode: part.storageMode,
      })),
      attributes: row.attributes,
      latency_ms: row.latency_ms ? JSON.stringify(row.latency_ms) : null,
      status: row.status,
      error_message: row.error_message,
      is_truncated: row.is_truncated,
    };
  }

  /**
   * Shuts down the batch processor, draining the queue.
   */
  async shutdown(): Promise<void> {
    if (this.isShutdown) return;

    this.isShutdown = true;
    logger.info('BatchProcessor shutting down, draining queue...');

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush remaining items
    const shutdownStart = Date.now();
    while (
      this.queue.length > 0 &&
      Date.now() - shutdownStart < this.shutdownTimeout
    ) {
      await this.flush();
    }

    if (this.queue.length > 0) {
      logger.warn(
        `BatchProcessor shutdown timed out, ${this.queue.length} events dropped.`
      );
    }
  }
}

// ==============================================================================
// SCHEMA DEFINITION
// ==============================================================================

interface SchemaField {
  name: string;
  type: string;
  mode?: string;
  description?: string;
  fields?: SchemaField[];
}

type BigQuerySchema = SchemaField[];

/**
 * Returns the BigQuery schema for the events table.
 */
function getEventsSchema(): BigQuerySchema {
  return [
    {
      name: 'timestamp',
      type: 'TIMESTAMP',
      mode: 'REQUIRED',
      description:
        'The UTC timestamp when the event occurred. Used for ordering events within a session.',
    },
    {
      name: 'event_type',
      type: 'STRING',
      mode: 'NULLABLE',
      description:
        "The category of the event (e.g., 'LLM_REQUEST', 'TOOL_CALL', 'AGENT_RESPONSE').",
    },
    {
      name: 'agent',
      type: 'STRING',
      mode: 'NULLABLE',
      description:
        'The name of the agent that generated this event. Useful for multi-agent systems.',
    },
    {
      name: 'session_id',
      type: 'STRING',
      mode: 'NULLABLE',
      description:
        'A unique identifier for the entire conversation session.',
    },
    {
      name: 'invocation_id',
      type: 'STRING',
      mode: 'NULLABLE',
      description:
        'A unique identifier for a single turn or execution within a session.',
    },
    {
      name: 'user_id',
      type: 'STRING',
      mode: 'NULLABLE',
      description:
        'The identifier of the end-user participating in the session.',
    },
    {
      name: 'trace_id',
      type: 'STRING',
      mode: 'NULLABLE',
      description: 'OpenTelemetry trace ID for distributed tracing.',
    },
    {
      name: 'span_id',
      type: 'STRING',
      mode: 'NULLABLE',
      description: 'OpenTelemetry span ID for this specific operation.',
    },
    {
      name: 'parent_span_id',
      type: 'STRING',
      mode: 'NULLABLE',
      description:
        'OpenTelemetry parent span ID to reconstruct the operation hierarchy.',
    },
    {
      name: 'content',
      type: 'JSON',
      mode: 'NULLABLE',
      description:
        'The primary payload of the event, stored as a JSON string.',
    },
    {
      name: 'content_parts',
      type: 'RECORD',
      mode: 'REPEATED',
      description:
        'For multi-modal events, contains a list of content parts.',
      fields: [
        {
          name: 'mime_type',
          type: 'STRING',
          mode: 'NULLABLE',
          description: "The MIME type of the content part.",
        },
        {
          name: 'uri',
          type: 'STRING',
          mode: 'NULLABLE',
          description: 'The URI of the content part if stored externally.',
        },
        {
          name: 'object_ref',
          type: 'RECORD',
          mode: 'NULLABLE',
          description: 'The ObjectRef of the content part if stored externally.',
          fields: [
            {name: 'uri', type: 'STRING', mode: 'NULLABLE'},
            {name: 'version', type: 'STRING', mode: 'NULLABLE'},
            {name: 'authorizer', type: 'STRING', mode: 'NULLABLE'},
            {name: 'details', type: 'JSON', mode: 'NULLABLE'},
          ],
        },
        {
          name: 'text',
          type: 'STRING',
          mode: 'NULLABLE',
          description: 'The raw text content if the part is text-based.',
        },
        {
          name: 'part_index',
          type: 'INTEGER',
          mode: 'NULLABLE',
          description: 'The zero-based index of this part within the content.',
        },
        {
          name: 'part_attributes',
          type: 'STRING',
          mode: 'NULLABLE',
          description: 'Additional metadata for this content part as JSON.',
        },
        {
          name: 'storage_mode',
          type: 'STRING',
          mode: 'NULLABLE',
          description:
            "Indicates how the content part is stored (e.g., 'INLINE', 'GCS_REFERENCE').",
        },
      ],
    },
    {
      name: 'attributes',
      type: 'JSON',
      mode: 'NULLABLE',
      description:
        'A JSON object containing arbitrary key-value pairs for additional event metadata.',
    },
    {
      name: 'latency_ms',
      type: 'JSON',
      mode: 'NULLABLE',
      description:
        "A JSON object containing latency measurements ('total_ms', 'time_to_first_token_ms').",
    },
    {
      name: 'status',
      type: 'STRING',
      mode: 'NULLABLE',
      description: "The outcome of the event, typically 'OK' or 'ERROR'.",
    },
    {
      name: 'error_message',
      type: 'STRING',
      mode: 'NULLABLE',
      description: "Detailed error message if the status is 'ERROR'.",
    },
    {
      name: 'is_truncated',
      type: 'BOOLEAN',
      mode: 'NULLABLE',
      description:
        'Boolean flag indicating if the content field was truncated.',
    },
  ];
}

// ==============================================================================
// CONTENT PARSER
// ==============================================================================

/**
 * Parses content for logging with optional GCS offloading.
 */
class ContentParser {
  private readonly maxLength: number;
  private readonly connectionId?: string;
  private readonly gcsBucketName?: string;
  private traceId: string;
  private spanId: string;

  constructor(config: {
    maxLength: number;
    connectionId?: string;
    gcsBucketName?: string;
    traceId?: string;
    spanId?: string;
  }) {
    this.maxLength = config.maxLength;
    this.connectionId = config.connectionId;
    this.gcsBucketName = config.gcsBucketName;
    this.traceId = config.traceId ?? 'no_trace';
    this.spanId = config.spanId ?? 'no_span';
  }

  /**
   * Updates trace and span IDs for GCS path generation.
   */
  updateContext(traceId: string, spanId: string): void {
    this.traceId = traceId;
    this.spanId = spanId;
  }

  private truncate(text: string): [string, boolean] {
    if (this.maxLength !== -1 && text.length > this.maxLength) {
      return [text.substring(0, this.maxLength) + '...[TRUNCATED]', true];
    }
    return [text, false];
  }

  /**
   * Parses a Content object into summary text and content parts.
   */
  private async parseContentObject(
    content: Content | Part
  ): Promise<[string, ContentPartData[], boolean]> {
    const contentParts: ContentPartData[] = [];
    let isTruncated = false;
    const summaryText: string[] = [];

    // Get parts array - if content has 'parts' property, use it; otherwise treat content as a single Part
    const parts: Part[] =
      'parts' in content && content.parts
        ? (content.parts as Part[])
        : [content as Part];

    for (let idx = 0; idx < parts.length; idx++) {
      const part = parts[idx];
      const partData: ContentPartData = {
        partIndex: idx,
        mimeType: 'text/plain',
        uri: null,
        text: null,
        partAttributes: '{}',
        storageMode: 'INLINE',
        objectRef: null,
      };

      // CASE A: File data (already a URI)
      if (part.fileData) {
        partData.storageMode = 'EXTERNAL_URI';
        partData.uri = part.fileData.fileUri ?? null;
        partData.mimeType = part.fileData.mimeType ?? 'application/octet-stream';
      }
      // CASE B: Inline data (binary)
      else if (part.inlineData) {
        // For now, just mark as binary data without GCS offloading
        // GCS offloading would require @google-cloud/storage which is optional
        partData.text = '[BINARY DATA]';
        partData.mimeType = part.inlineData.mimeType ?? 'application/octet-stream';
      }
      // CASE C: Text
      else if (part.text !== undefined) {
        const [cleanText, truncated] = this.truncate(part.text);
        if (truncated) isTruncated = true;
        partData.text = cleanText;
        summaryText.push(cleanText);
      }
      // CASE D: Function call
      else if (part.functionCall) {
        partData.mimeType = 'application/json';
        partData.text = `Function: ${part.functionCall.name}`;
        partData.partAttributes = JSON.stringify({
          functionName: part.functionCall.name,
        });
      }
      // CASE E: Function response
      else if (part.functionResponse) {
        partData.mimeType = 'application/json';
        partData.text = `Response: ${part.functionResponse.name}`;
        partData.partAttributes = JSON.stringify({
          functionName: part.functionResponse.name,
        });
      }

      contentParts.push(partData);
    }

    const [summaryStr, truncated] = this.truncate(summaryText.join(' | '));
    if (truncated) isTruncated = true;

    return [summaryStr, contentParts, isTruncated];
  }

  /**
   * Parses content into JSON payload and content parts.
   */
  async parse(
    content: unknown
  ): Promise<[unknown, ContentPartData[], boolean]> {
    let jsonPayload: unknown = {};
    const contentParts: ContentPartData[] = [];
    let isTruncated = false;

    if (this.isLlmRequest(content)) {
      const req = content as LlmRequest;
      const messages: Array<{role: string; content: string}> = [];

      const contents = Array.isArray(req.contents)
        ? req.contents
        : [req.contents];

      for (const c of contents) {
        if (!c) continue;
        const role = c.role ?? 'unknown';
        const [summary, parts, trunc] = await this.parseContentObject(c);
        if (trunc) isTruncated = true;
        contentParts.push(...parts);
        messages.push({role, content: summary});
      }

      if (messages.length > 0) {
        (jsonPayload as Record<string, unknown>)['prompt'] = messages;
      }

      // Handle system instruction
      if (req.config?.systemInstruction) {
        const si = req.config.systemInstruction;
        if (typeof si === 'string') {
          (jsonPayload as Record<string, unknown>)['system_prompt'] = si;
        } else {
          const [summary, parts, trunc] = await this.parseContentObject(
            si as Content
          );
          if (trunc) isTruncated = true;
          contentParts.push(...parts);
          (jsonPayload as Record<string, unknown>)['system_prompt'] = summary;
        }
      }
    } else if (this.isContent(content) || this.isPart(content)) {
      const [summary, parts, trunc] = await this.parseContentObject(
        content as Content | Part
      );
      return [{text_summary: summary}, parts, trunc];
    } else if (typeof content === 'object' && content !== null) {
      const [truncated, isTrunc] = recursiveSmartTruncate(
        content,
        this.maxLength
      );
      jsonPayload = truncated;
      isTruncated = isTrunc;
    } else if (typeof content === 'string') {
      const [truncated, isTrunc] = this.truncate(content);
      jsonPayload = truncated;
      isTruncated = isTrunc;
    } else if (content === null || content === undefined) {
      jsonPayload = null;
    } else {
      const [truncated, isTrunc] = this.truncate(String(content));
      jsonPayload = truncated;
      isTruncated = isTrunc;
    }

    return [jsonPayload, contentParts, isTruncated];
  }

  private isLlmRequest(obj: unknown): obj is LlmRequest {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'contents' in obj
    );
  }

  private isContent(obj: unknown): obj is Content {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'parts' in obj
    );
  }

  private isPart(obj: unknown): obj is Part {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      ('text' in obj ||
        'inlineData' in obj ||
        'fileData' in obj ||
        'functionCall' in obj ||
        'functionResponse' in obj)
    );
  }
}

// ==============================================================================
// MAIN PLUGIN
// ==============================================================================

/**
 * BigQuery Agent Analytics Plugin (v2.0).
 *
 * Logs agent events (LLM requests, tool calls, etc.) to BigQuery for analytics.
 * Uses the BigQuery streaming insert API for efficient, asynchronous logging.
 *
 * @example
 * ```typescript
 * const analyticsPlugin = new BigQueryAgentAnalyticsPlugin({
 *   projectId: 'my-project',
 *   datasetId: 'agent_analytics',
 * });
 *
 * const runner = new Runner({
 *   agents: [myAgent],
 *   plugins: [analyticsPlugin],
 * });
 *
 * // When done, shutdown to flush remaining logs
 * await analyticsPlugin.shutdown();
 * ```
 */
export class BigQueryAgentAnalyticsPlugin extends BasePlugin {
  private readonly projectId: string;
  private readonly datasetId: string;
  private readonly tableId: string;
  private readonly config: Required<
    Omit<BigQueryLoggerConfig, 'contentFormatter' | 'gcsBucketName' | 'connectionId' | 'eventAllowlist' | 'eventDenylist'>
  > & Pick<BigQueryLoggerConfig, 'contentFormatter' | 'gcsBucketName' | 'connectionId' | 'eventAllowlist' | 'eventDenylist'>;
  private readonly location: string;

  private started = false;
  private isShuttingDown = false;
  private batchProcessor: BatchProcessor | null = null;
  private parser: ContentParser | null = null;

  /**
   * Creates a new BigQueryAgentAnalyticsPlugin.
   *
   * @param options Configuration options.
   */
  constructor(options: {
    projectId: string;
    datasetId: string;
    tableId?: string;
    config?: BigQueryLoggerConfig;
    location?: string;
  }) {
    super('bigquery_agent_analytics');

    this.projectId = options.projectId;
    this.datasetId = options.datasetId;
    this.location = options.location ?? 'US';

    const cfg = options.config ?? {};
    this.tableId = options.tableId ?? cfg.tableId ?? 'agent_events_v2';

    this.config = {
      enabled: cfg.enabled ?? true,
      eventAllowlist: cfg.eventAllowlist,
      eventDenylist: cfg.eventDenylist,
      maxContentLength: cfg.maxContentLength ?? 500 * 1024,
      tableId: this.tableId,
      clusteringFields: cfg.clusteringFields ?? [
        'event_type',
        'agent',
        'user_id',
      ],
      logMultiModalContent: cfg.logMultiModalContent ?? true,
      retryConfig: cfg.retryConfig ?? {},
      batchSize: cfg.batchSize ?? 1,
      batchFlushInterval: cfg.batchFlushInterval ?? 1000,
      shutdownTimeout: cfg.shutdownTimeout ?? 10000,
      queueMaxSize: cfg.queueMaxSize ?? 10000,
      contentFormatter: cfg.contentFormatter,
      gcsBucketName: cfg.gcsBucketName,
      connectionId: cfg.connectionId,
    };
  }

  /**
   * Formats content using config.contentFormatter or default formatter.
   */
  private formatContentSafely(content: Content | undefined): [string, boolean] {
    if (!content) return ['None', false];
    try {
      return formatContent(content, this.config.maxContentLength);
    } catch (error) {
      logger.warn('Content formatter failed:', error);
      return ['[FORMATTING FAILED]', false];
    }
  }

  /**
   * Performs lazy initialization of BigQuery clients.
   */
  private async lazySetup(): Promise<void> {
    if (this.started) return;

    this.batchProcessor = new BatchProcessor(
      this.projectId,
      this.datasetId,
      this.tableId,
      {
        batchSize: this.config.batchSize,
        flushInterval: this.config.batchFlushInterval,
        retryConfig: this.config.retryConfig,
        queueMaxSize: this.config.queueMaxSize,
        shutdownTimeout: this.config.shutdownTimeout,
      }
    );

    await this.batchProcessor.initialize();
    this.batchProcessor.start();

    this.parser = new ContentParser({
      maxLength: this.config.maxContentLength,
      connectionId: this.config.connectionId,
      gcsBucketName: this.config.gcsBucketName,
    });

    this.started = true;
  }

  /**
   * Ensures the plugin is started and initialized.
   */
  private async ensureStarted(): Promise<void> {
    if (!this.started && !this.isShuttingDown) {
      try {
        await this.lazySetup();
      } catch (error) {
        logger.error('Failed to initialize BigQuery Plugin:', error);
      }
    }
  }

  /**
   * Logs an event to BigQuery.
   */
  private async logEvent(
    eventType: string,
    callbackContext: CallbackContext,
    rawContent: unknown = null,
    isTruncated = false,
    extraArgs: Record<string, unknown> = {}
  ): Promise<void> {
    if (!this.config.enabled || this.isShuttingDown) return;

    if (
      this.config.eventDenylist &&
      this.config.eventDenylist.includes(eventType)
    ) {
      return;
    }

    if (
      this.config.eventAllowlist &&
      !this.config.eventAllowlist.includes(eventType)
    ) {
      return;
    }

    if (!this.started) {
      await this.ensureStarted();
      if (!this.started) return;
    }

    const timestamp = new Date();

    // Apply custom formatter if provided
    let content = rawContent;
    if (this.config.contentFormatter) {
      try {
        content = this.config.contentFormatter(rawContent, eventType);
      } catch (error) {
        logger.warn('Content formatter failed:', error);
      }
    }

    const traceId = TraceManager.getTraceId(callbackContext);
    let [currentSpanId, currentParentSpanId] =
      TraceManager.getCurrentSpanAndParent();

    // Handle span ID overrides
    if ('spanIdOverride' in extraArgs && extraArgs.spanIdOverride !== undefined) {
      currentSpanId = extraArgs.spanIdOverride as string;
      delete extraArgs.spanIdOverride;
    }
    if (
      'parentSpanIdOverride' in extraArgs &&
      extraArgs.parentSpanIdOverride !== undefined
    ) {
      currentParentSpanId = extraArgs.parentSpanIdOverride as string;
      delete extraArgs.parentSpanIdOverride;
    }

    // Update parser context
    this.parser!.updateContext(traceId ?? 'no_trace', currentSpanId ?? 'no_span');

    // Parse content
    const [contentJson, contentParts, parserTruncated] =
      await this.parser!.parse(content);
    isTruncated = isTruncated || parserTruncated;

    // Build latency object
    const latencyMs: Record<string, number> = {};
    if (extraArgs.latencyMs !== undefined) {
      latencyMs.total_ms = extraArgs.latencyMs as number;
      delete extraArgs.latencyMs;
    }
    if (extraArgs.timeToFirstTokenMs !== undefined) {
      latencyMs.time_to_first_token_ms = extraArgs.timeToFirstTokenMs as number;
      delete extraArgs.timeToFirstTokenMs;
    }

    // Extract status and error
    const status = (extraArgs.status as string) ?? 'OK';
    const errorMessage = (extraArgs.errorMessage as string) ?? null;
    delete extraArgs.status;
    delete extraArgs.errorMessage;

    // Extract model metadata
    const model = extraArgs.model;
    const modelVersion = extraArgs.modelVersion;
    const usageMetadata = extraArgs.usageMetadata;
    delete extraArgs.model;
    delete extraArgs.modelVersion;
    delete extraArgs.usageMetadata;

    // Build attributes
    const attributes: Record<string, unknown> = {
      rootAgentName: TraceManager.getRootAgentName(),
      ...extraArgs,
    };

    if (model) attributes.model = model;
    if (modelVersion) attributes.modelVersion = modelVersion;
    if (usageMetadata) {
      const [truncatedUsage] = recursiveSmartTruncate(
        usageMetadata,
        this.config.maxContentLength
      );
      attributes.usageMetadata = truncatedUsage;
    }

    // Serialize attributes
    let attributesJson: string;
    try {
      attributesJson = JSON.stringify(attributes);
    } catch {
      attributesJson = JSON.stringify(attributes, (_, v) =>
        typeof v === 'bigint' ? v.toString() : v
      );
    }

    const row: BigQueryRow = {
      timestamp,
      event_type: eventType,
      agent: callbackContext.agentName,
      user_id: callbackContext.invocationContext.userId,
      session_id: callbackContext.invocationContext.session.id,
      invocation_id: callbackContext.invocationId,
      trace_id: traceId,
      span_id: currentSpanId,
      parent_span_id: currentParentSpanId,
      content: contentJson,
      content_parts: this.config.logMultiModalContent ? contentParts : [],
      attributes: attributesJson,
      latency_ms: Object.keys(latencyMs).length > 0 ? latencyMs : null,
      status,
      error_message: errorMessage,
      is_truncated: isTruncated,
    };

    if (this.batchProcessor) {
      await this.batchProcessor.append(row);
    }
  }

  // ===========================================================================
  // CALLBACK IMPLEMENTATIONS
  // ===========================================================================

  override async onUserMessageCallback({
    invocationContext,
    userMessage,
  }: {
    invocationContext: InvocationContext;
    userMessage: Content;
  }): Promise<Content | undefined> {
    await this.logEvent(
      'USER_MESSAGE_RECEIVED',
      new CallbackContext({invocationContext}),
      userMessage
    );
    return undefined;
  }

  override async beforeRunCallback({
    invocationContext,
  }: {
    invocationContext: InvocationContext;
  }): Promise<Content | undefined> {
    await this.ensureStarted();
    await this.logEvent(
      'INVOCATION_STARTING',
      new CallbackContext({invocationContext})
    );
    return undefined;
  }

  override async afterRunCallback({
    invocationContext,
  }: {
    invocationContext: InvocationContext;
  }): Promise<void> {
    await this.logEvent(
      'INVOCATION_COMPLETED',
      new CallbackContext({invocationContext})
    );
  }

  override async beforeAgentCallback({
    agent,
    callbackContext,
  }: {
    agent: BaseAgent;
    callbackContext: CallbackContext;
  }): Promise<Content | undefined> {
    TraceManager.initTrace(callbackContext);
    TraceManager.pushSpan(callbackContext);
    await this.logEvent(
      'AGENT_STARTING',
      callbackContext,
      (agent as unknown as {instruction?: string}).instruction ?? ''
    );
    return undefined;
  }

  override async afterAgentCallback({
    callbackContext,
  }: {
    agent: BaseAgent;
    callbackContext: CallbackContext;
  }): Promise<Content | undefined> {
    const [spanId, duration] = TraceManager.popSpan();
    const [, parentSpanId] = TraceManager.getCurrentSpanAndParent();

    await this.logEvent('AGENT_COMPLETED', callbackContext, null, false, {
      latencyMs: duration,
      spanIdOverride: spanId,
      parentSpanIdOverride: parentSpanId,
    });
    return undefined;
  }

  override async beforeModelCallback({
    callbackContext,
    llmRequest,
  }: {
    callbackContext: CallbackContext;
    llmRequest: LlmRequest;
  }): Promise<LlmResponse | undefined> {
    // Build attributes
    const attributes: Record<string, unknown> = {};

    if (llmRequest.config) {
      const configDict: Record<string, unknown> = {};
      for (const fieldName of [
        'temperature',
        'topP',
        'topK',
        'candidateCount',
        'maxOutputTokens',
        'stopSequences',
      ]) {
        const val = (llmRequest.config as Record<string, unknown>)[fieldName];
        if (val !== undefined && val !== null) {
          configDict[fieldName] = val;
        }
      }
      if (Object.keys(configDict).length > 0) {
        attributes.llmConfig = configDict;
      }
    }

    if (llmRequest.toolsDict && Object.keys(llmRequest.toolsDict).length > 0) {
      attributes.tools = Object.keys(llmRequest.toolsDict);
    }

    TraceManager.pushSpan(callbackContext);
    await this.logEvent('LLM_REQUEST', callbackContext, llmRequest, false, {
      model: llmRequest.model,
      ...attributes,
    });

    return undefined;
  }

  override async afterModelCallback({
    callbackContext,
    llmResponse,
  }: {
    callbackContext: CallbackContext;
    llmResponse: LlmResponse;
  }): Promise<LlmResponse | undefined> {
    const contentDict: Record<string, unknown> = {};
    let isTruncated = false;

    if (llmResponse.content) {
      const [partStr, partTruncated] = this.formatContentSafely(
        llmResponse.content
      );
      if (partStr) contentDict.response = partStr;
      if (partTruncated) isTruncated = true;
    }

    if (llmResponse.usageMetadata) {
      const usage = llmResponse.usageMetadata;
      const usageDict: Record<string, number> = {};
      if (usage.promptTokenCount !== undefined) {
        usageDict.prompt = usage.promptTokenCount;
      }
      if (usage.candidatesTokenCount !== undefined) {
        usageDict.completion = usage.candidatesTokenCount;
      }
      if (usage.totalTokenCount !== undefined) {
        usageDict.total = usage.totalTokenCount;
      }
      if (Object.keys(usageDict).length > 0) {
        contentDict.usage = usageDict;
      }
    }

    let spanId = TraceManager.getCurrentSpanId();
    const [, parentSpanId] = TraceManager.getCurrentSpanAndParent();

    let isPopped = false;
    let duration: number | undefined;
    let tfft: number | undefined;

    if (llmResponse.partial) {
      // Streaming chunk - do NOT pop span yet
      if (spanId) {
        TraceManager.recordFirstToken(spanId);
        const startTime = TraceManager.getStartTime(spanId);
        const firstToken = TraceManager.getFirstTokenTime(spanId);
        if (startTime) {
          duration = Date.now() - startTime;
        }
        if (startTime && firstToken) {
          tfft = firstToken - startTime;
        }
      }
    } else {
      // Final response - pop span
      if (spanId) {
        TraceManager.recordFirstToken(spanId);
        const startTime = TraceManager.getStartTime(spanId);
        const firstToken = TraceManager.getFirstTokenTime(spanId);
        if (startTime && firstToken) {
          tfft = firstToken - startTime;
        }
      }

      const [poppedSpanId, poppedDuration] = TraceManager.popSpan();
      isPopped = true;
      spanId = poppedSpanId ?? spanId;
      duration = poppedDuration;
    }

    const extraKwargs: Record<string, unknown> = {};
    if (tfft !== undefined) {
      extraKwargs.timeToFirstTokenMs = tfft;
    }

    await this.logEvent(
      'LLM_RESPONSE',
      callbackContext,
      Object.keys(contentDict).length > 0 ? contentDict : null,
      isTruncated,
      {
        latencyMs: duration,
        usageMetadata: llmResponse.usageMetadata,
        spanIdOverride: isPopped ? spanId : undefined,
        parentSpanIdOverride: isPopped ? parentSpanId : undefined,
        ...extraKwargs,
      }
    );

    return undefined;
  }

  override async onModelErrorCallback({
    callbackContext,
    error,
  }: {
    callbackContext: CallbackContext;
    llmRequest: LlmRequest;
    error: Error;
  }): Promise<LlmResponse | undefined> {
    const [spanId, duration] = TraceManager.popSpan();
    const [, parentSpanId] = TraceManager.getCurrentSpanAndParent();

    await this.logEvent('LLM_ERROR', callbackContext, null, false, {
      errorMessage: String(error),
      latencyMs: duration,
      spanIdOverride: spanId,
      parentSpanIdOverride: parentSpanId,
      status: 'ERROR',
    });

    return undefined;
  }

  override async beforeToolCallback({
    tool,
    toolArgs,
    toolContext,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
  }): Promise<Record<string, unknown> | undefined> {
    const [argsTruncated, isTruncated] = recursiveSmartTruncate(
      toolArgs,
      this.config.maxContentLength
    );

    const contentDict = {tool: tool.name, args: argsTruncated};

    TraceManager.pushSpan(toolContext);
    await this.logEvent('TOOL_STARTING', toolContext, contentDict, isTruncated);

    return undefined;
  }

  override async afterToolCallback({
    tool,
    toolContext,
    result,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
    result: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined> {
    const [respTruncated, isTruncated] = recursiveSmartTruncate(
      result,
      this.config.maxContentLength
    );

    const contentDict = {tool: tool.name, result: respTruncated};

    const [spanId, duration] = TraceManager.popSpan();
    const [, parentSpanId] = TraceManager.getCurrentSpanAndParent();

    await this.logEvent(
      'TOOL_COMPLETED',
      toolContext,
      contentDict,
      isTruncated,
      {
        latencyMs: duration,
        spanIdOverride: spanId,
        parentSpanIdOverride: parentSpanId,
      }
    );

    return undefined;
  }

  override async onToolErrorCallback({
    tool,
    toolArgs,
    toolContext,
    error,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
    error: Error;
  }): Promise<Record<string, unknown> | undefined> {
    const [argsTruncated, isTruncated] = recursiveSmartTruncate(
      toolArgs,
      this.config.maxContentLength
    );

    const contentDict = {tool: tool.name, args: argsTruncated};

    const [spanId, duration] = TraceManager.popSpan();
    const [, parentSpanId] = TraceManager.getCurrentSpanAndParent();

    await this.logEvent('TOOL_ERROR', toolContext, contentDict, isTruncated, {
      errorMessage: String(error),
      latencyMs: duration,
      spanIdOverride: spanId,
      parentSpanIdOverride: parentSpanId,
      status: 'ERROR',
    });

    return undefined;
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  /**
   * Shuts down the plugin and releases resources.
   * Call this when done using the plugin to ensure all logs are flushed.
   */
  async shutdown(timeout?: number): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    logger.info('BigQueryAgentAnalyticsPlugin shutting down...');

    try {
      if (this.batchProcessor) {
        await this.batchProcessor.shutdown();
      }
    } catch (error) {
      logger.error('Error during shutdown:', error);
    }

    this.started = false;
    this.isShuttingDown = false;
  }
}
