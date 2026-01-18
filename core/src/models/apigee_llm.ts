/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI} from '@google/genai';

import {logger} from '../utils/logger.js';
import {version} from '../version.js';

import {Gemini, type GeminiParams} from './google_llm.js';
import type {LlmRequest} from './llm_request.js';

/**
 * HTTP retry options for handling transient failures.
 * Matches the google.genai.types.HttpRetryOptions interface.
 */
export interface HttpRetryOptions {
  /**
   * Initial delay before first retry in milliseconds.
   */
  initialDelay?: number;
  /**
   * Maximum number of retry attempts.
   */
  attempts?: number;
  /**
   * Maximum delay between retries in milliseconds.
   */
  maxDelay?: number;
  /**
   * Multiplier for exponential backoff.
   */
  backoffMultiplier?: number;
}

const APIGEE_PROXY_URL_ENV_VARIABLE_NAME = 'APIGEE_PROXY_URL';
const GOOGLE_GENAI_USE_VERTEXAI_ENV_VARIABLE_NAME = 'GOOGLE_GENAI_USE_VERTEXAI';
const PROJECT_ENV_VARIABLE_NAME = 'GOOGLE_CLOUD_PROJECT';
const LOCATION_ENV_VARIABLE_NAME = 'GOOGLE_CLOUD_LOCATION';

/**
 * The parameters for creating an ApigeeLlm instance.
 */
export interface ApigeeLlmParams extends Omit<GeminiParams, 'apiKey' | 'vertexai'> {
  /**
   * The model string specifies the LLM provider (e.g., Vertex AI, Gemini),
   * API version, and the model ID.
   *
   * Supported format: `apigee/[<provider>/][<version>/]<model_id>`
   *
   * Components:
   * - `provider` (optional): `vertex_ai` or `gemini`. If omitted, behavior
   *   depends on the `GOOGLE_GENAI_USE_VERTEXAI` environment variable. If
   *   that is not set to TRUE or 1, it defaults to `gemini`. `provider`
   *   takes precedence over `GOOGLE_GENAI_USE_VERTEXAI`.
   * - `version` (optional): The API version (e.g., `v1`, `v1beta`). If
   *   omitted, the default version for the provider is used.
   * - `model_id` (required): The model identifier (e.g., `gemini-2.5-flash`).
   *
   * Examples:
   * - `apigee/gemini-2.5-flash`
   * - `apigee/v1/gemini-2.5-flash`
   * - `apigee/vertex_ai/gemini-2.5-flash`
   * - `apigee/gemini/v1/gemini-2.5-flash`
   * - `apigee/vertex_ai/v1beta/gemini-2.5-flash`
   */
  model: string;

  /**
   * The URL of the Apigee proxy. If not provided, it will look for
   * the APIGEE_PROXY_URL environment variable.
   */
  proxyUrl?: string;

  /**
   * Custom headers to be sent with each request.
   */
  customHeaders?: Record<string, string>;

  /**
   * HTTP retry configuration for handling transient failures.
   */
  retryOptions?: HttpRetryOptions;
}

/**
 * A BaseLlm implementation for calling Apigee proxy.
 *
 * ApigeeLlm extends Gemini to route requests through an Apigee AI Gateway proxy,
 * enabling enterprise features such as:
 * - Model Armor (content safety)
 * - Rate Limiting
 * - Token Limiting
 * - Semantic Caching
 * - Monitoring and Auditing
 *
 * @example
 * ```typescript
 * // Basic usage with model string
 * const llm = new ApigeeLlm({
 *   model: 'apigee/gemini-2.5-flash',
 *   proxyUrl: 'https://my-proxy.apigee.net/v1',
 * });
 *
 * // With Vertex AI provider
 * const llm = new ApigeeLlm({
 *   model: 'apigee/vertex_ai/gemini-2.5-flash',
 * });
 *
 * // With custom API version
 * const llm = new ApigeeLlm({
 *   model: 'apigee/vertex_ai/v1beta/gemini-2.5-flash',
 *   customHeaders: {'X-Custom-Header': 'value'},
 * });
 * ```
 */
export class ApigeeLlm extends Gemini {
  /**
   * A list of model name patterns that are supported by this LLM.
   */
  static override readonly supportedModels: Array<string | RegExp> = [
    /apigee\/.*/,
  ];

  private readonly proxyUrl?: string;
  private readonly customHeaders: Record<string, string>;
  private readonly retryOptions?: HttpRetryOptions;
  private readonly isVertexai: boolean;
  private readonly apiVersion?: string;
  private readonly _project?: string;
  private readonly _location?: string;
  private readonly userAgent: string;
  private _apigeeApiClient?: GoogleGenAI;

  /**
   * Creates an ApigeeLlm instance.
   *
   * @param params The parameters for creating an ApigeeLlm instance.
   * @throws Error if the model string is invalid or required environment
   *         variables are missing for Vertex AI mode.
   */
  constructor({
    model,
    proxyUrl,
    customHeaders,
    retryOptions,
    headers,
    project,
    location,
    useInteractionsApi,
  }: ApigeeLlmParams) {
    // Validate the model string before calling super
    if (!validateModelString(model)) {
      throw new Error(`Invalid model string: ${model}. Expected format: apigee/[<provider>/][<version>/]<model_id>`);
    }

    // Extract the actual model ID for the parent class
    const modelId = getModelId(model);

    // Determine if we're using Vertex AI
    const isVertexai = identifyVertexai(model);

    // Get project and location for Vertex AI
    let resolvedProject = project;
    let resolvedLocation = location;

    const canReadEnv = typeof process === 'object';

    if (isVertexai) {
      if (canReadEnv && !resolvedProject) {
        resolvedProject = process.env[PROJECT_ENV_VARIABLE_NAME];
      }
      if (canReadEnv && !resolvedLocation) {
        resolvedLocation = process.env[LOCATION_ENV_VARIABLE_NAME];
      }

      if (!resolvedProject) {
        throw new Error(
          `The ${PROJECT_ENV_VARIABLE_NAME} environment variable must be set for Vertex AI mode.`,
        );
      }
      if (!resolvedLocation) {
        throw new Error(
          `The ${LOCATION_ENV_VARIABLE_NAME} environment variable must be set for Vertex AI mode.`,
        );
      }
    }

    // Call super with extracted model ID and Vertex AI settings
    // For ApigeeLlm, we always use vertexai mode to avoid API key requirement
    // since authentication is handled by Apigee proxy
    super({
      model: modelId,
      vertexai: isVertexai,
      project: isVertexai ? resolvedProject : undefined,
      location: isVertexai ? resolvedLocation : undefined,
      headers,
      useInteractionsApi,
      // Provide a dummy API key when not using Vertex AI
      // The actual authentication is handled by Apigee proxy
      apiKey: isVertexai ? undefined : 'apigee-proxy-handled',
    });

    this.isVertexai = isVertexai;
    this._project = resolvedProject;
    this._location = resolvedLocation;
    this.apiVersion = identifyApiVersion(model);
    this.customHeaders = customHeaders || {};
    this.retryOptions = retryOptions;
    this.userAgent = `google-adk/${version}`;

    // Get proxy URL from parameter or environment
    if (canReadEnv && !proxyUrl) {
      this.proxyUrl = process.env[APIGEE_PROXY_URL_ENV_VARIABLE_NAME];
    } else {
      this.proxyUrl = proxyUrl;
    }
  }

  /**
   * Merges tracking headers with custom headers.
   * Tracking headers include user-agent and x-goog-api-client.
   */
  private mergeTrackingHeaders(customHeaders: Record<string, string>): Record<string, string> {
    return {
      'user-agent': this.userAgent,
      ...this.trackingHeaders,
      ...customHeaders,
    };
  }

  /**
   * Gets the API client configured for Apigee proxy.
   * Overrides the parent's apiClient to use custom HTTP options with
   * the Apigee proxy URL and merged headers.
   */
  override get apiClient(): GoogleGenAI {
    if (this._apigeeApiClient) {
      return this._apigeeApiClient;
    }

    const httpOptionsConfig: {
      baseUrl?: string;
      headers?: Record<string, string>;
      apiVersion?: string;
      retryOptions?: HttpRetryOptions;
    } = {
      baseUrl: this.proxyUrl,
      headers: this.mergeTrackingHeaders(this.customHeaders),
    };

    if (this.apiVersion) {
      httpOptionsConfig.apiVersion = this.apiVersion;
    }

    if (this.retryOptions) {
      httpOptionsConfig.retryOptions = this.retryOptions;
    }

    const clientConfig: {
      vertexai?: boolean;
      project?: string;
      location?: string;
      apiKey?: string;
      httpOptions: typeof httpOptionsConfig;
    } = {
      httpOptions: httpOptionsConfig,
    };

    if (this.isVertexai) {
      clientConfig.vertexai = true;
      clientConfig.project = this._project;
      clientConfig.location = this._location;
    }

    logger.debug('Creating Apigee API client', {
      proxyUrl: this.proxyUrl,
      isVertexai: this.isVertexai,
      apiVersion: this.apiVersion,
    });

    this._apigeeApiClient = new GoogleGenAI(clientConfig);
    return this._apigeeApiClient;
  }

  /**
   * Preprocesses the request before sending to the model.
   * Strips the 'apigee/' prefix and extracts the model ID.
   */
  protected preprocessRequestForApigee(llmRequest: LlmRequest): void {
    // Extract the model ID from the apigee model string
    if (llmRequest.model && llmRequest.model.startsWith('apigee/')) {
      llmRequest.model = getModelId(llmRequest.model);
    }
  }
}

/**
 * Determines if the model string indicates Vertex AI usage.
 *
 * Returns true if:
 * - The model string contains 'vertex_ai' provider (e.g., 'apigee/vertex_ai/gemini-2.5-flash')
 * - The GOOGLE_GENAI_USE_VERTEXAI environment variable is set to 'true' or '1'
 *   (and the model string doesn't explicitly use 'gemini' provider)
 *
 * @param model The model string to analyze.
 * @returns True if Vertex AI should be used, false otherwise.
 */
export function identifyVertexai(model: string): boolean {
  // If model explicitly uses gemini provider, don't use Vertex AI
  if (model.startsWith('apigee/gemini/')) {
    return false;
  }

  // If model explicitly uses vertex_ai provider, use Vertex AI
  if (model.startsWith('apigee/vertex_ai/')) {
    return true;
  }

  // Check environment variable
  const canReadEnv = typeof process === 'object';
  if (canReadEnv) {
    const envValue = process.env[GOOGLE_GENAI_USE_VERTEXAI_ENV_VARIABLE_NAME];
    if (envValue) {
      return envValue.toLowerCase() === 'true' || envValue === '1';
    }
  }

  return false;
}

/**
 * Extracts the API version from the model string.
 *
 * Supported formats:
 * - `apigee/<model_id>` → '' (empty, use default)
 * - `apigee/<version>/<model_id>` → '<version>'
 * - `apigee/<provider>/<model_id>` → '' (empty, use default)
 * - `apigee/<provider>/<version>/<model_id>` → '<version>'
 *
 * @param model The model string to parse.
 * @returns The API version or empty string if not specified.
 */
export function identifyApiVersion(model: string): string {
  const withoutPrefix = model.replace(/^apigee\//, '');
  const components = withoutPrefix.split('/');

  if (components.length === 3) {
    // Format: <provider>/<version>/<model_id>
    return components[1];
  }

  if (components.length === 2) {
    // Format: <version>/<model_id> or <provider>/<model_id>
    // If the first component is not a provider and starts with 'v', it's a version
    if (components[0] !== 'vertex_ai' && components[0] !== 'gemini' && components[0].startsWith('v')) {
      return components[0];
    }
  }

  return '';
}

/**
 * Extracts the model ID from the model string.
 *
 * The model ID is always the last component of the model string.
 *
 * @param model The model string to parse.
 * @returns The model ID (e.g., 'gemini-2.5-flash').
 */
export function getModelId(model: string): string {
  const withoutPrefix = model.replace(/^apigee\//, '');
  const components = withoutPrefix.split('/');

  // Model ID is the last component
  return components[components.length - 1];
}

/**
 * Validates the model string format for ApigeeLlm.
 *
 * Valid formats:
 * - `apigee/<model_id>`
 * - `apigee/<version>/<model_id>`
 * - `apigee/<provider>/<model_id>`
 * - `apigee/<provider>/<version>/<model_id>`
 *
 * Where:
 * - `provider` is either 'vertex_ai' or 'gemini'
 * - `version` starts with 'v' (e.g., 'v1', 'v1beta')
 * - `model_id` is the actual model name (e.g., 'gemini-2.5-flash')
 *
 * @param model The model string to validate.
 * @returns True if the model string is valid, false otherwise.
 */
export function validateModelString(model: string): boolean {
  // Must start with 'apigee/'
  if (!model.startsWith('apigee/')) {
    return false;
  }

  // Remove leading 'apigee/' from the model string
  const withoutPrefix = model.replace(/^apigee\//, '');

  // The string must be non-empty (model_id cannot be empty)
  if (!withoutPrefix) {
    return false;
  }

  const components = withoutPrefix.split('/');

  // If the model string has exactly 1 component, only model_id is present
  if (components.length === 1) {
    return true;
  }

  // If the model string has more than 3 components, it's invalid
  if (components.length > 3) {
    return false;
  }

  // If the model string has 3 components: <provider>/<version>/<model_id>
  if (components.length === 3) {
    // First component must be a valid provider
    if (components[0] !== 'vertex_ai' && components[0] !== 'gemini') {
      return false;
    }
    // Second component must be a version (starts with 'v')
    if (!components[1].startsWith('v')) {
      return false;
    }
    return true;
  }

  // If the model string has 2 components: <provider>/<model_id> or <version>/<model_id>
  if (components.length === 2) {
    // First component is either a provider or a version
    if (components[0] === 'vertex_ai' || components[0] === 'gemini') {
      return true;
    }
    if (components[0].startsWith('v')) {
      return true;
    }
    return false;
  }

  return false;
}
