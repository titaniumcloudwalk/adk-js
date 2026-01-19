/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, beforeEach} from 'vitest';
import {
  convertA2aPartToGenaiPart,
  convertGenaiPartToA2aPart,
  A2A_DATA_PART_TEXT_MIME_TYPE,
  A2A_DATA_PART_START_TAG,
  A2A_DATA_PART_END_TAG,
  A2A_DATA_PART_METADATA_TYPE_KEY,
  A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL,
  A2A_DATA_PART_METADATA_TYPE_FUNCTION_RESPONSE,
  A2A_DATA_PART_METADATA_TYPE_CODE_EXECUTION_RESULT,
  A2A_DATA_PART_METADATA_TYPE_EXECUTABLE_CODE,
  type A2ADataPart,
  type A2ATextPart,
  type A2AFilePart,
} from '../../../src/a2a/converters/part_converter.js';
import {getAdkMetadataKey} from '../../../src/a2a/converters/utils.js';

describe('part_converter', () => {
  describe('constants', () => {
    it('should export A2A_DATA_PART_TEXT_MIME_TYPE', () => {
      expect(A2A_DATA_PART_TEXT_MIME_TYPE).toBe('text/plain');
    });

    it('should export A2A_DATA_PART_START_TAG', () => {
      expect(A2A_DATA_PART_START_TAG).toBe('<a2a_datapart_json>');
    });

    it('should export A2A_DATA_PART_END_TAG', () => {
      expect(A2A_DATA_PART_END_TAG).toBe('</a2a_datapart_json>');
    });

    it('should export metadata type constants', () => {
      expect(A2A_DATA_PART_METADATA_TYPE_KEY).toBe('type');
      expect(A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL).toBe('function_call');
      expect(A2A_DATA_PART_METADATA_TYPE_FUNCTION_RESPONSE).toBe(
        'function_response'
      );
      expect(A2A_DATA_PART_METADATA_TYPE_CODE_EXECUTION_RESULT).toBe(
        'code_execution_result'
      );
      expect(A2A_DATA_PART_METADATA_TYPE_EXECUTABLE_CODE).toBe(
        'executable_code'
      );
    });
  });

  describe('convertA2aPartToGenaiPart', () => {
    describe('TextPart conversion', () => {
      it('should convert A2A TextPart to GenAI text Part', () => {
        const textPart: A2ATextPart = {kind: 'text', text: 'Hello world'};
        const result = convertA2aPartToGenaiPart(textPart);

        expect(result).toBeDefined();
        expect(result?.text).toBe('Hello world');
      });

      it('should convert empty text', () => {
        const textPart: A2ATextPart = {kind: 'text', text: ''};
        const result = convertA2aPartToGenaiPart(textPart);

        expect(result).toBeDefined();
        expect(result?.text).toBe('');
      });
    });

    describe('FilePart conversion', () => {
      it('should convert A2A FilePart with URI to GenAI fileData', () => {
        const filePart: A2AFilePart = {
          kind: 'file',
          file: {
            uri: 'gs://bucket/file.pdf',
            mimeType: 'application/pdf',
          },
        };
        const result = convertA2aPartToGenaiPart(filePart);

        expect(result).toBeDefined();
        expect(result?.fileData).toBeDefined();
        expect(result?.fileData?.fileUri).toBe('gs://bucket/file.pdf');
        expect(result?.fileData?.mimeType).toBe('application/pdf');
      });

      it('should convert A2A FilePart with bytes to GenAI inlineData', () => {
        const testData = Buffer.from('Hello').toString('base64');
        const filePart: A2AFilePart = {
          kind: 'file',
          file: {
            bytes: testData,
            mimeType: 'text/plain',
          },
        };
        const result = convertA2aPartToGenaiPart(filePart);

        expect(result).toBeDefined();
        expect(result?.inlineData).toBeDefined();
        expect(result?.inlineData?.mimeType).toBe('text/plain');
      });
    });

    describe('DataPart conversion to inline_data', () => {
      it('should convert DataPart without special metadata to inline_data', () => {
        const data = {key: 'value', number: 123};
        const dataPart: A2ADataPart = {
          kind: 'data',
          data: data,
          metadata: {other: 'metadata'},
        };

        const result = convertA2aPartToGenaiPart(dataPart);

        expect(result).toBeDefined();
        expect(result?.inlineData).toBeDefined();
        expect(result?.inlineData?.mimeType).toBe(A2A_DATA_PART_TEXT_MIME_TYPE);

        // Decode and verify the wrapped data
        const decodedData = Buffer.from(
          result?.inlineData?.data ?? '',
          'base64'
        ).toString('utf-8');
        expect(decodedData.startsWith(A2A_DATA_PART_START_TAG)).toBe(true);
        expect(decodedData.endsWith(A2A_DATA_PART_END_TAG)).toBe(true);

        // Extract and parse the JSON
        const jsonData = decodedData.slice(
          A2A_DATA_PART_START_TAG.length,
          -A2A_DATA_PART_END_TAG.length
        );
        const parsed = JSON.parse(jsonData) as A2ADataPart;
        expect(parsed.kind).toBe('data');
        expect(parsed.data).toEqual(data);
        expect(parsed.metadata).toEqual({other: 'metadata'});
      });

      it('should convert DataPart with no metadata to inline_data', () => {
        const data = {key: 'value', array: [1, 2, 3]};
        const dataPart: A2ADataPart = {
          kind: 'data',
          data: data,
        };

        const result = convertA2aPartToGenaiPart(dataPart);

        expect(result).toBeDefined();
        expect(result?.inlineData).toBeDefined();
        expect(result?.inlineData?.mimeType).toBe(A2A_DATA_PART_TEXT_MIME_TYPE);
      });

      it('should convert DataPart with complex nested data', () => {
        const complexData = {
          nested: {
            array: [1, 2, {inner: 'value'}],
            boolean: true,
            nullValue: null,
          },
          unicode: 'Hello \\u4e16\\u754c \\ud83c\\udf0d', // Escaped for JSON
        };
        const dataPart: A2ADataPart = {
          kind: 'data',
          data: complexData,
        };

        const result = convertA2aPartToGenaiPart(dataPart);

        expect(result).toBeDefined();
        expect(result?.inlineData).toBeDefined();

        // Verify round-trip
        const decodedData = Buffer.from(
          result?.inlineData?.data ?? '',
          'base64'
        ).toString('utf-8');
        const jsonData = decodedData.slice(
          A2A_DATA_PART_START_TAG.length,
          -A2A_DATA_PART_END_TAG.length
        );
        const parsed = JSON.parse(jsonData) as A2ADataPart;
        expect(parsed.data).toEqual(complexData);
      });

      it('should convert DataPart with empty metadata dict', () => {
        const data = {key: 'value'};
        const dataPart: A2ADataPart = {
          kind: 'data',
          data: data,
          metadata: {},
        };

        const result = convertA2aPartToGenaiPart(dataPart);

        expect(result).toBeDefined();
        expect(result?.inlineData).toBeDefined();
      });
    });

    describe('DataPart with ADK metadata conversion', () => {
      it('should convert DataPart with function_call metadata to functionCall', () => {
        const dataPart: A2ADataPart = {
          kind: 'data',
          data: {
            name: 'test_function',
            args: {arg1: 'value1'},
            id: 'call-123',
          },
          metadata: {
            [getAdkMetadataKey(
              A2A_DATA_PART_METADATA_TYPE_KEY
            )]: A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL,
          },
        };

        const result = convertA2aPartToGenaiPart(dataPart);

        expect(result).toBeDefined();
        expect(result?.functionCall).toBeDefined();
        expect(result?.functionCall?.name).toBe('test_function');
        expect(result?.functionCall?.args).toEqual({arg1: 'value1'});
        expect(result?.functionCall?.id).toBe('call-123');
      });

      it('should convert DataPart with function_response metadata to functionResponse', () => {
        const dataPart: A2ADataPart = {
          kind: 'data',
          data: {
            name: 'test_function',
            response: {result: 'success'},
            id: 'resp-123',
          },
          metadata: {
            [getAdkMetadataKey(
              A2A_DATA_PART_METADATA_TYPE_KEY
            )]: A2A_DATA_PART_METADATA_TYPE_FUNCTION_RESPONSE,
          },
        };

        const result = convertA2aPartToGenaiPart(dataPart);

        expect(result).toBeDefined();
        expect(result?.functionResponse).toBeDefined();
        expect(result?.functionResponse?.name).toBe('test_function');
        expect(result?.functionResponse?.response).toEqual({result: 'success'});
      });

      it('should convert DataPart with code_execution_result metadata', () => {
        const dataPart: A2ADataPart = {
          kind: 'data',
          data: {
            outcome: 'OUTCOME_OK',
            output: 'Hello World',
          },
          metadata: {
            [getAdkMetadataKey(
              A2A_DATA_PART_METADATA_TYPE_KEY
            )]: A2A_DATA_PART_METADATA_TYPE_CODE_EXECUTION_RESULT,
          },
        };

        const result = convertA2aPartToGenaiPart(dataPart);

        expect(result).toBeDefined();
        expect(result?.codeExecutionResult).toBeDefined();
        expect(result?.codeExecutionResult?.outcome).toBe('OUTCOME_OK');
        expect(result?.codeExecutionResult?.output).toBe('Hello World');
      });

      it('should convert DataPart with executable_code metadata', () => {
        const dataPart: A2ADataPart = {
          kind: 'data',
          data: {
            language: 'PYTHON',
            code: 'print("Hello")',
          },
          metadata: {
            [getAdkMetadataKey(
              A2A_DATA_PART_METADATA_TYPE_KEY
            )]: A2A_DATA_PART_METADATA_TYPE_EXECUTABLE_CODE,
          },
        };

        const result = convertA2aPartToGenaiPart(dataPart);

        expect(result).toBeDefined();
        expect(result?.executableCode).toBeDefined();
        expect(result?.executableCode?.language).toBe('PYTHON');
        expect(result?.executableCode?.code).toBe('print("Hello")');
      });
    });
  });

  describe('convertGenaiPartToA2aPart', () => {
    describe('text Part conversion', () => {
      it('should convert GenAI text Part to A2A TextPart', () => {
        const genaiPart = {text: 'Hello world'};
        const result = convertGenaiPartToA2aPart(genaiPart);

        expect(result).toBeDefined();
        expect(result?.kind).toBe('text');
        expect((result as A2ATextPart).text).toBe('Hello world');
      });

      it('should convert empty text', () => {
        const genaiPart = {text: ''};
        const result = convertGenaiPartToA2aPart(genaiPart);

        expect(result).toBeDefined();
        expect(result?.kind).toBe('text');
        expect((result as A2ATextPart).text).toBe('');
      });

      it('should preserve thought metadata', () => {
        const genaiPart = {text: 'Thinking...', thought: true} as any;
        const result = convertGenaiPartToA2aPart(genaiPart);

        expect(result).toBeDefined();
        expect(result?.kind).toBe('text');
        expect(result?.metadata?.[getAdkMetadataKey('thought')]).toBe(true);
      });
    });

    describe('inline_data Part conversion to DataPart', () => {
      it('should convert wrapped DataPart from inline_data', () => {
        const dataPart: A2ADataPart = {
          kind: 'data',
          data: {key: 'value'},
          metadata: {meta: 'data'},
        };
        const jsonData = JSON.stringify(dataPart);
        const wrappedData = `${A2A_DATA_PART_START_TAG}${jsonData}${A2A_DATA_PART_END_TAG}`;

        const genaiPart = {
          inlineData: {
            data: Buffer.from(wrappedData).toString('base64'),
            mimeType: A2A_DATA_PART_TEXT_MIME_TYPE,
          },
        };

        const result = convertGenaiPartToA2aPart(genaiPart);

        expect(result).toBeDefined();
        expect(result?.kind).toBe('data');
        expect((result as A2ADataPart).data).toEqual({key: 'value'});
        expect((result as A2ADataPart).metadata).toEqual({meta: 'data'});
      });

      it('should convert regular inline_data to FilePart', () => {
        const genaiPart = {
          inlineData: {
            data: Buffer.from('image data').toString('base64'),
            mimeType: 'image/png',
          },
        };

        const result = convertGenaiPartToA2aPart(genaiPart);

        expect(result).toBeDefined();
        expect(result?.kind).toBe('file');
        expect((result as A2AFilePart).file).toBeDefined();
      });

      it('should handle inline_data with mimeType in DataPart metadata', () => {
        const dataPart: A2ADataPart = {
          kind: 'data',
          data: {key: 'value'},
          metadata: {adkType: 'some_type', mimeType: 'image/png'},
        };
        const jsonData = JSON.stringify(dataPart);
        const wrappedData = `${A2A_DATA_PART_START_TAG}${jsonData}${A2A_DATA_PART_END_TAG}`;

        const genaiPart = {
          inlineData: {
            data: Buffer.from(wrappedData).toString('base64'),
            mimeType: A2A_DATA_PART_TEXT_MIME_TYPE,
          },
        };

        const result = convertGenaiPartToA2aPart(genaiPart);

        expect(result).toBeDefined();
        expect(result?.kind).toBe('data');
        // The mimeType key in metadata should be preserved
        expect((result as A2ADataPart).metadata?.mimeType).toBe('image/png');
      });
    });

    describe('functionCall Part conversion', () => {
      it('should convert functionCall to A2A DataPart', () => {
        const genaiPart = {
          functionCall: {
            name: 'test_function',
            args: {arg1: 'value1'},
            id: 'call-123',
          },
        };

        const result = convertGenaiPartToA2aPart(genaiPart);

        expect(result).toBeDefined();
        expect(result?.kind).toBe('data');
        expect((result as A2ADataPart).data.name).toBe('test_function');
        expect((result as A2ADataPart).data.args).toEqual({arg1: 'value1'});
        expect(
          result?.metadata?.[getAdkMetadataKey(A2A_DATA_PART_METADATA_TYPE_KEY)]
        ).toBe(A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL);
      });
    });

    describe('functionResponse Part conversion', () => {
      it('should convert functionResponse to A2A DataPart', () => {
        const genaiPart = {
          functionResponse: {
            name: 'test_function',
            response: {result: 'success'},
            id: 'resp-123',
          },
        };

        const result = convertGenaiPartToA2aPart(genaiPart);

        expect(result).toBeDefined();
        expect(result?.kind).toBe('data');
        expect((result as A2ADataPart).data.name).toBe('test_function');
        expect((result as A2ADataPart).data.response).toEqual({
          result: 'success',
        });
        expect(
          result?.metadata?.[getAdkMetadataKey(A2A_DATA_PART_METADATA_TYPE_KEY)]
        ).toBe(A2A_DATA_PART_METADATA_TYPE_FUNCTION_RESPONSE);
      });
    });
  });

  describe('Round-trip conversions', () => {
    it('should round-trip DataPart with data and metadata', () => {
      const data = {key: 'value'};
      const metadata = {meta: 'data'};
      const originalPart: A2ADataPart = {
        kind: 'data',
        data: data,
        metadata: metadata,
      };

      // A2A -> GenAI -> A2A
      const genaiPart = convertA2aPartToGenaiPart(originalPart);
      expect(genaiPart).toBeDefined();

      const roundTrippedPart = convertGenaiPartToA2aPart(genaiPart!);

      expect(roundTrippedPart).toBeDefined();
      expect(roundTrippedPart?.kind).toBe('data');
      expect((roundTrippedPart as A2ADataPart).data).toEqual(data);
      expect((roundTrippedPart as A2ADataPart).metadata).toEqual(metadata);
    });

    it('should round-trip DataPart with mimeType in metadata', () => {
      const data = {content: 'some data'};
      const metadata = {meta: 'data', mimeType: 'application/json'};
      const originalPart: A2ADataPart = {
        kind: 'data',
        data: data,
        metadata: metadata,
      };

      // A2A -> GenAI -> A2A
      const genaiPart = convertA2aPartToGenaiPart(originalPart);
      expect(genaiPart).toBeDefined();

      const roundTrippedPart = convertGenaiPartToA2aPart(genaiPart!);

      expect(roundTrippedPart).toBeDefined();
      expect(roundTrippedPart?.kind).toBe('data');
      expect((roundTrippedPart as A2ADataPart).data).toEqual(data);
      // The 'mimeType' key in the metadata should be preserved as is
      expect((roundTrippedPart as A2ADataPart).metadata).toEqual(metadata);
    });

    it('should round-trip TextPart', () => {
      const originalPart: A2ATextPart = {
        kind: 'text',
        text: 'Hello world',
      };

      const genaiPart = convertA2aPartToGenaiPart(originalPart);
      expect(genaiPart).toBeDefined();

      const roundTrippedPart = convertGenaiPartToA2aPart(genaiPart!);

      expect(roundTrippedPart).toBeDefined();
      expect(roundTrippedPart?.kind).toBe('text');
      expect((roundTrippedPart as A2ATextPart).text).toBe('Hello world');
    });

    it('should round-trip function_call DataPart', () => {
      const originalPart: A2ADataPart = {
        kind: 'data',
        data: {
          name: 'test_function',
          args: {arg1: 'value1'},
          id: 'call-123',
        },
        metadata: {
          [getAdkMetadataKey(
            A2A_DATA_PART_METADATA_TYPE_KEY
          )]: A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL,
        },
      };

      const genaiPart = convertA2aPartToGenaiPart(originalPart);
      expect(genaiPart).toBeDefined();
      expect(genaiPart?.functionCall).toBeDefined();

      const roundTrippedPart = convertGenaiPartToA2aPart(genaiPart!);

      expect(roundTrippedPart).toBeDefined();
      expect(roundTrippedPart?.kind).toBe('data');
      expect((roundTrippedPart as A2ADataPart).data.name).toBe('test_function');
      expect((roundTrippedPart as A2ADataPart).data.args).toEqual({
        arg1: 'value1',
      });
    });
  });
});
