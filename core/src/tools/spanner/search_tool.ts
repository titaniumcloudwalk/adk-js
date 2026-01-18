/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration, Schema, Type} from '@google/genai';

import {BaseTool, RunAsyncToolRequest} from '../base_tool.js';

import {SpannerClient} from './client.js';
import {
  DistanceType,
  EmbeddingOptions,
  NearestNeighborsAlgorithm,
  SearchOptions,
  SpannerToolSettings,
  SpannerVectorStoreSettings,
} from './config.js';
import {SpannerToolResult} from './metadata_tools.js';

/**
 * Result structure for similarity search.
 */
export interface SimilaritySearchResult {
  rows: unknown[];
  result_is_likely_truncated?: boolean;
}

/**
 * Maps distance type to GoogleSQL function name.
 */
function getDistanceFunctionGoogleSql(
  distanceType: DistanceType,
  isApproximate: boolean,
): string {
  const prefix = isApproximate ? 'APPROX_' : '';
  switch (distanceType) {
    case 'COSINE':
      return `${prefix}COSINE_DISTANCE`;
    case 'EUCLIDEAN':
      return `${prefix}EUCLIDEAN_DISTANCE`;
    case 'DOT_PRODUCT':
      return `${prefix}DOT_PRODUCT`;
    default:
      return `${prefix}COSINE_DISTANCE`;
  }
}

/**
 * Maps distance type to PostgreSQL function name.
 */
function getDistanceFunctionPostgresql(distanceType: DistanceType): string {
  switch (distanceType) {
    case 'COSINE':
      return 'spanner.cosine_distance';
    case 'EUCLIDEAN':
      return 'spanner.euclidean_distance';
    case 'DOT_PRODUCT':
      return 'spanner.dot_product';
    default:
      return 'spanner.cosine_distance';
  }
}

/**
 * Generates embedding SQL for GoogleSQL dialect.
 */
function generateEmbeddingQueryGoogleSql(
  embeddingOptions: EmbeddingOptions,
  queryParamName: string,
): string {
  if (embeddingOptions.vertexAiEmbeddingModelName) {
    const dimensionalityClause = embeddingOptions.outputDimensionality
      ? `, JSON '{"outputDimensionality": ${embeddingOptions.outputDimensionality}}'`
      : '';
    return `ML.PREDICT(
      MODEL \`${embeddingOptions.vertexAiEmbeddingModelName}\`,
      (SELECT @${queryParamName} AS content)${dimensionalityClause}
    ).text_embedding`;
  }
  if (embeddingOptions.spannerGooglesqlEmbeddingModelName) {
    return `ML.PREDICT(
      MODEL \`${embeddingOptions.spannerGooglesqlEmbeddingModelName}\`,
      (SELECT @${queryParamName} AS content)
    ).text_embedding`;
  }
  throw new Error('No valid embedding model specified for GoogleSQL');
}

/**
 * Generates embedding SQL for PostgreSQL dialect.
 */
function generateEmbeddingQueryPostgresql(
  embeddingOptions: EmbeddingOptions,
  queryParamName: string,
): string {
  if (embeddingOptions.spannerPostgresqlVertexAiEmbeddingModelEndpoint) {
    const dimensionalityClause = embeddingOptions.outputDimensionality
      ? `, '{"outputDimensionality": ${embeddingOptions.outputDimensionality}}'::jsonb`
      : '';
    return `spanner.ML_PREDICT_ROW(
      '${embeddingOptions.spannerPostgresqlVertexAiEmbeddingModelEndpoint}',
      jsonb_build_object('instances', jsonb_build_array(jsonb_build_object('content', $${queryParamName})))${dimensionalityClause}
    )->'predictions'->0->'embeddings'->'values'`;
  }
  throw new Error('No valid embedding model specified for PostgreSQL');
}

/**
 * Tool for executing similarity search queries.
 */
class SimilaritySearchTool extends BaseTool {
  constructor(
    private readonly getClient: () => Promise<SpannerClient>,
  ) {
    super({
      name: 'spanner_similarity_search',
      description:
        'Performs a vector similarity search on a Spanner table. ' +
        'Requires specifying the embedding column, columns to return, and embedding model options. ' +
        'Supports both exact (kNN) and approximate (ANN) nearest neighbor search.',
    });
  }

  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          table_name: {
            type: Type.STRING,
            description: 'The name of the table containing vector embeddings.',
          },
          query: {
            type: Type.STRING,
            description: 'The text query to search for similar content.',
          },
          embedding_column_to_search: {
            type: Type.STRING,
            description: 'The name of the column containing the vector embeddings.',
          },
          columns: {
            type: Type.ARRAY,
            items: {type: Type.STRING} as Schema,
            description: 'The columns to return in the search results.',
          },
          embedding_options: {
            type: Type.OBJECT,
            description:
              'Embedding model configuration. Must specify exactly one of: ' +
              'vertex_ai_embedding_model_name, spanner_googlesql_embedding_model_name, ' +
              'or spanner_postgresql_vertex_ai_embedding_model_endpoint.',
            properties: {
              vertex_ai_embedding_model_name: {
                type: Type.STRING,
                description: 'Vertex AI public embedding model name (e.g., "text-embedding-005").',
              },
              spanner_googlesql_embedding_model_name: {
                type: Type.STRING,
                description: 'Spanner registered embedding model name for GoogleSQL.',
              },
              spanner_postgresql_vertex_ai_embedding_model_endpoint: {
                type: Type.STRING,
                description: 'PostgreSQL Vertex AI embedding model endpoint.',
              },
              output_dimensionality: {
                type: Type.NUMBER,
                description: 'Output dimensionality for embeddings (for dimensionality reduction).',
              },
            },
          },
          additional_filter: {
            type: Type.STRING,
            description: 'Optional SQL WHERE clause filter to apply before vector search.',
          },
          search_options: {
            type: Type.OBJECT,
            description: 'Search configuration options.',
            properties: {
              top_k: {
                type: Type.NUMBER,
                description: 'Number of results to return. Default: 4.',
              },
              distance_type: {
                type: Type.STRING,
                description: 'Distance metric: COSINE, EUCLIDEAN, or DOT_PRODUCT. Default: COSINE.',
              },
              nearest_neighbors_algorithm: {
                type: Type.STRING,
                description: 'Algorithm: EXACT_NEAREST_NEIGHBORS or APPROXIMATE_NEAREST_NEIGHBORS. Default: EXACT_NEAREST_NEIGHBORS.',
              },
              num_leaves_to_search: {
                type: Type.NUMBER,
                description: 'Number of leaves to search (for ANN only).',
              },
            },
          },
        },
        required: ['table_name', 'query', 'embedding_column_to_search', 'columns', 'embedding_options'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<SpannerToolResult<SimilaritySearchResult>> {
    try {
      const client = await this.getClient();
      const args = request.args as {
        table_name: string;
        query: string;
        embedding_column_to_search: string;
        columns: string[];
        embedding_options: EmbeddingOptions;
        additional_filter?: string;
        search_options?: SearchOptions;
      };

      // Validate embedding options
      const embeddingOptionCount = [
        args.embedding_options.vertexAiEmbeddingModelName,
        args.embedding_options.spannerGooglesqlEmbeddingModelName,
        args.embedding_options.spannerPostgresqlVertexAiEmbeddingModelEndpoint,
      ].filter(Boolean).length;

      if (embeddingOptionCount !== 1) {
        return {
          status: 'ERROR',
          error_details:
            'Exactly one embedding model option must be specified: ' +
            'vertex_ai_embedding_model_name, spanner_googlesql_embedding_model_name, ' +
            'or spanner_postgresql_vertex_ai_embedding_model_endpoint.',
        };
      }

      const searchOptions = args.search_options ?? {};
      const topK = searchOptions.topK ?? 4;
      const distanceType: DistanceType = (searchOptions.distanceType as DistanceType) ?? 'COSINE';
      const algorithm: NearestNeighborsAlgorithm =
        (searchOptions.nearestNeighborsAlgorithm as NearestNeighborsAlgorithm) ?? 'EXACT_NEAREST_NEIGHBORS';
      const isApproximate = algorithm === 'APPROXIMATE_NEAREST_NEIGHBORS';

      // Determine if we're using PostgreSQL or GoogleSQL based on embedding options
      const isPostgresql = !!args.embedding_options.spannerPostgresqlVertexAiEmbeddingModelEndpoint;

      // Build the similarity search SQL
      let sql: string;
      const params: Record<string, unknown> = {query_text: args.query};

      if (isPostgresql) {
        // PostgreSQL dialect
        const embeddingQuery = generateEmbeddingQueryPostgresql(args.embedding_options, 'query_text');
        const distanceFunc = getDistanceFunctionPostgresql(distanceType);
        const columnsStr = args.columns.join(', ');
        const filterClause = args.additional_filter ? ` WHERE ${args.additional_filter}` : '';

        sql = `
          SELECT ${columnsStr}, ${distanceFunc}(${args.embedding_column_to_search}, (${embeddingQuery})::float4[]) AS distance
          FROM ${args.table_name}${filterClause}
          ORDER BY distance
          LIMIT ${topK}
        `;
      } else {
        // GoogleSQL dialect
        const embeddingQuery = generateEmbeddingQueryGoogleSql(args.embedding_options, 'query_text');
        const distanceFunc = getDistanceFunctionGoogleSql(distanceType, isApproximate);
        const columnsStr = args.columns.join(', ');
        const filterClause = args.additional_filter ? ` WHERE ${args.additional_filter}` : '';

        if (isApproximate) {
          // ANN with options
          const optionsParts: string[] = [];
          if (searchOptions.numLeavesToSearch) {
            optionsParts.push(`num_leaves_to_search => ${searchOptions.numLeavesToSearch}`);
          }
          const optionsClause = optionsParts.length > 0 ? `, options => STRUCT(${optionsParts.join(', ')})` : '';

          sql = `
            SELECT ${columnsStr}, ${distanceFunc}(${args.embedding_column_to_search}, (${embeddingQuery})${optionsClause}) AS distance
            FROM ${args.table_name}${filterClause}
            ORDER BY distance
            LIMIT ${topK}
          `;
        } else {
          // Exact kNN
          sql = `
            SELECT ${columnsStr}, ${distanceFunc}(${args.embedding_column_to_search}, (${embeddingQuery})) AS distance
            FROM ${args.table_name}${filterClause}
            ORDER BY distance
            LIMIT ${topK}
          `;
        }
      }

      const result = await client.executeQuery({
        query: sql,
        params,
      });

      return {
        status: 'SUCCESS',
        results: {
          rows: result.rows,
          result_is_likely_truncated: result.resultIsLikelyTruncated,
        },
      };
    } catch (error) {
      return {
        status: 'ERROR',
        error_details: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Tool for executing vector store similarity search with pre-configured settings.
 */
class VectorStoreSimilaritySearchTool extends BaseTool {
  constructor(
    private readonly getClient: () => Promise<SpannerClient>,
    private readonly vectorStoreSettings: SpannerVectorStoreSettings,
  ) {
    super({
      name: 'spanner_vector_store_similarity_search',
      description:
        `Performs a vector similarity search on the pre-configured vector store table "${vectorStoreSettings.tableName}". ` +
        'Simply provide a text query and the tool will use the configured embedding model and search parameters.',
    });
  }

  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: 'The text query to search for similar content.',
          },
        },
        required: ['query'],
      },
    };
  }

  override async runAsync(
    request: RunAsyncToolRequest,
  ): Promise<SpannerToolResult<SimilaritySearchResult>> {
    try {
      const client = await this.getClient();
      const args = request.args as {query: string};

      const settings = this.vectorStoreSettings;
      const topK = settings.topK ?? 4;
      const distanceType: DistanceType = settings.distanceType ?? 'COSINE';
      const algorithm: NearestNeighborsAlgorithm =
        settings.nearestNeighborsAlgorithm ?? 'EXACT_NEAREST_NEIGHBORS';
      const isApproximate = algorithm === 'APPROXIMATE_NEAREST_NEIGHBORS';

      // Build embedding query (assumes GoogleSQL with Vertex AI)
      const dimensionalityClause = settings.vectorLength
        ? `, JSON '{"outputDimensionality": ${settings.vectorLength}}'`
        : '';
      const embeddingQuery = `ML.PREDICT(
        MODEL \`${settings.vertexAiEmbeddingModelName}\`,
        (SELECT @query_text AS content)${dimensionalityClause}
      ).text_embedding`;

      const distanceFunc = getDistanceFunctionGoogleSql(distanceType, isApproximate);

      // Build column selection
      const columns = settings.selectedColumns ?? [settings.contentColumn];
      const columnsStr = columns.join(', ');

      // Build filter clause
      const filterClause = settings.additionalFilter ? ` WHERE ${settings.additionalFilter}` : '';

      // Build options for ANN
      let optionsClause = '';
      if (isApproximate && settings.numLeavesToSearch) {
        optionsClause = `, options => STRUCT(num_leaves_to_search => ${settings.numLeavesToSearch})`;
      }

      const sql = `
        SELECT ${columnsStr}, ${distanceFunc}(${settings.embeddingColumn}, (${embeddingQuery})${optionsClause}) AS distance
        FROM ${settings.tableName}${filterClause}
        ORDER BY distance
        LIMIT ${topK}
      `;

      const result = await client.executeQuery({
        query: sql,
        params: {query_text: args.query},
      });

      return {
        status: 'SUCCESS',
        results: {
          rows: result.rows,
          result_is_likely_truncated: result.resultIsLikelyTruncated,
        },
      };
    } catch (error) {
      return {
        status: 'ERROR',
        error_details: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

/**
 * Creates the similarity_search tool.
 */
export function createSimilaritySearchTool(
  getClient: () => Promise<SpannerClient>,
): BaseTool {
  return new SimilaritySearchTool(getClient);
}

/**
 * Creates the vector_store_similarity_search tool if vector store settings are provided.
 */
export function createVectorStoreSimilaritySearchTool(
  getClient: () => Promise<SpannerClient>,
  vectorStoreSettings: SpannerVectorStoreSettings,
): BaseTool {
  return new VectorStoreSimilaritySearchTool(getClient, vectorStoreSettings);
}
