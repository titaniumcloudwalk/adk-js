/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {OpenAPIV3} from 'openapi-types';

/**
 * Reserved TypeScript/JavaScript keywords that need to be renamed.
 */
const RESERVED_KEYWORDS = new Set([
  'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof', 'new',
  'return', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'class', 'const', 'enum', 'export', 'extends', 'import', 'super',
  'implements', 'interface', 'let', 'package', 'private', 'protected', 'public',
  'static', 'yield', 'async', 'await',
]);

/**
 * Renames reserved keywords by adding a prefix.
 */
export function renameReservedKeywords(
  s: string,
  prefix: string = 'param_'
): string {
  if (RESERVED_KEYWORDS.has(s)) {
    return prefix + s;
  }
  return s;
}

/**
 * Converts a string to snake_case.
 */
export function toSnakeCase(str: string): string {
  if (!str) return str;

  // Handle camelCase and PascalCase
  let result = str.replace(/([a-z])([A-Z])/g, '$1_$2');

  // Handle sequences of uppercase letters followed by lowercase
  result = result.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');

  // Replace non-alphanumeric characters with underscores
  result = result.replace(/[^a-zA-Z0-9]+/g, '_');

  // Convert to lowercase
  result = result.toLowerCase();

  // Remove leading/trailing underscores
  result = result.replace(/^_+|_+$/g, '');

  // Collapse multiple underscores
  result = result.replace(/_+/g, '_');

  return result;
}

/**
 * Converts snake_case to lowerCamelCase.
 */
export function snakeToLowerCamel(snakeCaseString: string): string {
  if (!snakeCaseString.includes('_')) {
    return snakeCaseString;
  }

  return snakeCaseString
    .split('_')
    .map((s, i) => (i === 0 ? s.toLowerCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()))
    .join('');
}

/**
 * Parameter location in the API request.
 */
export type ParamLocation = 'path' | 'query' | 'header' | 'cookie' | 'body';

/**
 * Data class representing an API parameter.
 */
export interface ApiParameter {
  /** Original parameter name from the spec */
  originalName: string;
  /** Location of the parameter */
  paramLocation: ParamLocation | string;
  /** JSON Schema for the parameter */
  paramSchema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
  /** Parameter description */
  description?: string;
  /** TypeScript-safe parameter name */
  tsName: string;
  /** Whether the parameter is required */
  required: boolean;
}

/**
 * Creates an ApiParameter with auto-generated tsName.
 */
export function createApiParameter(params: {
  originalName: string;
  paramLocation: ParamLocation | string;
  paramSchema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
  description?: string;
  required?: boolean;
}): ApiParameter {
  const tsName = renameReservedKeywords(toSnakeCase(params.originalName)) ||
    getDefaultParamName(params.paramLocation);

  return {
    originalName: params.originalName,
    paramLocation: params.paramLocation,
    paramSchema: params.paramSchema,
    description: params.description || getSchemaDescription(params.paramSchema) || '',
    tsName,
    required: params.required ?? false,
  };
}

function getDefaultParamName(location: string): string {
  const defaults: Record<string, string> = {
    body: 'body',
    query: 'query_param',
    path: 'path_param',
    header: 'header_param',
    cookie: 'cookie_param',
  };
  return defaults[location] || 'value';
}

function getSchemaDescription(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject
): string | undefined {
  if ('$ref' in schema) {
    return undefined;
  }
  return schema.description;
}

/**
 * Endpoint information for an API operation.
 */
export interface OperationEndpoint {
  baseUrl: string;
  path: string;
  method: string;
}

/**
 * Valid JSON Schema types as per OpenAPI 3.0/3.1 specification.
 */
export const VALID_SCHEMA_TYPES = new Set([
  'array',
  'boolean',
  'integer',
  'null',
  'number',
  'object',
  'string',
]);

/**
 * Gets the TypeScript type hint string for a schema.
 */
export function getTypeHint(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject
): string {
  if ('$ref' in schema) {
    return 'unknown';
  }

  const paramType = schema.type || 'unknown';

  switch (paramType) {
    case 'integer':
      return 'number';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'string':
      return 'string';
    case 'array': {
      const arraySchema = schema as OpenAPIV3.ArraySchemaObject;
      if (arraySchema.items && !('$ref' in arraySchema.items)) {
        const itemType = getTypeHint(arraySchema.items);
        return `${itemType}[]`;
      }
      return 'unknown[]';
    }
    case 'object':
      return 'Record<string, unknown>';
    default:
      return 'unknown';
  }
}
