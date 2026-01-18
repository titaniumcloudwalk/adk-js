/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Type} from '@google/genai';

import {RunAsyncToolRequest} from '../../../src/tools/base_tool.js';
import {BaseRetrievalTool} from '../../../src/tools/retrieval/base_retrieval_tool.js';
import {ToolContext} from '../../../src/tools/tool_context.js';

// Concrete implementation for testing
class TestRetrievalTool extends BaseRetrievalTool {
  private readonly mockResults: unknown[];

  constructor(
    name: string,
    description: string,
    mockResults: unknown[] = ['result1', 'result2']
  ) {
    super({name, description});
    this.mockResults = mockResults;
  }

  async runAsync(request: RunAsyncToolRequest): Promise<unknown> {
    const query = request.args['query'] as string;
    if (!query) {
      return {error: 'Query is required'};
    }
    return this.mockResults;
  }
}

describe('BaseRetrievalTool', () => {
  function createMockToolContext(): ToolContext {
    return {} as ToolContext;
  }

  describe('constructor', () => {
    it('creates a retrieval tool with name and description', () => {
      const tool = new TestRetrievalTool(
        'test_retrieval',
        'A test retrieval tool'
      );

      expect(tool.name).toBe('test_retrieval');
      expect(tool.description).toBe('A test retrieval tool');
      expect(tool.isLongRunning).toBe(false);
    });
  });

  describe('_getDeclaration', () => {
    it('returns a function declaration with query parameter', () => {
      const tool = new TestRetrievalTool(
        'my_retrieval',
        'Retrieves documents from my data source'
      );

      const declaration = tool._getDeclaration();

      expect(declaration).toBeDefined();
      expect(declaration!.name).toBe('my_retrieval');
      expect(declaration!.description).toBe(
        'Retrieves documents from my data source'
      );
      expect(declaration!.parameters).toBeDefined();
      expect(declaration!.parameters!.type).toBe(Type.OBJECT);
    });

    it('has query parameter of type STRING', () => {
      const tool = new TestRetrievalTool('test', 'test description');

      const declaration = tool._getDeclaration();

      const properties = declaration!.parameters!.properties as Record<
        string,
        {type: string; description: string}
      >;
      expect(properties).toBeDefined();
      expect(properties['query']).toBeDefined();
      expect(properties['query'].type).toBe(Type.STRING);
      expect(properties['query'].description).toBe('The query to retrieve.');
    });

    it('marks query as required', () => {
      const tool = new TestRetrievalTool('test', 'test description');

      const declaration = tool._getDeclaration();

      expect(declaration!.parameters!.required).toEqual(['query']);
    });
  });

  describe('runAsync', () => {
    it('receives query from args', async () => {
      const tool = new TestRetrievalTool('test', 'test', ['doc1', 'doc2']);

      const result = await tool.runAsync({
        args: {query: 'what is AI?'},
        toolContext: createMockToolContext(),
      });

      expect(result).toEqual(['doc1', 'doc2']);
    });

    it('can return error for missing query', async () => {
      const tool = new TestRetrievalTool('test', 'test');

      const result = await tool.runAsync({
        args: {},
        toolContext: createMockToolContext(),
      });

      expect(result).toEqual({error: 'Query is required'});
    });
  });

  describe('processLlmRequest (inherited from BaseTool)', () => {
    it('adds function declaration to LLM request', async () => {
      const tool = new TestRetrievalTool('knowledge_base', 'Searches knowledge base');

      const llmRequest = {
        model: 'gemini-2.0-flash',
        contents: [],
        config: {tools: []},
        toolsDict: {},
      };

      await tool.processLlmRequest({
        toolContext: createMockToolContext(),
        llmRequest,
      });

      // Should add to toolsDict
      expect(llmRequest.toolsDict['knowledge_base']).toBe(tool);

      // Should add function declaration to tools
      expect(llmRequest.config.tools.length).toBe(1);
      const addedTool = llmRequest.config.tools[0] as {
        functionDeclarations?: Array<{name: string}>;
      };
      expect(addedTool.functionDeclarations).toBeDefined();
      expect(addedTool.functionDeclarations![0].name).toBe('knowledge_base');
    });

    it('appends to existing function declarations', async () => {
      const tool = new TestRetrievalTool('my_retrieval', 'My retrieval');

      const existingDeclaration = {
        name: 'existing_function',
        description: 'An existing function',
      };

      const llmRequest = {
        model: 'gemini-2.0-flash',
        contents: [],
        config: {
          tools: [{functionDeclarations: [existingDeclaration]}],
        },
        toolsDict: {},
      };

      await tool.processLlmRequest({
        toolContext: createMockToolContext(),
        llmRequest,
      });

      // Should add to the existing tool's function declarations
      expect(llmRequest.config.tools.length).toBe(1);
      const existingTool = llmRequest.config.tools[0] as {
        functionDeclarations: Array<{name: string}>;
      };
      expect(existingTool.functionDeclarations.length).toBe(2);
      expect(existingTool.functionDeclarations[0].name).toBe('existing_function');
      expect(existingTool.functionDeclarations[1].name).toBe('my_retrieval');
    });
  });
});
