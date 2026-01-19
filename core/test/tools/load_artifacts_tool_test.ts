/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Content, GenerateContentConfig, Part, Type} from '@google/genai';
import {describe, expect, it} from 'vitest';

import {LlmRequest} from '../../src/models/llm_request';
import {LoadArtifactsTool, loadArtifactsTool} from '../../src/tools/load_artifacts_tool';
import {ToolContext} from '../../src/tools/tool_context';

/**
 * Mock ToolContext for testing.
 */
class MockToolContext {
  private artifacts: Map<string, Part>;

  constructor(artifacts: Record<string, Part> = {}) {
    this.artifacts = new Map(Object.entries(artifacts));
  }

  async listArtifacts(): Promise<string[]> {
    return Array.from(this.artifacts.keys());
  }

  async loadArtifact(name: string): Promise<Part | undefined> {
    return this.artifacts.get(name);
  }
}

/**
 * Creates a minimal LlmRequest for testing.
 */
function createLlmRequest(contents: Content[]): LlmRequest {
  return {
    model: 'gemini-2.0-flash',
    contents,
    config: {} as GenerateContentConfig,
    toolsDict: {},
  };
}

describe('LoadArtifactsTool', () => {
  describe('constructor', () => {
    it('should create tool with correct name and description', () => {
      const tool = new LoadArtifactsTool();
      expect(tool.name).toBe('load_artifacts');
      expect(tool.description).toContain('Loads artifacts');
    });

    it('should be exported as singleton', () => {
      expect(loadArtifactsTool).toBeInstanceOf(LoadArtifactsTool);
      expect(loadArtifactsTool.name).toBe('load_artifacts');
    });
  });

  describe('_getDeclaration', () => {
    it('should return valid function declaration', () => {
      const tool = new LoadArtifactsTool();
      const declaration = (tool as unknown as {_getDeclaration: () => unknown})._getDeclaration();

      expect(declaration).toBeDefined();
      expect(declaration).toHaveProperty('name', 'load_artifacts');
      expect(declaration).toHaveProperty('description');
      expect(declaration).toHaveProperty('parameters');
      expect((declaration as {parameters: {type: string}}).parameters.type).toBe(Type.OBJECT);
    });
  });

  describe('runAsync', () => {
    it('should return artifact names with status message', async () => {
      const tool = new LoadArtifactsTool();
      const toolContext = new MockToolContext() as unknown as ToolContext;

      const result = await tool.runAsync({
        args: {artifact_names: ['file1.txt', 'file2.txt']},
        toolContext,
      });

      expect(result).toHaveProperty('artifact_names', ['file1.txt', 'file2.txt']);
      expect(result).toHaveProperty('status');
      expect((result as {status: string}).status).toContain('temporarily inserted');
    });

    it('should handle empty artifact names', async () => {
      const tool = new LoadArtifactsTool();
      const toolContext = new MockToolContext() as unknown as ToolContext;

      const result = await tool.runAsync({
        args: {},
        toolContext,
      });

      expect(result).toHaveProperty('artifact_names', []);
    });
  });

  describe('processLlmRequest', () => {
    it('should not modify request when no artifacts exist', async () => {
      const tool = new LoadArtifactsTool();
      const toolContext = new MockToolContext({}) as unknown as ToolContext;
      const llmRequest = createLlmRequest([{role: 'user', parts: [{text: 'hello'}]}]);

      await tool.processLlmRequest({toolContext, llmRequest});

      expect(llmRequest.contents?.length).toBe(1);
    });

    it('should add artifact list instruction when artifacts exist', async () => {
      const tool = new LoadArtifactsTool();
      const toolContext = new MockToolContext({
        'file1.txt': {text: 'content1'},
        'file2.txt': {text: 'content2'},
      }) as unknown as ToolContext;

      const llmRequest = createLlmRequest([{role: 'user', parts: [{text: 'hello'}]}]);

      await tool.processLlmRequest({toolContext, llmRequest});

      // Check that instructions were appended to config.systemInstruction
      expect(llmRequest.config?.systemInstruction).toContain('file1.txt');
      expect(llmRequest.config?.systemInstruction).toContain('file2.txt');
    });

    it('should append artifact content when load_artifacts function response is present', async () => {
      const tool = new LoadArtifactsTool();
      const csvBytes = new TextEncoder().encode('col1,col2\n1,2\n');
      const toolContext = new MockToolContext({
        'test.csv': {
          inlineData: {
            data: csvBytes,
            mimeType: 'application/csv',
          },
        },
      }) as unknown as ToolContext;

      const llmRequest = createLlmRequest([
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'load_artifacts',
                  response: {artifact_names: ['test.csv']},
                },
              },
            ],
          },
        ]);

      await tool.processLlmRequest({toolContext, llmRequest});

      // Should have original content + artifact content
      expect(llmRequest.contents?.length).toBe(2);
      const artifactContent = llmRequest.contents![1];
      expect(artifactContent.role).toBe('user');
      expect(artifactContent.parts?.[0]?.text).toContain('Artifact test.csv is:');
      // CSV should be converted to text
      expect(artifactContent.parts?.[1]?.text).toBe('col1,col2\n1,2\n');
    });

    it('should convert unsupported MIME types to text', async () => {
      const tool = new LoadArtifactsTool();
      const csvContent = 'col1,col2\na,b\n';
      const toolContext = new MockToolContext({
        'data.csv': {
          inlineData: {
            data: new TextEncoder().encode(csvContent),
            mimeType: 'application/csv',
          },
        },
      }) as unknown as ToolContext;

      const llmRequest = createLlmRequest([
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'load_artifacts',
                  response: {artifact_names: ['data.csv']},
                },
              },
            ],
          },
        ]);

      await tool.processLlmRequest({toolContext, llmRequest});

      const artifactPart = llmRequest.contents![1].parts?.[1];
      expect(artifactPart?.text).toBe(csvContent);
      expect(artifactPart?.inlineData).toBeUndefined();
    });

    it('should keep supported MIME types as inline data', async () => {
      const tool = new LoadArtifactsTool();
      const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
      const toolContext = new MockToolContext({
        'doc.pdf': {
          inlineData: {
            data: pdfData,
            mimeType: 'application/pdf',
          },
        },
      }) as unknown as ToolContext;

      const llmRequest = createLlmRequest([
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'load_artifacts',
                  response: {artifact_names: ['doc.pdf']},
                },
              },
            ],
          },
        ]);

      await tool.processLlmRequest({toolContext, llmRequest});

      const artifactPart = llmRequest.contents![1].parts?.[1];
      expect(artifactPart?.inlineData).toBeDefined();
      expect(artifactPart?.inlineData?.mimeType).toBe('application/pdf');
    });

    it('should skip artifacts that are not found', async () => {
      const tool = new LoadArtifactsTool();
      const toolContext = new MockToolContext({}) as unknown as ToolContext;

      const llmRequest = createLlmRequest([
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'load_artifacts',
                  response: {artifact_names: ['nonexistent.txt']},
                },
              },
            ],
          },
        ]);

      await tool.processLlmRequest({toolContext, llmRequest});

      // Should only have original content (no artifact appended)
      expect(llmRequest.contents?.length).toBe(1);
    });

    it('should try user: prefix for cross-session artifacts', async () => {
      const tool = new LoadArtifactsTool();
      const toolContext = new MockToolContext({
        'user:shared.txt': {text: 'shared content'},
      }) as unknown as ToolContext;

      const llmRequest = createLlmRequest([
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'load_artifacts',
                  response: {artifact_names: ['shared.txt']},
                },
              },
            ],
          },
        ]);

      await tool.processLlmRequest({toolContext, llmRequest});

      expect(llmRequest.contents?.length).toBe(2);
      const artifactPart = llmRequest.contents![1].parts?.[1];
      expect(artifactPart?.text).toBe('shared content');
    });

    it('should handle base64 encoded content', async () => {
      const tool = new LoadArtifactsTool();
      const originalText = 'Hello, World!';
      const base64Data = btoa(originalText);

      const toolContext = new MockToolContext({
        'hello.txt': {
          inlineData: {
            data: base64Data,
            mimeType: 'text/plain',
          },
        },
      }) as unknown as ToolContext;

      const llmRequest = createLlmRequest([
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'load_artifacts',
                  response: {artifact_names: ['hello.txt']},
                },
              },
            ],
          },
        ]);

      await tool.processLlmRequest({toolContext, llmRequest});

      const artifactPart = llmRequest.contents![1].parts?.[1];
      expect(artifactPart?.text).toBe(originalText);
    });

    it('should handle binary artifacts with placeholder text', async () => {
      const tool = new LoadArtifactsTool();
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);

      const toolContext = new MockToolContext({
        'data.bin': {
          inlineData: {
            data: binaryData,
            mimeType: 'application/octet-stream',
          },
        },
      }) as unknown as ToolContext;

      const llmRequest = createLlmRequest([
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'load_artifacts',
                  response: {artifact_names: ['data.bin']},
                },
              },
            ],
          },
        ]);

      await tool.processLlmRequest({toolContext, llmRequest});

      const artifactPart = llmRequest.contents![1].parts?.[1];
      expect(artifactPart?.text).toContain('Binary artifact');
      expect(artifactPart?.text).toContain('data.bin');
      expect(artifactPart?.text).toContain('application/octet-stream');
    });

    it('should handle image MIME types as supported', async () => {
      const tool = new LoadArtifactsTool();
      const imageData = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG header

      const toolContext = new MockToolContext({
        'image.png': {
          inlineData: {
            data: imageData,
            mimeType: 'image/png',
          },
        },
      }) as unknown as ToolContext;

      const llmRequest = createLlmRequest([
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'load_artifacts',
                  response: {artifact_names: ['image.png']},
                },
              },
            ],
          },
        ]);

      await tool.processLlmRequest({toolContext, llmRequest});

      const artifactPart = llmRequest.contents![1].parts?.[1];
      expect(artifactPart?.inlineData).toBeDefined();
      expect(artifactPart?.inlineData?.mimeType).toBe('image/png');
    });

    it('should handle JSON MIME type as text-like', async () => {
      const tool = new LoadArtifactsTool();
      const jsonContent = '{"key": "value"}';

      const toolContext = new MockToolContext({
        'data.json': {
          inlineData: {
            data: new TextEncoder().encode(jsonContent),
            mimeType: 'application/json',
          },
        },
      }) as unknown as ToolContext;

      const llmRequest = createLlmRequest([
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'load_artifacts',
                  response: {artifact_names: ['data.json']},
                },
              },
            ],
          },
        ]);

      await tool.processLlmRequest({toolContext, llmRequest});

      const artifactPart = llmRequest.contents![1].parts?.[1];
      expect(artifactPart?.text).toBe(jsonContent);
    });

    it('should handle artifacts without inline data', async () => {
      const tool = new LoadArtifactsTool();

      const toolContext = new MockToolContext({
        'plain.txt': {text: 'plain text content'},
      }) as unknown as ToolContext;

      const llmRequest = createLlmRequest([
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'load_artifacts',
                  response: {artifact_names: ['plain.txt']},
                },
              },
            ],
          },
        ]);

      await tool.processLlmRequest({toolContext, llmRequest});

      const artifactPart = llmRequest.contents![1].parts?.[1];
      expect(artifactPart?.text).toBe('plain text content');
    });

    it('should handle null response gracefully', async () => {
      const tool = new LoadArtifactsTool();
      const toolContext = new MockToolContext({}) as unknown as ToolContext;

      const llmRequest = createLlmRequest([
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: 'load_artifacts',
                  response: null as unknown as Record<string, unknown>,
                },
              },
            ],
          },
        ]);

      await tool.processLlmRequest({toolContext, llmRequest});

      // Should not throw and should have only original content
      expect(llmRequest.contents?.length).toBe(1);
    });
  });
});
