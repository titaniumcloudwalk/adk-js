/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {GenerateContentConfig} from '@google/genai';

import {LlmRequest} from '../../../src/models/llm_request.js';
import {
  createVertexAiRagRetrieval,
  VertexAiRagRetrieval,
  VertexAiRagRetrievalConfig,
} from '../../../src/tools/retrieval/vertex_ai_rag_retrieval.js';
import {ToolContext} from '../../../src/tools/tool_context.js';

describe('VertexAiRagRetrieval', () => {
  const SAMPLE_RAG_CORPUS =
    'projects/my-project/locations/us-central1/ragCorpora/my-corpus';
  const SAMPLE_RAG_CORPUS_2 =
    'projects/my-project/locations/us-central1/ragCorpora/my-corpus-2';

  function createMockToolContext(): ToolContext {
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

  describe('constructor', () => {
    it('creates a tool with name and description', () => {
      const tool = new VertexAiRagRetrieval({
        name: 'my_rag_tool',
        description: 'Retrieves from my RAG corpus',
      });

      expect(tool.name).toBe('my_rag_tool');
      expect(tool.description).toBe('Retrieves from my RAG corpus');
    });

    it('stores ragCorpora configuration', () => {
      const tool = new VertexAiRagRetrieval({
        name: 'rag_tool',
        description: 'RAG tool',
        ragCorpora: [SAMPLE_RAG_CORPUS],
      });

      expect(tool.vertexRagStore.ragCorpora).toEqual([SAMPLE_RAG_CORPUS]);
    });

    it('stores ragResources configuration', () => {
      const ragResources = [
        {
          ragCorpus: SAMPLE_RAG_CORPUS,
          ragFileIds: ['file1', 'file2'],
        },
      ];

      const tool = new VertexAiRagRetrieval({
        name: 'rag_tool',
        description: 'RAG tool',
        ragResources,
      });

      expect(tool.vertexRagStore.ragResources).toEqual(ragResources);
    });

    it('stores similarityTopK configuration', () => {
      const tool = new VertexAiRagRetrieval({
        name: 'rag_tool',
        description: 'RAG tool',
        ragCorpora: [SAMPLE_RAG_CORPUS],
        similarityTopK: 10,
      });

      expect(tool.vertexRagStore.similarityTopK).toBe(10);
    });

    it('stores vectorDistanceThreshold configuration', () => {
      const tool = new VertexAiRagRetrieval({
        name: 'rag_tool',
        description: 'RAG tool',
        ragCorpora: [SAMPLE_RAG_CORPUS],
        vectorDistanceThreshold: 0.8,
      });

      expect(tool.vertexRagStore.vectorDistanceThreshold).toBe(0.8);
    });

    it('stores all configuration options', () => {
      const config: VertexAiRagRetrievalConfig = {
        name: 'comprehensive_rag',
        description: 'A comprehensive RAG tool',
        ragCorpora: [SAMPLE_RAG_CORPUS, SAMPLE_RAG_CORPUS_2],
        ragResources: [{ragCorpus: SAMPLE_RAG_CORPUS, ragFileIds: ['f1']}],
        similarityTopK: 5,
        vectorDistanceThreshold: 0.75,
      };

      const tool = new VertexAiRagRetrieval(config);

      expect(tool.name).toBe('comprehensive_rag');
      expect(tool.description).toBe('A comprehensive RAG tool');
      expect(tool.vertexRagStore.ragCorpora).toEqual([
        SAMPLE_RAG_CORPUS,
        SAMPLE_RAG_CORPUS_2,
      ]);
      expect(tool.vertexRagStore.ragResources).toEqual([
        {ragCorpus: SAMPLE_RAG_CORPUS, ragFileIds: ['f1']},
      ]);
      expect(tool.vertexRagStore.similarityTopK).toBe(5);
      expect(tool.vertexRagStore.vectorDistanceThreshold).toBe(0.75);
    });
  });

  describe('factory function', () => {
    it('creates tool using createVertexAiRagRetrieval', () => {
      const tool = createVertexAiRagRetrieval({
        name: 'factory_tool',
        description: 'Created via factory',
        ragCorpora: [SAMPLE_RAG_CORPUS],
      });

      expect(tool).toBeInstanceOf(VertexAiRagRetrieval);
      expect(tool.name).toBe('factory_tool');
    });
  });

  describe('_getDeclaration', () => {
    it('returns function declaration with query parameter', () => {
      const tool = new VertexAiRagRetrieval({
        name: 'rag_search',
        description: 'Searches RAG corpus',
        ragCorpora: [SAMPLE_RAG_CORPUS],
      });

      const declaration = tool._getDeclaration();

      expect(declaration).toBeDefined();
      expect(declaration!.name).toBe('rag_search');
      expect(declaration!.description).toBe('Searches RAG corpus');
      expect(declaration!.parameters).toBeDefined();
    });
  });

  describe('processLlmRequest', () => {
    describe('with Gemini 2.x models (built-in retrieval)', () => {
      it('adds retrieval config with vertexRagStore for Gemini 2.0', async () => {
        const tool = new VertexAiRagRetrieval({
          name: 'rag_tool',
          description: 'RAG tool',
          ragCorpora: [SAMPLE_RAG_CORPUS],
        });
        const llmRequest = createLlmRequest('gemini-2.0-flash');
        llmRequest.config!.tools = [];

        await tool.processLlmRequest({
          toolContext: createMockToolContext(),
          llmRequest,
        });

        expect(llmRequest.config!.tools!.length).toBe(1);
        const addedTool = llmRequest.config!.tools![0] as {
          retrieval?: {vertexRagStore?: unknown};
        };
        expect(addedTool.retrieval).toBeDefined();
        expect(addedTool.retrieval!.vertexRagStore).toBeDefined();
      });

      it('adds retrieval config for Gemini 2.5 models', async () => {
        const tool = new VertexAiRagRetrieval({
          name: 'rag_tool',
          description: 'RAG tool',
          ragCorpora: [SAMPLE_RAG_CORPUS],
          similarityTopK: 7,
        });
        const llmRequest = createLlmRequest('gemini-2.5-pro');
        llmRequest.config!.tools = [];

        await tool.processLlmRequest({
          toolContext: createMockToolContext(),
          llmRequest,
        });

        const addedTool = llmRequest.config!.tools![0] as {
          retrieval: {vertexRagStore: {similarityTopK?: number}};
        };
        expect(addedTool.retrieval.vertexRagStore.similarityTopK).toBe(7);
      });

      it('passes ragCorpora to vertexRagStore', async () => {
        const tool = new VertexAiRagRetrieval({
          name: 'rag_tool',
          description: 'RAG tool',
          ragCorpora: [SAMPLE_RAG_CORPUS, SAMPLE_RAG_CORPUS_2],
        });
        const llmRequest = createLlmRequest('gemini-2.0-flash');
        llmRequest.config!.tools = [];

        await tool.processLlmRequest({
          toolContext: createMockToolContext(),
          llmRequest,
        });

        const addedTool = llmRequest.config!.tools![0] as {
          retrieval: {vertexRagStore: {ragCorpora?: string[]}};
        };
        expect(addedTool.retrieval.vertexRagStore.ragCorpora).toEqual([
          SAMPLE_RAG_CORPUS,
          SAMPLE_RAG_CORPUS_2,
        ]);
      });

      it('passes ragResources to vertexRagStore', async () => {
        const ragResources = [
          {ragCorpus: SAMPLE_RAG_CORPUS, ragFileIds: ['file1', 'file2']},
        ];

        const tool = new VertexAiRagRetrieval({
          name: 'rag_tool',
          description: 'RAG tool',
          ragResources,
        });
        const llmRequest = createLlmRequest('gemini-2.0-flash');
        llmRequest.config!.tools = [];

        await tool.processLlmRequest({
          toolContext: createMockToolContext(),
          llmRequest,
        });

        const addedTool = llmRequest.config!.tools![0] as {
          retrieval: {vertexRagStore: {ragResources?: unknown[]}};
        };
        expect(addedTool.retrieval.vertexRagStore.ragResources).toEqual(
          ragResources
        );
      });

      it('passes vectorDistanceThreshold to vertexRagStore', async () => {
        const tool = new VertexAiRagRetrieval({
          name: 'rag_tool',
          description: 'RAG tool',
          ragCorpora: [SAMPLE_RAG_CORPUS],
          vectorDistanceThreshold: 0.85,
        });
        const llmRequest = createLlmRequest('gemini-2.0-flash');
        llmRequest.config!.tools = [];

        await tool.processLlmRequest({
          toolContext: createMockToolContext(),
          llmRequest,
        });

        const addedTool = llmRequest.config!.tools![0] as {
          retrieval: {vertexRagStore: {vectorDistanceThreshold?: number}};
        };
        expect(addedTool.retrieval.vertexRagStore.vectorDistanceThreshold).toBe(
          0.85
        );
      });

      it('initializes config.tools if not present', async () => {
        const tool = new VertexAiRagRetrieval({
          name: 'rag_tool',
          description: 'RAG tool',
          ragCorpora: [SAMPLE_RAG_CORPUS],
        });
        const llmRequest: LlmRequest = {
          model: 'gemini-2.0-flash',
          contents: [],
          config: undefined,
          toolsDict: {},
        };

        await tool.processLlmRequest({
          toolContext: createMockToolContext(),
          llmRequest,
        });

        expect(llmRequest.config).toBeDefined();
        expect(llmRequest.config!.tools).toBeDefined();
        expect(llmRequest.config!.tools!.length).toBe(1);
      });

      it('preserves existing tools', async () => {
        const tool = new VertexAiRagRetrieval({
          name: 'rag_tool',
          description: 'RAG tool',
          ragCorpora: [SAMPLE_RAG_CORPUS],
        });
        const existingTool = {googleSearch: {}};
        const llmRequest = createLlmRequest('gemini-2.0-flash');
        llmRequest.config!.tools = [existingTool];

        await tool.processLlmRequest({
          toolContext: createMockToolContext(),
          llmRequest,
        });

        expect(llmRequest.config!.tools!.length).toBe(2);
        expect(llmRequest.config!.tools![0]).toBe(existingTool);
      });

      it('works with path-based Gemini model names', async () => {
        const tool = new VertexAiRagRetrieval({
          name: 'rag_tool',
          description: 'RAG tool',
          ragCorpora: [SAMPLE_RAG_CORPUS],
        });
        const llmRequest = createLlmRequest(
          'projects/my-project/locations/us-central1/publishers/google/models/gemini-2.0-flash-001'
        );
        llmRequest.config!.tools = [];

        await tool.processLlmRequest({
          toolContext: createMockToolContext(),
          llmRequest,
        });

        // Should detect Gemini 2.x and use built-in retrieval
        const addedTool = llmRequest.config!.tools![0] as {
          retrieval?: unknown;
        };
        expect(addedTool.retrieval).toBeDefined();
      });
    });

    describe('with Gemini 1.x models (function declaration)', () => {
      it('adds function declaration for Gemini 1.5 models', async () => {
        const tool = new VertexAiRagRetrieval({
          name: 'rag_tool',
          description: 'RAG tool',
          ragCorpora: [SAMPLE_RAG_CORPUS],
        });
        const llmRequest = createLlmRequest('gemini-1.5-pro');
        llmRequest.config!.tools = [];

        await tool.processLlmRequest({
          toolContext: createMockToolContext(),
          llmRequest,
        });

        // Should add function declaration, not retrieval config
        expect(llmRequest.config!.tools!.length).toBe(1);
        const addedTool = llmRequest.config!.tools![0] as {
          functionDeclarations?: Array<{name: string}>;
          retrieval?: unknown;
        };
        expect(addedTool.functionDeclarations).toBeDefined();
        expect(addedTool.functionDeclarations![0].name).toBe('rag_tool');
        expect(addedTool.retrieval).toBeUndefined();
      });

      it('adds to toolsDict for Gemini 1.x', async () => {
        const tool = new VertexAiRagRetrieval({
          name: 'rag_search',
          description: 'RAG search',
          ragCorpora: [SAMPLE_RAG_CORPUS],
        });
        const llmRequest = createLlmRequest('gemini-1.5-flash');
        llmRequest.config!.tools = [];

        await tool.processLlmRequest({
          toolContext: createMockToolContext(),
          llmRequest,
        });

        expect(llmRequest.toolsDict['rag_search']).toBe(tool);
      });
    });

    describe('with unknown/no model', () => {
      it('adds function declaration when model is undefined', async () => {
        const tool = new VertexAiRagRetrieval({
          name: 'rag_tool',
          description: 'RAG tool',
          ragCorpora: [SAMPLE_RAG_CORPUS],
        });
        const llmRequest: LlmRequest = {
          model: undefined,
          contents: [],
          config: {tools: []},
          toolsDict: {},
        };

        await tool.processLlmRequest({
          toolContext: createMockToolContext(),
          llmRequest,
        });

        // Should fall back to function declaration
        const addedTool = llmRequest.config!.tools![0] as {
          functionDeclarations?: Array<{name: string}>;
        };
        expect(addedTool.functionDeclarations).toBeDefined();
      });

      it('adds function declaration for non-Gemini models', async () => {
        const tool = new VertexAiRagRetrieval({
          name: 'rag_tool',
          description: 'RAG tool',
          ragCorpora: [SAMPLE_RAG_CORPUS],
        });
        const llmRequest = createLlmRequest('claude-3-opus');
        llmRequest.config!.tools = [];

        await tool.processLlmRequest({
          toolContext: createMockToolContext(),
          llmRequest,
        });

        // Should fall back to function declaration for non-Gemini
        const addedTool = llmRequest.config!.tools![0] as {
          functionDeclarations?: Array<{name: string}>;
        };
        expect(addedTool.functionDeclarations).toBeDefined();
      });
    });
  });

  describe('runAsync (client-side execution)', () => {
    it('returns error message indicating client-side RAG is not fully implemented', async () => {
      const tool = new VertexAiRagRetrieval({
        name: 'rag_tool',
        description: 'RAG tool',
        ragCorpora: [SAMPLE_RAG_CORPUS],
      });

      const result = await tool.runAsync({
        args: {query: 'what is machine learning?'},
        toolContext: createMockToolContext(),
      });

      expect(result).toBeDefined();
      const resultObj = result as {error: string; query: string};
      expect(resultObj.error).toContain('Client-side RAG retrieval');
      expect(resultObj.query).toBe('what is machine learning?');
    });

    it('includes query in the result', async () => {
      const tool = new VertexAiRagRetrieval({
        name: 'rag_tool',
        description: 'RAG tool',
        ragCorpora: [SAMPLE_RAG_CORPUS],
      });

      const result = await tool.runAsync({
        args: {query: 'test query'},
        toolContext: createMockToolContext(),
      });

      const resultObj = result as {query: string};
      expect(resultObj.query).toBe('test query');
    });

    it('includes vertexRagStore config in the result', async () => {
      const tool = new VertexAiRagRetrieval({
        name: 'rag_tool',
        description: 'RAG tool',
        ragCorpora: [SAMPLE_RAG_CORPUS],
        similarityTopK: 5,
      });

      const result = await tool.runAsync({
        args: {query: 'test'},
        toolContext: createMockToolContext(),
      });

      const resultObj = result as {config: {ragCorpora?: string[]; similarityTopK?: number}};
      expect(resultObj.config.ragCorpora).toEqual([SAMPLE_RAG_CORPUS]);
      expect(resultObj.config.similarityTopK).toBe(5);
    });
  });

  describe('integration with other tools', () => {
    it('can be used alongside function tools with Gemini 2.x', async () => {
      const ragTool = new VertexAiRagRetrieval({
        name: 'knowledge_base',
        description: 'Searches knowledge base',
        ragCorpora: [SAMPLE_RAG_CORPUS],
      });

      const llmRequest = createLlmRequest('gemini-2.0-flash');
      llmRequest.config!.tools = [
        {
          functionDeclarations: [
            {name: 'calculate', description: 'Performs calculations'},
          ],
        },
      ];

      await ragTool.processLlmRequest({
        toolContext: createMockToolContext(),
        llmRequest,
      });

      // Should have both function tool and retrieval tool
      expect(llmRequest.config!.tools!.length).toBe(2);
    });
  });
});
