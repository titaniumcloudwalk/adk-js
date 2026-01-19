/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {expect} from 'chai';

import {LlmRequest} from '../../src/models/llm_request.js';
import {URL_CONTEXT, UrlContextTool} from '../../src/tools/url_context_tool.js';
import {ToolContext} from '../../src/tools/tool_context.js';

describe('UrlContextTool', () => {
  let tool: UrlContextTool;

  beforeEach(() => {
    tool = new UrlContextTool();
  });

  describe('constructor', () => {
    it('should have name "url_context"', () => {
      expect(tool.name).to.equal('url_context');
    });

    it('should have description "url_context"', () => {
      expect(tool.description).to.equal('url_context');
    });
  });

  describe('URL_CONTEXT singleton', () => {
    it('should be an instance of UrlContextTool', () => {
      expect(URL_CONTEXT).to.be.instanceOf(UrlContextTool);
    });

    it('should have name "url_context"', () => {
      expect(URL_CONTEXT.name).to.equal('url_context');
    });
  });

  describe('runAsync', () => {
    it('should return undefined (no-op)', async () => {
      const result = await tool.runAsync({
        args: {},
        toolContext: {} as ToolContext,
      });
      expect(result).to.be.undefined;
    });
  });

  describe('processLlmRequest', () => {
    it('should add urlContext config for Gemini 2.x model', async () => {
      const llmRequest: LlmRequest = {
        model: 'gemini-2.0-flash-001',
        contents: [],
      };

      await tool.processLlmRequest({
        toolContext: {} as ToolContext,
        llmRequest,
      });

      expect(llmRequest.config).to.exist;
      expect(llmRequest.config!.tools).to.be.an('array').with.lengthOf(1);
      expect(llmRequest.config!.tools![0]).to.have.property('urlContext');
    });

    it('should add urlContext config for Gemini 2.5 model', async () => {
      const llmRequest: LlmRequest = {
        model: 'gemini-2.5-pro',
        contents: [],
      };

      await tool.processLlmRequest({
        toolContext: {} as ToolContext,
        llmRequest,
      });

      expect(llmRequest.config).to.exist;
      expect(llmRequest.config!.tools).to.be.an('array').with.lengthOf(1);
      expect(llmRequest.config!.tools![0]).to.have.property('urlContext');
    });

    it('should throw error for Gemini 1.x model', async () => {
      const llmRequest: LlmRequest = {
        model: 'gemini-1.5-pro',
        contents: [],
      };

      try {
        await tool.processLlmRequest({
          toolContext: {} as ToolContext,
          llmRequest,
        });
        expect.fail('Expected an error to be thrown');
      } catch (error) {
        expect((error as Error).message).to.equal(
            'Url context tool cannot be used in Gemini 1.x.',
        );
      }
    });

    it('should throw error for Gemini 1.0 model', async () => {
      const llmRequest: LlmRequest = {
        model: 'gemini-1.0-pro',
        contents: [],
      };

      try {
        await tool.processLlmRequest({
          toolContext: {} as ToolContext,
          llmRequest,
        });
        expect.fail('Expected an error to be thrown');
      } catch (error) {
        expect((error as Error).message).to.equal(
            'Url context tool cannot be used in Gemini 1.x.',
        );
      }
    });

    it('should throw error for non-Gemini model', async () => {
      const llmRequest: LlmRequest = {
        model: 'gpt-4',
        contents: [],
      };

      try {
        await tool.processLlmRequest({
          toolContext: {} as ToolContext,
          llmRequest,
        });
        expect.fail('Expected an error to be thrown');
      } catch (error) {
        expect((error as Error).message).to.equal(
            'Url context tool is not supported for model gpt-4',
        );
      }
    });

    it('should handle path-based model names', async () => {
      const llmRequest: LlmRequest = {
        model: 'projects/123/locations/us-central1/publishers/google/models/gemini-2.0-flash-001',
        contents: [],
      };

      await tool.processLlmRequest({
        toolContext: {} as ToolContext,
        llmRequest,
      });

      expect(llmRequest.config!.tools).to.be.an('array').with.lengthOf(1);
      expect(llmRequest.config!.tools![0]).to.have.property('urlContext');
    });

    it('should append to existing tools array', async () => {
      const llmRequest: LlmRequest = {
        model: 'gemini-2.0-flash-001',
        contents: [],
        config: {
          tools: [{functionDeclarations: [{name: 'test', description: 'test'}]}],
        },
      };

      await tool.processLlmRequest({
        toolContext: {} as ToolContext,
        llmRequest,
      });

      expect(llmRequest.config!.tools).to.be.an('array').with.lengthOf(2);
      expect(llmRequest.config!.tools![1]).to.have.property('urlContext');
    });

    it('should throw error for unknown model', async () => {
      const llmRequest: LlmRequest = {
        model: 'claude-3-opus',
        contents: [],
      };

      try {
        await tool.processLlmRequest({
          toolContext: {} as ToolContext,
          llmRequest,
        });
        expect.fail('Expected an error to be thrown');
      } catch (error) {
        expect((error as Error).message).to.equal(
            'Url context tool is not supported for model claude-3-opus',
        );
      }
    });
  });
});
