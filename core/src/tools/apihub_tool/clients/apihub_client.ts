/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Base interface for API Hub clients.
 */
export interface BaseAPIHubClient {
  /**
   * From a given resource name, get the spec in the API Hub.
   *
   * @param resourceName The resource name or URL of the API.
   * @returns The OpenAPI spec content as a string.
   */
  getSpecContent(resourceName: string): Promise<string>;
}

/**
 * Options for creating an APIHubClient.
 */
export interface APIHubClientOptions {
  /**
   * Google Access token. Generate with gcloud cli `gcloud auth print-access-token`.
   * Useful for local testing.
   */
  accessToken?: string;

  /**
   * The service account configuration as a JSON string.
   * Required if not using default service credential.
   */
  serviceAccountJson?: string;
}

/**
 * Resource names extracted from a path or URL.
 */
interface ExtractedResourceNames {
  apiResourceName: string;
  apiVersionResourceName: string | null;
  apiSpecResourceName: string | null;
}

/**
 * Client for interacting with the Google Cloud API Hub service.
 *
 * @example
 * ```typescript
 * // Using access token
 * const client = new APIHubClient({
 *   accessToken: 'your-access-token',
 * });
 *
 * // Using service account
 * const client = new APIHubClient({
 *   serviceAccountJson: JSON.stringify(serviceAccountConfig),
 * });
 *
 * // Get spec content
 * const spec = await client.getSpecContent(
 *   'projects/my-project/locations/us-central1/apis/my-api'
 * );
 * ```
 */
export class APIHubClient implements BaseAPIHubClient {
  private readonly rootUrl = 'https://apihub.googleapis.com/v1';
  private readonly accessToken?: string;
  private readonly serviceAccountJson?: string;
  private cachedCredential?: {token: string; expiry?: Date};

  constructor(options: APIHubClientOptions = {}) {
    this.accessToken = options.accessToken;
    this.serviceAccountJson = options.serviceAccountJson;
  }

  /**
   * From a given path, get the first spec available in the API Hub.
   *
   * - If path includes /apis/apiname, get the first spec of that API
   * - If path includes /apis/apiname/versions/versionname, get the first spec
   *   of that API Version
   * - If path includes /apis/apiname/versions/versionname/specs/specname, return
   *   that spec
   *
   * Path can be resource name (projects/xxx/locations/us-central1/apis/apiname),
   * or URL from the UI
   * (https://console.cloud.google.com/apigee/api-hub/apis/apiname?project=xxx)
   *
   * @param path The path to the API, API Version, or API Spec.
   * @returns The content of the first spec available in the API Hub.
   */
  async getSpecContent(path: string): Promise<string> {
    let {apiResourceName, apiVersionResourceName, apiSpecResourceName} =
      this.extractResourceName(path);

    if (apiResourceName && !apiVersionResourceName) {
      const api = await this.getApi(apiResourceName);
      const versions = (api.versions || []) as string[];
      if (versions.length === 0) {
        throw new Error(
          `No versions found in API Hub resource: ${apiResourceName}`
        );
      }
      apiVersionResourceName = versions[0];
    }

    if (apiVersionResourceName && !apiSpecResourceName) {
      const apiVersion = await this.getApiVersion(apiVersionResourceName);
      const specResourceNames = (apiVersion.specs || []) as string[];
      if (specResourceNames.length === 0) {
        throw new Error(
          `No specs found in API Hub version: ${apiVersionResourceName}`
        );
      }
      apiSpecResourceName = specResourceNames[0];
    }

    if (apiSpecResourceName) {
      const specContent = await this.fetchSpec(apiSpecResourceName);
      return specContent;
    }

    throw new Error(`No API Hub resource found in path: ${path}`);
  }

  /**
   * Lists all APIs in the specified project and location.
   *
   * @param project The Google Cloud project name.
   * @param location The location of the API Hub resources (e.g., 'us-central1').
   * @returns A list of API dictionaries, or an empty list if an error occurs.
   */
  async listApis(
    project: string,
    location: string
  ): Promise<Record<string, unknown>[]> {
    const url = `${this.rootUrl}/projects/${project}/locations/${location}/apis`;
    const headers = {
      accept: 'application/json, text/plain, */*',
      Authorization: `Bearer ${await this.getAccessToken()}`,
    };

    const response = await fetch(url, {headers});
    if (!response.ok) {
      throw new Error(
        `Failed to list APIs: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {apis?: Record<string, unknown>[]};
    return data.apis || [];
  }

  /**
   * Get API detail by API name.
   *
   * @param apiResourceName Resource name of this API, like
   *   projects/xxx/locations/us-central1/apis/apiname
   * @returns An API and details in a dict.
   */
  async getApi(apiResourceName: string): Promise<Record<string, unknown>> {
    const url = `${this.rootUrl}/${apiResourceName}`;
    const headers = {
      accept: 'application/json, text/plain, */*',
      Authorization: `Bearer ${await this.getAccessToken()}`,
    };

    const response = await fetch(url, {headers});
    if (!response.ok) {
      throw new Error(
        `Failed to get API: ${response.status} ${response.statusText}`
      );
    }

    return (await response.json()) as Record<string, unknown>;
  }

  /**
   * Gets details of a specific API version.
   *
   * @param apiVersionName The resource name of the API version.
   * @returns The API version details as a dictionary.
   */
  async getApiVersion(apiVersionName: string): Promise<Record<string, unknown>> {
    const url = `${this.rootUrl}/${apiVersionName}`;
    const headers = {
      accept: 'application/json, text/plain, */*',
      Authorization: `Bearer ${await this.getAccessToken()}`,
    };

    const response = await fetch(url, {headers});
    if (!response.ok) {
      throw new Error(
        `Failed to get API version: ${response.status} ${response.statusText}`
      );
    }

    return (await response.json()) as Record<string, unknown>;
  }

  /**
   * Retrieves the content of a specific API specification.
   *
   * @param apiSpecResourceName The resource name of the API spec.
   * @returns The decoded content of the specification as a string.
   */
  private async fetchSpec(apiSpecResourceName: string): Promise<string> {
    const url = `${this.rootUrl}/${apiSpecResourceName}:contents`;
    const headers = {
      accept: 'application/json, text/plain, */*',
      Authorization: `Bearer ${await this.getAccessToken()}`,
    };

    const response = await fetch(url, {headers});
    if (!response.ok) {
      throw new Error(
        `Failed to fetch spec: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as {contents?: string};
    const contentBase64 = data.contents || '';

    if (contentBase64) {
      // Decode base64 content
      const buffer = Buffer.from(contentBase64, 'base64');
      return buffer.toString('utf-8');
    }

    return '';
  }

  /**
   * Extracts the resource names of an API, API Version, and API Spec
   * from a given URL or path.
   *
   * @param urlOrPath The URL (UI or resource) or path string.
   * @returns An object containing the resource names.
   * @throws Error if the URL or path is invalid or if required components
   *   (project, location, api) are missing.
   */
  extractResourceName(urlOrPath: string): ExtractedResourceNames {
    let path: string;
    let queryParams: URLSearchParams | undefined;

    try {
      const parsedUrl = new URL(urlOrPath);
      path = parsedUrl.pathname;
      queryParams = parsedUrl.searchParams;

      // This is a path from UI. Remove unnecessary prefix.
      if (path.includes('api-hub/')) {
        path = path.split('api-hub')[1];
      }
    } catch {
      // Not a valid URL, treat as path
      path = urlOrPath;
    }

    const pathSegments = path.split('/').filter((segment) => segment);

    let project: string | null = null;
    let location: string | null = null;
    let apiId: string | null = null;
    let versionId: string | null = null;
    let specId: string | null = null;

    // Extract project
    const projectIndex = pathSegments.indexOf('projects');
    if (projectIndex !== -1 && projectIndex + 1 < pathSegments.length) {
      project = pathSegments[projectIndex + 1];
    } else if (queryParams?.has('project')) {
      project = queryParams.get('project');
    }

    if (!project) {
      throw new Error(
        `Project ID not found in URL or path in APIHubClient. Input path is ` +
          `'${urlOrPath}'. Please make sure there is either ` +
          `'/projects/PROJECT_ID' in the path or 'project=PROJECT_ID' query ` +
          `param in the input.`
      );
    }

    // Extract location
    const locationIndex = pathSegments.indexOf('locations');
    if (locationIndex !== -1 && locationIndex + 1 < pathSegments.length) {
      location = pathSegments[locationIndex + 1];
    }

    if (!location) {
      throw new Error(
        `Location not found in URL or path in APIHubClient. Input path is ` +
          `'${urlOrPath}'. Please make sure there is ` +
          `'/locations/LOCATION_ID' in the path.`
      );
    }

    // Extract API ID
    const apiIndex = pathSegments.indexOf('apis');
    if (apiIndex !== -1 && apiIndex + 1 < pathSegments.length) {
      apiId = pathSegments[apiIndex + 1];
    }

    if (!apiId) {
      throw new Error(
        `API id not found in URL or path in APIHubClient. Input path is ` +
          `'${urlOrPath}'. Please make sure there is '/apis/API_ID' in the path.`
      );
    }

    // Extract version ID (optional)
    const versionIndex = pathSegments.indexOf('versions');
    if (versionIndex !== -1 && versionIndex + 1 < pathSegments.length) {
      versionId = pathSegments[versionIndex + 1];
    }

    // Extract spec ID (optional)
    const specIndex = pathSegments.indexOf('specs');
    if (specIndex !== -1 && specIndex + 1 < pathSegments.length) {
      specId = pathSegments[specIndex + 1];
    }

    const apiResourceName = `projects/${project}/locations/${location}/apis/${apiId}`;
    const apiVersionResourceName = versionId
      ? `${apiResourceName}/versions/${versionId}`
      : null;
    const apiSpecResourceName =
      versionId && specId
        ? `${apiVersionResourceName}/specs/${specId}`
        : null;

    return {
      apiResourceName,
      apiVersionResourceName,
      apiSpecResourceName,
    };
  }

  /**
   * Gets the access token for authentication.
   *
   * @returns The access token.
   */
  private async getAccessToken(): Promise<string> {
    // If we have a direct access token, use it
    if (this.accessToken) {
      return this.accessToken;
    }

    // Check if we have a cached credential that hasn't expired
    if (
      this.cachedCredential &&
      (!this.cachedCredential.expiry ||
        this.cachedCredential.expiry > new Date())
    ) {
      return this.cachedCredential.token;
    }

    // Try to get credentials from service account or default credentials
    try {
      const {GoogleAuth} = await import('google-auth-library');

      let auth: InstanceType<typeof GoogleAuth>;

      if (this.serviceAccountJson) {
        const serviceAccountConfig = JSON.parse(this.serviceAccountJson);
        auth = new GoogleAuth({
          credentials: serviceAccountConfig,
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        });
      } else {
        // Use application default credentials
        auth = new GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        });
      }

      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();

      if (!tokenResponse.token) {
        throw new Error('Failed to get access token');
      }

      // Cache the credential
      this.cachedCredential = {
        token: tokenResponse.token,
        // Set expiry to 55 minutes from now (tokens typically last 1 hour)
        expiry: new Date(Date.now() + 55 * 60 * 1000),
      };

      return tokenResponse.token;
    } catch (error) {
      throw new Error(
        `Please provide a service account or an access token to API Hub ` +
          `client. Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
