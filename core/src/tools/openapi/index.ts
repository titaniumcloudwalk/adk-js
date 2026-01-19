/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Common types and utilities
export type {
  ApiParameter,
  OperationEndpoint,
} from './common.js';
export {
  createApiParameter,
  getTypeHint,
  renameReservedKeywords,
  snakeToLowerCamel,
  toSnakeCase,
  VALID_SCHEMA_TYPES,
} from './common.js';

// Auth helpers
export {
  credentialToParam,
  dictToAuthScheme,
  externalExchangeRequired,
  getSchemeType,
  tokenToSchemeCredential,
} from './auth_helpers.js';

// OpenAPI spec parsing
export {OpenApiSpecParser} from './openapi_spec_parser.js';
export type {ParsedOperation} from './openapi_spec_parser.js';

// Operation parsing
export {OperationParser} from './operation_parser.js';

// Tool auth handler
export type {
  AuthPreparationResult,
  AuthPreparationState,
} from './tool_auth_handler.js';
export {
  ToolAuthHandler,
  ToolContextCredentialStore,
} from './tool_auth_handler.js';

// REST API tool
export {RestApiTool} from './rest_api_tool.js';
export type {RestApiToolParams} from './rest_api_tool.js';

// OpenAPI toolset
export {OpenAPIToolset} from './openapi_toolset.js';
export type {OpenAPIToolsetParams} from './openapi_toolset.js';
