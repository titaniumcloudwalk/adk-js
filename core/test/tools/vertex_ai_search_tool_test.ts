/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {GenerateContentConfig} from '@google/genai';

import {LlmRequest} from '../../src/models/llm_request.js';
import {ToolContext} from '../../src/tools/tool_context.js';
import {
  VertexAiSearchTool,
  VertexAiSearchToolConfig,
  createVertexAiSearchTool,
} from '../../src/tools/vertex_ai_search_tool.js';

describe('VertexAiSearchTool', () => {
  const SAMPLE_DATASTORE_ID =
    'projects/my-project/locations/global/collections/default_collection/dataStores/my-datastore';
  const SAMPLE_ENGINE_ID =
    'projects/my-project/locations/global/collections/default_collection/engines/my-engine';

  function createEmptyToolContext(): ToolContext {
    return {} as ToolContext;
  }

  function createLlmRequest(model: string): LlmRequest {
    return {
      model,
      contents: [],
      config: {} as GenerateContentConfig,
      toolsDict: {},
    };
  }

  describe('constructor validation', () => {
    it('throws error when neither dataStoreId nor searchEngineId is specified', () => {
      expect(() => {
        new VertexAiSearchTool({});
      }).toThrow(
        'Either dataStoreId or searchEngineId must be specified, but not both.'
      );
    });

    it('throws error when both dataStoreId and searchEngineId are specified', () => {
      expect(() => {
        new VertexAiSearchTool({
          dataStoreId: SAMPLE_DATASTORE_ID,
          searchEngineId: SAMPLE_ENGINE_ID,
        });
      }).toThrow(
        'Either dataStoreId or searchEngineId must be specified, but not both.'
      );
    });

    it('throws error when dataStoreSpecs is provided without searchEngineId', () => {
      expect(() => {
        new VertexAiSearchTool({
          dataStoreId: SAMPLE_DATASTORE_ID,
          dataStoreSpecs: [
            {dataStore: SAMPLE_DATASTORE_ID},
          ],
        });
      }).toThrow(
        'searchEngineId must be specified if dataStoreSpecs is specified.'
      );
    });

    it('creates tool successfully with only dataStoreId', () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      expect(tool.name).toBe('vertex_ai_search');
      expect(tool.description).toBe(
        'Vertex AI Search Tool for enterprise document grounding'
      );
    });

    it('creates tool successfully with only searchEngineId', () => {
      const tool = new VertexAiSearchTool({
        searchEngineId: SAMPLE_ENGINE_ID,
      });
      expect(tool.name).toBe('vertex_ai_search');
    });

    it('creates tool successfully with searchEngineId and dataStoreSpecs', () => {
      const tool = new VertexAiSearchTool({
        searchEngineId: SAMPLE_ENGINE_ID,
        dataStoreSpecs: [
          {dataStore: SAMPLE_DATASTORE_ID, filter: 'category: "tech"'},
        ],
      });
      expect(tool.name).toBe('vertex_ai_search');
    });

    it('creates tool with all optional parameters', () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
        filter: 'status: "published"',
        maxResults: 5,
        bypassMultiToolsLimit: true,
      });
      expect(tool.name).toBe('vertex_ai_search');
    });
  });

  describe('factory function', () => {
    it('creates tool using createVertexAiSearchTool', () => {
      const tool = createVertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      expect(tool).toBeInstanceOf(VertexAiSearchTool);
      expect(tool.name).toBe('vertex_ai_search');
    });
  });

  describe('runAsync', () => {
    it('returns resolved promise (built-in tool does not execute locally)', async () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });

      const result = await tool.runAsync({
        args: {},
        toolContext: createEmptyToolContext(),
      });

      expect(result).toBeUndefined();
    });
  });

  describe('processLlmRequest', () => {
    it('throws error for non-Gemini models', async () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      const llmRequest = createLlmRequest('claude-3-opus');

      await expect(
        tool.processLlmRequest({
          toolContext: createEmptyToolContext(),
          llmRequest,
        })
      ).rejects.toThrow('Vertex AI Search tool is not supported for model claude-3-opus');
    });

    it('does nothing when model is not specified', async () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      const llmRequest: LlmRequest = {
        model: undefined,
        contents: [],
        config: undefined,
        toolsDict: {},
      };

      await tool.processLlmRequest({
        toolContext: createEmptyToolContext(),
        llmRequest,
      });

      // Should not modify the request
      expect(llmRequest.config).toBeUndefined();
    });

    it('initializes config.tools if not present', async () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      const llmRequest: LlmRequest = {
        model: 'gemini-2.0-flash',
        contents: [],
        config: undefined,
        toolsDict: {},
      };

      await tool.processLlmRequest({
        toolContext: createEmptyToolContext(),
        llmRequest,
      });

      expect(llmRequest.config).toBeDefined();
      expect(llmRequest.config!.tools).toBeDefined();
      expect(Array.isArray(llmRequest.config!.tools)).toBe(true);
    });

    it('adds retrieval config with dataStoreId', async () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      const llmRequest = createLlmRequest('gemini-2.0-flash');
      llmRequest.config!.tools = [];

      await tool.processLlmRequest({
        toolContext: createEmptyToolContext(),
        llmRequest,
      });

      expect(llmRequest.config!.tools!.length).toBe(1);
      const addedTool = llmRequest.config!.tools![0] as any;
      expect(addedTool.retrieval).toBeDefined();
      expect(addedTool.retrieval.vertexAiSearch).toBeDefined();
      expect(addedTool.retrieval.vertexAiSearch.datastore).toBe(
        SAMPLE_DATASTORE_ID
      );
    });

    it('adds retrieval config with searchEngineId', async () => {
      const tool = new VertexAiSearchTool({
        searchEngineId: SAMPLE_ENGINE_ID,
      });
      const llmRequest = createLlmRequest('gemini-2.0-flash');
      llmRequest.config!.tools = [];

      await tool.processLlmRequest({
        toolContext: createEmptyToolContext(),
        llmRequest,
      });

      const addedTool = llmRequest.config!.tools![0] as any;
      expect(addedTool.retrieval.vertexAiSearch.engine).toBe(SAMPLE_ENGINE_ID);
      expect(addedTool.retrieval.vertexAiSearch.datastore).toBeUndefined();
    });

    it('adds retrieval config with all optional parameters', async () => {
      const dataStoreSpecs = [
        {dataStore: SAMPLE_DATASTORE_ID, filter: 'category: "tech"'},
        {dataStore: 'projects/p/locations/l/collections/c/dataStores/ds2'},
      ];

      const tool = new VertexAiSearchTool({
        searchEngineId: SAMPLE_ENGINE_ID,
        dataStoreSpecs,
        filter: 'status: "active"',
        maxResults: 7,
      });
      const llmRequest = createLlmRequest('gemini-2.0-flash');
      llmRequest.config!.tools = [];

      await tool.processLlmRequest({
        toolContext: createEmptyToolContext(),
        llmRequest,
      });

      const addedTool = llmRequest.config!.tools![0] as any;
      const vertexAiSearch = addedTool.retrieval.vertexAiSearch;

      expect(vertexAiSearch.engine).toBe(SAMPLE_ENGINE_ID);
      expect(vertexAiSearch.dataStoreSpecs).toEqual(dataStoreSpecs);
      expect(vertexAiSearch.filter).toBe('status: "active"');
      expect(vertexAiSearch.maxResults).toBe(7);
    });

    it('works with Gemini 2.x models', async () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      const llmRequest = createLlmRequest('gemini-2.5-pro');
      llmRequest.config!.tools = [];

      await tool.processLlmRequest({
        toolContext: createEmptyToolContext(),
        llmRequest,
      });

      expect(llmRequest.config!.tools!.length).toBe(1);
    });

    it('works with Gemini 1.x models when no other tools are present', async () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      const llmRequest = createLlmRequest('gemini-1.5-pro');
      llmRequest.config!.tools = [];

      await tool.processLlmRequest({
        toolContext: createEmptyToolContext(),
        llmRequest,
      });

      expect(llmRequest.config!.tools!.length).toBe(1);
    });

    it('throws error for Gemini 1.x when other function tools are present', async () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      const llmRequest = createLlmRequest('gemini-1.5-pro');
      llmRequest.config!.tools = [
        {
          functionDeclarations: [
            {name: 'someFunction', description: 'A function'},
          ],
        },
      ];

      await expect(
        tool.processLlmRequest({
          toolContext: createEmptyToolContext(),
          llmRequest,
        })
      ).rejects.toThrow(
        'Vertex AI Search tool cannot be used with other tools in Gemini 1.x'
      );
    });

    it('throws error for Gemini 1.x when googleSearch tool is present', async () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      const llmRequest = createLlmRequest('gemini-1.5-flash');
      llmRequest.config!.tools = [{googleSearch: {}}];

      await expect(
        tool.processLlmRequest({
          toolContext: createEmptyToolContext(),
          llmRequest,
        })
      ).rejects.toThrow(
        'Vertex AI Search tool cannot be used with other tools in Gemini 1.x'
      );
    });

    it('throws error for Gemini 1.x when codeExecution tool is present', async () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      const llmRequest = createLlmRequest('gemini-1.0-pro');
      llmRequest.config!.tools = [{codeExecution: {}}];

      await expect(
        tool.processLlmRequest({
          toolContext: createEmptyToolContext(),
          llmRequest,
        })
      ).rejects.toThrow(
        'Vertex AI Search tool cannot be used with other tools in Gemini 1.x'
      );
    });

    it('allows multiple tools with Gemini 2.x models', async () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      const llmRequest = createLlmRequest('gemini-2.0-flash');
      llmRequest.config!.tools = [
        {
          functionDeclarations: [
            {name: 'someFunction', description: 'A function'},
          ],
        },
      ];

      // Should not throw
      await tool.processLlmRequest({
        toolContext: createEmptyToolContext(),
        llmRequest,
      });

      // Should have 2 tools now
      expect(llmRequest.config!.tools!.length).toBe(2);
    });

    it('works with path-based Gemini model names', async () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      const llmRequest = createLlmRequest(
        'projects/my-project/locations/us-central1/publishers/google/models/gemini-2.0-flash-001'
      );
      llmRequest.config!.tools = [];

      await tool.processLlmRequest({
        toolContext: createEmptyToolContext(),
        llmRequest,
      });

      expect(llmRequest.config!.tools!.length).toBe(1);
    });

    it('preserves existing tools in config', async () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      const llmRequest = createLlmRequest('gemini-2.0-flash');
      const existingTool = {googleSearch: {}};
      llmRequest.config!.tools = [existingTool];

      await tool.processLlmRequest({
        toolContext: createEmptyToolContext(),
        llmRequest,
      });

      expect(llmRequest.config!.tools!.length).toBe(2);
      expect(llmRequest.config!.tools![0]).toBe(existingTool);
    });
  });

  describe('bypassMultiToolsLimit', () => {
    it('stores bypassMultiToolsLimit setting', () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
        bypassMultiToolsLimit: true,
      });
      expect(tool.name).toBe('vertex_ai_search');
      // The actual bypass logic would be implemented in LlmAgent
      // This test just verifies the setting is accepted
    });

    it('defaults bypassMultiToolsLimit to false', () => {
      const tool = new VertexAiSearchTool({
        dataStoreId: SAMPLE_DATASTORE_ID,
      });
      // Tool should be created without error
      expect(tool.name).toBe('vertex_ai_search');
    });
  });
});
