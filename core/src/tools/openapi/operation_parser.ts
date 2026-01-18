/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {OpenAPIV3} from 'openapi-types';

import {ApiParameter, createApiParameter, toSnakeCase} from './common.js';

/**
 * Parses OpenAPI operations to extract parameters, return types,
 * and generate function declarations.
 */
export class OperationParser {
  private readonly operation: OpenAPIV3.OperationObject;
  private params: ApiParameter[] = [];
  private returnValue: ApiParameter | undefined;

  constructor(
    operation: OpenAPIV3.OperationObject,
    shouldParse: boolean = true
  ) {
    this.operation = operation;

    if (shouldParse) {
      this.processOperationParameters();
      this.processRequestBody();
      this.processReturnValue();
      this.dedupeParamNames();
    }
  }

  /**
   * Creates an OperationParser with pre-loaded parameters.
   */
  static load(
    operation: OpenAPIV3.OperationObject,
    params: ApiParameter[],
    returnValue?: ApiParameter
  ): OperationParser {
    const parser = new OperationParser(operation, false);
    parser.params = params;
    parser.returnValue = returnValue;
    return parser;
  }

  /**
   * Processes parameters from the OpenAPI operation.
   */
  private processOperationParameters(): void {
    const parameters = (this.operation.parameters || []) as OpenAPIV3.ParameterObject[];

    for (const param of parameters) {
      const originalName = param.name;
      const description = param.description || '';
      const location = param.in || '';
      const schema = (param.schema as OpenAPIV3.SchemaObject) || {};

      // Add description from param if schema doesn't have one
      if (!schema.description && description) {
        schema.description = description;
      }

      const required = param.required ?? false;

      this.params.push(
        createApiParameter({
          originalName,
          paramLocation: location,
          paramSchema: schema,
          description,
          required,
        })
      );
    }
  }

  /**
   * Processes the request body from the OpenAPI operation.
   */
  private processRequestBody(): void {
    const requestBody = this.operation.requestBody as
      | OpenAPIV3.RequestBodyObject
      | undefined;

    if (!requestBody) return;

    const content = requestBody.content || {};
    if (Object.keys(content).length === 0) return;

    // Process first mime type only
    for (const [, mediaTypeObject] of Object.entries(content)) {
      const schema = (mediaTypeObject.schema as OpenAPIV3.SchemaObject) || {};
      const description = requestBody.description || '';

      if (schema.type === 'object' && schema.properties) {
        // Expand object properties as individual parameters
        for (const [propName, propDetails] of Object.entries(
          schema.properties
        )) {
          const propSchema = propDetails as OpenAPIV3.SchemaObject;
          this.params.push(
            createApiParameter({
              originalName: propName,
              paramLocation: 'body',
              paramSchema: propSchema,
              description: propSchema.description,
              required: (schema.required || []).includes(propName),
            })
          );
        }
      } else if (schema.type === 'array') {
        this.params.push(
          createApiParameter({
            originalName: 'array',
            paramLocation: 'body',
            paramSchema: schema,
            description,
          })
        );
      } else {
        // Handle scalar types, oneOf, anyOf, allOf
        let paramName = '';
        if (schema.oneOf || schema.anyOf || schema.allOf) {
          paramName = 'body';
        } else if (!schema.type) {
          paramName = 'body';
        }

        this.params.push(
          createApiParameter({
            originalName: paramName,
            paramLocation: 'body',
            paramSchema: schema,
            description,
          })
        );
      }
      break; // Process first mime type only
    }
  }

  /**
   * Deduplicates parameter names to avoid conflicts.
   */
  private dedupeParamNames(): void {
    const paramsCnt: Record<string, number> = {};

    for (const param of this.params) {
      const name = param.tsName;
      if (!(name in paramsCnt)) {
        paramsCnt[name] = 0;
      } else {
        paramsCnt[name] += 1;
        param.tsName = `${name}_${paramsCnt[name] - 1}`;
      }
    }
  }

  /**
   * Processes the return value from the OpenAPI operation.
   */
  private processReturnValue(): void {
    const responses = this.operation.responses || {};

    // Default to empty schema
    let returnSchema: OpenAPIV3.SchemaObject = {};

    // Find the 2xx response with smallest status code
    const validCodes = Object.keys(responses).filter((k) => k.startsWith('2'));
    const min20xCode = validCodes.length > 0 ? validCodes.sort()[0] : undefined;

    if (min20xCode) {
      const response = responses[min20xCode] as OpenAPIV3.ResponseObject;
      const content = response.content;

      if (content) {
        for (const [, mediaType] of Object.entries(content)) {
          if (mediaType.schema) {
            returnSchema = mediaType.schema as OpenAPIV3.SchemaObject;
            break;
          }
        }
      }
    }

    this.returnValue = createApiParameter({
      originalName: '',
      paramLocation: '',
      paramSchema: returnSchema,
    });
  }

  /**
   * Returns the generated function name.
   */
  getFunctionName(): string {
    const operationId = this.operation.operationId;
    if (!operationId) {
      throw new Error('Operation ID is missing');
    }
    return toSnakeCase(operationId).substring(0, 60);
  }

  /**
   * Returns the list of parameters.
   */
  getParameters(): ApiParameter[] {
    return this.params;
  }

  /**
   * Returns the return value parameter.
   */
  getReturnValue(): ApiParameter {
    return (
      this.returnValue ||
      createApiParameter({
        originalName: '',
        paramLocation: '',
        paramSchema: {},
      })
    );
  }

  /**
   * Returns the name of the auth scheme for this operation.
   */
  getAuthSchemeName(): string {
    if (this.operation.security && this.operation.security.length > 0) {
      const schemeNames = Object.keys(this.operation.security[0]);
      return schemeNames.length > 0 ? schemeNames[0] : '';
    }
    return '';
  }

  /**
   * Returns the JSON schema for the function arguments.
   */
  getJsonSchema(): Record<string, unknown> {
    const properties: Record<string, unknown> = {};

    for (const p of this.params) {
      properties[p.tsName] = p.paramSchema;
    }

    return {
      type: 'object',
      properties,
      required: this.params.filter((p) => p.required).map((p) => p.tsName),
      title: `${this.operation.operationId || 'unnamed'}_Arguments`,
    };
  }
}
