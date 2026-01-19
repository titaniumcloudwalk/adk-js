/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Type} from '@google/genai';
import {describe, expect, it} from 'vitest';
import {z} from 'zod';

import {FunctionTool} from '../../src/tools/function_tool.js';
import {
  isZodType,
  zodTypeToSchema,
} from '../../src/utils/simple_zod_to_json.js';

describe('Response Schema Support', () => {
  describe('zodTypeToSchema', () => {
    it('converts string type', () => {
      const schema = zodTypeToSchema(z.string());
      expect(schema).toEqual({type: Type.STRING});
    });

    it('converts string with description', () => {
      const schema = zodTypeToSchema(z.string().describe('A text value'));
      expect(schema).toEqual({
        type: Type.STRING,
        description: 'A text value',
      });
    });

    it('converts number type', () => {
      const schema = zodTypeToSchema(z.number());
      expect(schema).toEqual({type: Type.NUMBER});
    });

    it('converts integer type', () => {
      const schema = zodTypeToSchema(z.number().int());
      expect(schema).toEqual({type: Type.INTEGER});
    });

    it('converts boolean type', () => {
      const schema = zodTypeToSchema(z.boolean());
      expect(schema).toEqual({type: Type.BOOLEAN});
    });

    it('converts array of strings', () => {
      const schema = zodTypeToSchema(z.array(z.string()));
      expect(schema).toEqual({
        type: Type.ARRAY,
        items: {type: Type.STRING},
      });
    });

    it('converts array of numbers', () => {
      const schema = zodTypeToSchema(z.array(z.number()));
      expect(schema).toEqual({
        type: Type.ARRAY,
        items: {type: Type.NUMBER},
      });
    });

    it('converts object type', () => {
      const schema = zodTypeToSchema(
        z.object({
          name: z.string(),
          age: z.number(),
        }),
      );
      expect(schema?.type).toBe(Type.OBJECT);
      expect(schema?.properties).toHaveProperty('name');
      expect(schema?.properties).toHaveProperty('age');
    });

    it('converts enum type', () => {
      const schema = zodTypeToSchema(z.enum(['RED', 'GREEN', 'BLUE']));
      expect(schema).toEqual({
        type: Type.STRING,
        enum: ['RED', 'GREEN', 'BLUE'],
      });
    });

    it('converts literal string', () => {
      const schema = zodTypeToSchema(z.literal('hello'));
      expect(schema).toEqual({
        type: Type.STRING,
        enum: ['hello'],
      });
    });

    it('converts optional type', () => {
      const schema = zodTypeToSchema(z.string().optional());
      expect(schema).toEqual({type: Type.STRING});
    });

    it('converts nullable type', () => {
      const schema = zodTypeToSchema(z.string().nullable());
      expect(schema).toEqual({
        anyOf: [{type: Type.STRING}, {type: Type.NULL}],
      });
    });
  });

  describe('isZodType', () => {
    it('returns true for Zod schemas', () => {
      expect(isZodType(z.string())).toBe(true);
      expect(isZodType(z.number())).toBe(true);
      expect(isZodType(z.boolean())).toBe(true);
      expect(isZodType(z.array(z.string()))).toBe(true);
      expect(isZodType(z.object({}))).toBe(true);
    });

    it('returns false for non-Zod values', () => {
      expect(isZodType(null)).toBe(false);
      expect(isZodType(undefined)).toBe(false);
      expect(isZodType({})).toBe(false);
      expect(isZodType('string')).toBe(false);
      expect(isZodType(123)).toBe(false);
      expect(isZodType({type: Type.STRING})).toBe(false);
    });
  });

  describe('FunctionTool response schema', () => {
    it('includes response schema from Zod string type', () => {
      const tool = new FunctionTool({
        name: 'streaming_tool',
        description: 'A streaming tool that yields strings',
        parameters: z.object({query: z.string()}),
        response: z.string(),
        execute: async function* (args) {
          yield args.query;
        },
      });

      const decl = tool._getDeclaration();
      expect(decl.name).toBe('streaming_tool');
      expect(decl.response).toEqual({type: Type.STRING});
    });

    it('includes response schema from Zod number type', () => {
      const tool = new FunctionTool({
        name: 'counter',
        description: 'A streaming counter',
        parameters: z.object({start: z.number()}),
        response: z.number().int(),
        execute: async function* (args) {
          yield args.start;
        },
      });

      const decl = tool._getDeclaration();
      expect(decl.response).toEqual({type: Type.INTEGER});
    });

    it('includes response schema from Zod object type', () => {
      const tool = new FunctionTool({
        name: 'get_weather',
        description: 'Gets weather for a location',
        parameters: z.object({location: z.string()}),
        response: z.object({
          temperature: z.number(),
          conditions: z.string(),
        }),
        execute: async (args) => ({
          temperature: 72,
          conditions: 'sunny',
        }),
      });

      const decl = tool._getDeclaration();
      expect(decl.response?.type).toBe(Type.OBJECT);
      expect(decl.response?.properties).toHaveProperty('temperature');
      expect(decl.response?.properties).toHaveProperty('conditions');
    });

    it('includes response schema from Zod array type', () => {
      const tool = new FunctionTool({
        name: 'streaming_results',
        description: 'Streams array results',
        parameters: z.object({query: z.string()}),
        response: z.array(z.object({title: z.string(), url: z.string()})),
        execute: async function* (args) {
          yield [{title: 'Result 1', url: 'https://example.com/1'}];
        },
      });

      const decl = tool._getDeclaration();
      expect(decl.response?.type).toBe(Type.ARRAY);
      expect(decl.response?.items?.type).toBe(Type.OBJECT);
    });

    it('includes response schema from raw Schema', () => {
      const tool = new FunctionTool({
        name: 'raw_schema_tool',
        description: 'Uses raw Schema',
        parameters: z.object({input: z.string()}),
        response: {type: Type.STRING, description: 'The result'},
        execute: async (args) => args.input,
      });

      const decl = tool._getDeclaration();
      expect(decl.response).toEqual({type: Type.STRING, description: 'The result'});
    });

    it('omits response when not specified', () => {
      const tool = new FunctionTool({
        name: 'no_response',
        description: 'No response schema',
        execute: async () => 'result',
      });

      const decl = tool._getDeclaration();
      expect(decl.response).toBeUndefined();
    });

    it('handles response schema with description', () => {
      const tool = new FunctionTool({
        name: 'described_response',
        description: 'Tool with described response',
        response: z.string().describe('The search result text'),
        execute: async () => 'result',
      });

      const decl = tool._getDeclaration();
      expect(decl.response).toEqual({
        type: Type.STRING,
        description: 'The search result text',
      });
    });

    it('works with async generator streaming tool', () => {
      async function* streamingSearch(args: {query: string}) {
        yield `Searching for ${args.query}...`;
        yield 'Result 1';
        yield 'Result 2';
      }

      const tool = new FunctionTool({
        name: 'streaming_search',
        description: 'Streams search results',
        parameters: z.object({query: z.string()}),
        response: z.string(),
        execute: streamingSearch,
      });

      // Verify it's detected as a streaming function
      expect(tool.isStreamingFunction).toBe(true);

      // Verify declaration includes response
      const decl = tool._getDeclaration();
      expect(decl.response).toEqual({type: Type.STRING});
    });
  });
});
