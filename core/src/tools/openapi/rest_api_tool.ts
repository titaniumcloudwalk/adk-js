/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration, Schema, Type} from '@google/genai';
import {OpenAPIV3} from 'openapi-types';

import {ReadonlyContext} from '../../agents/readonly_context.js';
import {AuthCredential} from '../../auth/auth_credential.js';
import {AuthScheme} from '../../auth/auth_schemes.js';
import {BaseTool, RunAsyncToolRequest} from '../base_tool.js';
import {ToolContext} from '../tool_context.js';

import {credentialToParam, dictToAuthScheme} from './auth_helpers.js';
import {
  ApiParameter,
  OperationEndpoint,
  snakeToLowerCamel,
  toSnakeCase,
} from './common.js';
import {ParsedOperation} from './openapi_spec_parser.js';
import {OperationParser} from './operation_parser.js';
import {ToolAuthHandler} from './tool_auth_handler.js';

/**
 * Parameters for creating a RestApiTool.
 */
export interface RestApiToolParams {
  name: string;
  description: string;
  endpoint: OperationEndpoint;
  operation: OpenAPIV3.OperationObject;
  authScheme?: AuthScheme;
  authCredential?: AuthCredential;
  sslVerify?: boolean;
  headerProvider?: (context: ReadonlyContext) => Record<string, string>;
}

/**
 * A generic tool that interacts with a REST API.
 *
 * - Generates request params and body
 * - Attaches auth credentials to API call
 *
 * @example
 * ```typescript
 * // Each API operation in the spec will be turned into its own tool
 * const operations = new OpenApiSpecParser().parse(openapiSpec);
 * const tools = operations.map(o => RestApiTool.fromParsedOperation(o));
 * ```
 */
export class RestApiTool extends BaseTool {
  readonly endpoint: OperationEndpoint;
  readonly operation: OpenAPIV3.OperationObject;
  authScheme?: AuthScheme;
  authCredential?: AuthCredential;

  private operationParser: OperationParser;
  private defaultHeaders: Record<string, string> = {};
  private sslVerify?: boolean;
  private headerProvider?: (context: ReadonlyContext) => Record<string, string>;

  constructor(params: RestApiToolParams) {
    // Gemini restricts function name to 64 characters
    super({
      name: params.name.substring(0, 60),
      description: params.description,
    });

    this.endpoint = params.endpoint;
    this.operation = params.operation;
    this.sslVerify = params.sslVerify;
    this.headerProvider = params.headerProvider;

    this.configureAuthCredential(params.authCredential);
    this.configureAuthScheme(params.authScheme);

    this.operationParser = new OperationParser(this.operation);
  }

  /**
   * Creates a RestApiTool from a ParsedOperation object.
   */
  static fromParsedOperation(
    parsed: ParsedOperation,
    options?: {
      sslVerify?: boolean;
      headerProvider?: (context: ReadonlyContext) => Record<string, string>;
    }
  ): RestApiTool {
    const operationParser = OperationParser.load(
      parsed.operation,
      parsed.parameters,
      parsed.returnValue
    );

    const toolName = toSnakeCase(operationParser.getFunctionName());

    const tool = new RestApiTool({
      name: toolName,
      description:
        parsed.operation.description || parsed.operation.summary || '',
      endpoint: parsed.endpoint,
      operation: parsed.operation,
      authScheme: parsed.authScheme,
      authCredential: parsed.authCredential,
      sslVerify: options?.sslVerify,
      headerProvider: options?.headerProvider,
    });

    // Set the pre-parsed operation parser
    tool.operationParser = operationParser;

    return tool;
  }

  /**
   * Returns the function declaration in the Gemini Schema format.
   */
  override _getDeclaration(): FunctionDeclaration {
    const schemaDict = this.operationParser.getJsonSchema();
    return {
      name: this.name,
      description: this.description,
      parameters: convertJsonSchemaToGeminiSchema(schemaDict),
    };
  }

  /**
   * Configures the authentication scheme for the API call.
   */
  configureAuthScheme(
    authScheme?: AuthScheme | Record<string, unknown>
  ): void {
    if (authScheme && typeof authScheme === 'object' && !('type' in authScheme)) {
      this.authScheme = dictToAuthScheme(authScheme as Record<string, unknown>);
    } else {
      this.authScheme = authScheme as AuthScheme | undefined;
    }
  }

  /**
   * Configures the authentication credential for the API call.
   */
  configureAuthCredential(authCredential?: AuthCredential): void {
    this.authCredential = authCredential;
  }

  /**
   * Sets default headers that are merged into every request.
   */
  setDefaultHeaders(headers: Record<string, string>): void {
    this.defaultHeaders = headers;
  }

  /**
   * Prepares the request parameters for the API call.
   */
  private prepareRequestParams(
    parameters: ApiParameter[],
    kwargs: Record<string, unknown>
  ): RequestInit & {url: string} {
    const method = this.endpoint.method.toUpperCase();
    if (!method) {
      throw new Error('Operation method not found.');
    }

    const pathParams: Record<string, string> = {};
    const queryParams: Record<string, string> = {};
    const headerParams: Record<string, string> = {};
    const cookieParams: Record<string, string> = {};

    // Set User-Agent header
    headerParams['User-Agent'] = `google-adk (tool: ${this.name})`;

    // Create a map of parameter names to ApiParameter objects
    const paramsMap = new Map<string, ApiParameter>();
    for (const p of parameters) {
      paramsMap.set(p.tsName, p);
    }

    // Fill in path, query, header, and cookie parameters
    for (const [paramK, v] of Object.entries(kwargs)) {
      const paramObj = paramsMap.get(paramK);
      if (!paramObj) continue;

      const originalK = paramObj.originalName;
      const paramLocation = paramObj.paramLocation;

      if (paramLocation === 'path') {
        pathParams[originalK] = String(v);
      } else if (paramLocation === 'query') {
        if (v != null) {
          queryParams[originalK] = String(v);
        }
      } else if (paramLocation === 'header') {
        headerParams[originalK] = String(v);
      } else if (paramLocation === 'cookie') {
        cookieParams[originalK] = String(v);
      }
    }

    // Construct URL with path parameters
    let baseUrl = this.endpoint.baseUrl || '';
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }

    let path = this.endpoint.path;
    for (const [key, value] of Object.entries(pathParams)) {
      path = path.replace(`{${key}}`, encodeURIComponent(value));
    }

    let url = `${baseUrl}${path}`;

    // Add query parameters
    const queryString = Object.entries(queryParams)
      .filter(([, v]) => v != null)
      .map(
        ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`
      )
      .join('&');

    if (queryString) {
      url += `?${queryString}`;
    }

    // Construct body
    let body: string | FormData | undefined;
    const requestBody = this.operation.requestBody as
      | OpenAPIV3.RequestBodyObject
      | undefined;

    if (requestBody?.content) {
      for (const [mimeType, mediaTypeObject] of Object.entries(
        requestBody.content
      )) {
        const schema = mediaTypeObject.schema as
          | OpenAPIV3.SchemaObject
          | undefined;
        let bodyData: unknown;

        if (schema?.type === 'object') {
          bodyData = {};
          for (const param of parameters) {
            if (param.paramLocation === 'body' && param.tsName in kwargs) {
              (bodyData as Record<string, unknown>)[param.originalName] =
                kwargs[param.tsName];
            }
          }
        } else if (schema?.type === 'array') {
          for (const param of parameters) {
            if (param.paramLocation === 'body' && param.tsName === 'array') {
              bodyData = kwargs['array'];
              break;
            }
          }
        } else {
          // Scalar type or unknown
          for (const param of parameters) {
            if (param.paramLocation === 'body' && !param.originalName) {
              bodyData = kwargs[param.tsName];
              break;
            }
          }
        }

        if (mimeType === 'application/json' || mimeType.endsWith('+json')) {
          if (bodyData !== undefined) {
            body = JSON.stringify(bodyData);
            headerParams['Content-Type'] = mimeType;
          }
        } else if (mimeType === 'application/x-www-form-urlencoded') {
          if (bodyData && typeof bodyData === 'object') {
            body = new URLSearchParams(
              bodyData as Record<string, string>
            ).toString();
            headerParams['Content-Type'] = mimeType;
          }
        } else if (mimeType === 'text/plain') {
          if (bodyData !== undefined) {
            body = String(bodyData);
            headerParams['Content-Type'] = mimeType;
          }
        }

        break; // Process only the first mime type
      }
    }

    // Add default headers
    for (const [key, value] of Object.entries(this.defaultHeaders)) {
      if (!(key in headerParams)) {
        headerParams[key] = value;
      }
    }

    // Add cookies to headers
    if (Object.keys(cookieParams).length > 0) {
      const cookieString = Object.entries(cookieParams)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      headerParams['Cookie'] = cookieString;
    }

    return {
      url,
      method,
      headers: headerParams,
      body,
    };
  }

  /**
   * Executes the REST API call.
   */
  override async runAsync({
    args,
    toolContext,
  }: RunAsyncToolRequest): Promise<unknown> {
    return this.call({args, toolContext});
  }

  /**
   * Executes the REST API call.
   */
  async call(params: {
    args: Record<string, unknown>;
    toolContext: ToolContext;
  }): Promise<Record<string, unknown>> {
    const {args, toolContext} = params;

    // Prepare auth credentials for the API call
    const toolAuthHandler = ToolAuthHandler.fromToolContext(
      toolContext,
      this.authScheme,
      this.authCredential
    );

    const authResult = await toolAuthHandler.prepareAuthCredentials();
    const {state: authState, authScheme, authCredential} = authResult;

    if (authState === 'pending') {
      return {
        pending: true,
        message: 'Needs your authorization to access your data.',
      };
    }

    // Get parameters and add defaults for required params
    const apiParams = [...this.operationParser.getParameters()];
    const apiArgs = {...args};

    for (const apiParam of apiParams) {
      if (!(apiParam.tsName in apiArgs)) {
        const schema = apiParam.paramSchema as OpenAPIV3.SchemaObject;
        if (apiParam.required && schema.default !== undefined) {
          apiArgs[apiParam.tsName] = schema.default;
        }
      }
    }

    // Add auth parameters if credential is available
    if (authCredential && authScheme) {
      const authResult = credentialToParam(authScheme, authCredential);
      if (authResult) {
        const [authParam, authArgs] = authResult;
        apiParams.unshift(authParam);
        Object.assign(apiArgs, authArgs);
      }
    }

    // Prepare request
    const requestParams = this.prepareRequestParams(apiParams, apiArgs);

    // Add headers from headerProvider if configured
    if (this.headerProvider && toolContext) {
      const providerHeaders = this.headerProvider(toolContext);
      if (providerHeaders) {
        Object.assign(requestParams.headers as Record<string, string>, providerHeaders);
      }
    }

    // Execute the request
    try {
      const response = await fetch(requestParams.url, {
        method: requestParams.method,
        headers: requestParams.headers,
        body: requestParams.body,
      });

      if (!response.ok) {
        const errorDetails = await response.text();
        return {
          error:
            `Tool ${this.name} execution failed. Analyze this execution error ` +
            `and your inputs. Retry with adjustments if applicable. But make sure ` +
            `don't retry more than 3 times. Execution Error: Status Code: ` +
            `${response.status}, ${errorDetails}`,
        };
      }

      // Try to parse as JSON first
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        return await response.json();
      }

      // Return as text
      const text = await response.text();
      return {text};
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        error:
          `Tool ${this.name} execution failed. Network error: ${errorMessage}`,
      };
    }
  }

  toString(): string {
    return `RestApiTool(name="${this.name}", description="${this.description}", endpoint="${JSON.stringify(this.endpoint)}")`;
  }
}

/**
 * Converts a JSON Schema object to Gemini Schema format.
 */
function convertJsonSchemaToGeminiSchema(
  jsonSchema: Record<string, unknown>
): Schema {
  const properties: Record<string, Schema> = {};

  if (jsonSchema.properties && typeof jsonSchema.properties === 'object') {
    for (const [key, value] of Object.entries(
      jsonSchema.properties as Record<string, unknown>
    )) {
      properties[key] = convertPropertyToSchema(
        value as Record<string, unknown>
      );
    }
  }

  return {
    type: Type.OBJECT,
    properties,
    required: (jsonSchema.required as string[]) || [],
  };
}

function convertPropertyToSchema(prop: Record<string, unknown>): Schema {
  const type = prop.type as string | undefined;
  const description = prop.description as string | undefined;

  switch (type) {
    case 'string':
      return {type: Type.STRING, description};
    case 'integer':
      return {type: Type.INTEGER, description};
    case 'number':
      return {type: Type.NUMBER, description};
    case 'boolean':
      return {type: Type.BOOLEAN, description};
    case 'array': {
      const items = prop.items as Record<string, unknown> | undefined;
      return {
        type: Type.ARRAY,
        items: items ? convertPropertyToSchema(items) : {type: Type.STRING},
        description,
      };
    }
    case 'object': {
      const objProps: Record<string, Schema> = {};
      if (prop.properties && typeof prop.properties === 'object') {
        for (const [k, v] of Object.entries(
          prop.properties as Record<string, unknown>
        )) {
          objProps[k] = convertPropertyToSchema(v as Record<string, unknown>);
        }
      }
      return {
        type: Type.OBJECT,
        properties: objProps,
        required: (prop.required as string[]) || [],
        description,
      };
    }
    default:
      return {type: Type.STRING, description};
  }
}
