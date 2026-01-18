/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {OpenAPIV3} from 'openapi-types';

import {AuthCredential} from '../../auth/auth_credential.js';
import {AuthScheme} from '../../auth/auth_schemes.js';

import {
  ApiParameter,
  createApiParameter,
  OperationEndpoint,
  toSnakeCase,
  VALID_SCHEMA_TYPES,
} from './common.js';
import {OperationParser} from './operation_parser.js';

const SCHEMA_CONTAINER_KEYS = new Set(['schema', 'schemas']);

/**
 * A parsed OpenAPI operation ready to be converted to a RestApiTool.
 */
export interface ParsedOperation {
  name: string;
  description: string;
  endpoint: OperationEndpoint;
  operation: OpenAPIV3.OperationObject;
  parameters: ApiParameter[];
  returnValue: ApiParameter;
  authScheme?: AuthScheme;
  authCredential?: AuthCredential;
  additionalContext?: unknown;
}

/**
 * Parses OpenAPI specifications into ParsedOperation objects.
 *
 * This class takes an OpenAPI spec and extracts all operations,
 * resolving references, sanitizing types, and preparing them
 * for conversion to RestApiTool instances.
 */
export class OpenApiSpecParser {
  /**
   * Extracts an OpenAPI spec dict into a list of ParsedOperation objects.
   */
  parse(openapiSpec: OpenAPIV3.Document): ParsedOperation[] {
    // Work on a deep copy to avoid mutating the original
    const spec = JSON.parse(JSON.stringify(openapiSpec)) as OpenAPIV3.Document;

    // Resolve all $ref references
    const resolvedSpec = this.resolveReferences(spec);

    // Sanitize schema types (remove invalid types like 'Any')
    const sanitizedSpec = this.sanitizeSchemaTypes(resolvedSpec);

    // Collect and parse operations
    return this.collectOperations(sanitizedSpec);
  }

  /**
   * Recursively sanitizes schema types in an OpenAPI specification.
   * Removes or converts invalid schema types to ensure compatibility.
   */
  private sanitizeSchemaTypes(
    openapiSpec: OpenAPIV3.Document
  ): OpenAPIV3.Document {
    const sanitizeTypeField = (schemaDict: Record<string, unknown>): void => {
      if (!('type' in schemaDict)) {
        return;
      }

      const typeValue = schemaDict['type'];

      if (typeof typeValue === 'string') {
        const normalizedType = typeValue.toLowerCase();
        if (VALID_SCHEMA_TYPES.has(normalizedType)) {
          schemaDict['type'] = normalizedType;
          return;
        }
        delete schemaDict['type'];
        return;
      }

      if (Array.isArray(typeValue)) {
        const validTypes: string[] = [];
        for (const entry of typeValue) {
          if (typeof entry !== 'string') continue;
          const normalizedEntry = entry.toLowerCase();
          if (!VALID_SCHEMA_TYPES.has(normalizedEntry)) continue;
          if (!validTypes.includes(normalizedEntry)) {
            validTypes.push(normalizedEntry);
          }
        }
        if (validTypes.length > 0) {
          schemaDict['type'] = validTypes;
        } else {
          delete schemaDict['type'];
        }
      }
    };

    const sanitizeRecursive = (obj: unknown, inSchema: boolean): unknown => {
      if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
        const dict = obj as Record<string, unknown>;

        if (inSchema) {
          sanitizeTypeField(dict);
        }

        for (const [key, value] of Object.entries(dict)) {
          dict[key] = sanitizeRecursive(
            value,
            inSchema || SCHEMA_CONTAINER_KEYS.has(key)
          );
        }
        return dict;
      }

      if (Array.isArray(obj)) {
        return obj.map((item) => sanitizeRecursive(item, inSchema));
      }

      return obj;
    };

    return sanitizeRecursive(openapiSpec, false) as OpenAPIV3.Document;
  }

  /**
   * Collects operations from an OpenAPI spec.
   */
  private collectOperations(openapiSpec: OpenAPIV3.Document): ParsedOperation[] {
    const operations: ParsedOperation[] = [];

    // Get base URL from servers, default to empty string
    let baseUrl = '';
    if (openapiSpec.servers && openapiSpec.servers.length > 0) {
      baseUrl = openapiSpec.servers[0].url || '';
    }

    // Get global security scheme name
    let globalSchemeName: string | undefined;
    if (openapiSpec.security && openapiSpec.security.length > 0) {
      const schemeNames = Object.keys(openapiSpec.security[0]);
      globalSchemeName = schemeNames.length > 0 ? schemeNames[0] : undefined;
    }

    // Get security schemes from components
    const authSchemes =
      (openapiSpec.components?.securitySchemes as Record<string, OpenAPIV3.SecuritySchemeObject>) || {};

    // Process all paths
    const paths = openapiSpec.paths || {};
    for (const [path, pathItem] of Object.entries(paths)) {
      if (!pathItem) continue;

      const methods = [
        'get',
        'post',
        'put',
        'delete',
        'patch',
        'head',
        'options',
        'trace',
      ] as const;

      for (const method of methods) {
        const operationObj = pathItem[method];
        if (!operationObj) continue;

        // Merge path-level and operation-level parameters
        const pathParams = (pathItem.parameters || []) as OpenAPIV3.ParameterObject[];
        const opParams = (operationObj.parameters || []) as OpenAPIV3.ParameterObject[];
        operationObj.parameters = [...opParams, ...pathParams];

        // Generate operationId if missing
        if (!operationObj.operationId) {
          operationObj.operationId = toSnakeCase(`${path}_${method}`);
        }

        const endpoint: OperationEndpoint = {
          baseUrl,
          path,
          method,
        };

        const operationParser = new OperationParser(operationObj);

        // Get auth scheme (operation-level or global)
        const authSchemeName = operationParser.getAuthSchemeName() || globalSchemeName;
        const authScheme = authSchemeName ? authSchemes[authSchemeName] : undefined;

        const parsedOp: ParsedOperation = {
          name: operationParser.getFunctionName(),
          description: operationObj.description || operationObj.summary || '',
          endpoint,
          operation: operationObj,
          parameters: operationParser.getParameters(),
          returnValue: operationParser.getReturnValue(),
          authScheme: authScheme as AuthScheme | undefined,
          authCredential: undefined,
          additionalContext: {},
        };

        operations.push(parsedOp);
      }
    }

    return operations;
  }

  /**
   * Recursively resolves all $ref references in an OpenAPI specification.
   * Handles circular references correctly.
   */
  private resolveReferences(openapiSpec: OpenAPIV3.Document): OpenAPIV3.Document {
    const resolvedCache: Record<string, unknown> = {};

    const resolveRef = (
      refString: string,
      currentDoc: Record<string, unknown>
    ): unknown => {
      const parts = refString.split('/');
      if (parts[0] !== '#') {
        throw new Error(`External references not supported: ${refString}`);
      }

      let current: unknown = currentDoc;
      for (const part of parts.slice(1)) {
        if (
          typeof current === 'object' &&
          current !== null &&
          part in (current as Record<string, unknown>)
        ) {
          current = (current as Record<string, unknown>)[part];
        } else {
          return undefined;
        }
      }
      return current;
    };

    const recursiveResolve = (
      obj: unknown,
      currentDoc: Record<string, unknown>,
      seenRefs: Set<string> = new Set()
    ): unknown => {
      if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
        const dict = obj as Record<string, unknown>;

        if ('$ref' in dict && typeof dict['$ref'] === 'string') {
          const refString = dict['$ref'];

          // Check for circular reference
          if (seenRefs.has(refString) && !(refString in resolvedCache)) {
            // Break the cycle by returning a copy without $ref
            const result: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(dict)) {
              if (k !== '$ref') {
                result[k] = v;
              }
            }
            return result;
          }

          seenRefs.add(refString);

          // Check cache
          if (refString in resolvedCache) {
            return JSON.parse(JSON.stringify(resolvedCache[refString]));
          }

          const resolvedValue = resolveRef(refString, currentDoc);
          if (resolvedValue !== undefined) {
            const resolved = recursiveResolve(
              resolvedValue,
              currentDoc,
              seenRefs
            );
            resolvedCache[refString] = resolved;
            return JSON.parse(JSON.stringify(resolved));
          }
          return obj;
        }

        const newDict: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(dict)) {
          newDict[key] = recursiveResolve(value, currentDoc, seenRefs);
        }
        return newDict;
      }

      if (Array.isArray(obj)) {
        return obj.map((item) =>
          recursiveResolve(item, currentDoc, seenRefs)
        );
      }

      return obj;
    };

    return recursiveResolve(
      openapiSpec,
      openapiSpec as unknown as Record<string, unknown>
    ) as OpenAPIV3.Document;
  }
}
