/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {expect} from 'chai';

import {
  Content,
  FunctionCall,
  FunctionResponse,
  Outcome,
  Part,
} from '@google/genai';

import {
  buildGenerationConfig,
  buildInteractionsEventLog,
  buildInteractionsRequestLog,
  buildInteractionsResponseLog,
  convertContentToTurn,
  convertContentsToTurns,
  convertInteractionEventToLlmResponse,
  convertInteractionOutputToPart,
  convertInteractionToLlmResponse,
  convertPartToInteractionContent,
  convertToolsConfigToInteractionsFormat,
  extractSystemInstruction,
  getLatestUserContents,
  Interaction,
  InteractionOutput,
  InteractionSSEEvent,
  TurnParam,
} from '../../src/models/interactions_utils.js';

describe('interactions_utils', () => {
  describe('convertPartToInteractionContent', () => {
    it('should convert text part', () => {
      const part: Part = {text: 'Hello, world!'};
      const result = convertPartToInteractionContent(part);
      expect(result).to.deep.equal({type: 'text', text: 'Hello, world!'});
    });

    it('should convert empty text part', () => {
      const part: Part = {text: ''};
      const result = convertPartToInteractionContent(part);
      expect(result).to.deep.equal({type: 'text', text: ''});
    });

    it('should convert function_call part', () => {
      const part: Part = {
        functionCall: {
          id: 'call-123',
          name: 'search',
          args: {query: 'test'},
        } as FunctionCall,
      };
      const result = convertPartToInteractionContent(part);
      expect(result).to.deep.equal({
        type: 'function_call',
        id: 'call-123',
        name: 'search',
        arguments: {query: 'test'},
      });
    });

    it('should convert function_response part with dict result', () => {
      const part: Part = {
        functionResponse: {
          id: 'call-123',
          name: 'search',
          response: {results: ['item1', 'item2']},
        } as FunctionResponse,
      };
      const result = convertPartToInteractionContent(part);
      expect(result).to.deep.equal({
        type: 'function_result',
        name: 'search',
        call_id: 'call-123',
        result: '{"results":["item1","item2"]}',
      });
    });

    it('should convert function_response part with string result', () => {
      const part: Part = {
        functionResponse: {
          id: 'call-123',
          name: 'echo',
          response: 'Hello',
        } as unknown as FunctionResponse,
      };
      const result = convertPartToInteractionContent(part);
      expect(result).to.deep.equal({
        type: 'function_result',
        name: 'echo',
        call_id: 'call-123',
        result: 'Hello',
      });
    });

    it('should convert inline_data image part', () => {
      const part: Part = {
        inlineData: {
          data: 'base64data',
          mimeType: 'image/png',
        },
      };
      const result = convertPartToInteractionContent(part);
      expect(result).to.deep.equal({
        type: 'image',
        data: 'base64data',
        mime_type: 'image/png',
      });
    });

    it('should convert inline_data audio part', () => {
      const part: Part = {
        inlineData: {
          data: 'audiodata',
          mimeType: 'audio/mp3',
        },
      };
      const result = convertPartToInteractionContent(part);
      expect(result).to.deep.equal({
        type: 'audio',
        data: 'audiodata',
        mime_type: 'audio/mp3',
      });
    });

    it('should convert inline_data video part', () => {
      const part: Part = {
        inlineData: {
          data: 'videodata',
          mimeType: 'video/mp4',
        },
      };
      const result = convertPartToInteractionContent(part);
      expect(result).to.deep.equal({
        type: 'video',
        data: 'videodata',
        mime_type: 'video/mp4',
      });
    });

    it('should convert inline_data document part', () => {
      const part: Part = {
        inlineData: {
          data: 'pdfdata',
          mimeType: 'application/pdf',
        },
      };
      const result = convertPartToInteractionContent(part);
      expect(result).to.deep.equal({
        type: 'document',
        data: 'pdfdata',
        mime_type: 'application/pdf',
      });
    });

    it('should convert file_data image part', () => {
      const part: Part = {
        fileData: {
          fileUri: 'gs://bucket/image.png',
          mimeType: 'image/png',
        },
      };
      const result = convertPartToInteractionContent(part);
      expect(result).to.deep.equal({
        type: 'image',
        uri: 'gs://bucket/image.png',
        mime_type: 'image/png',
      });
    });

    it('should convert code_execution_result part', () => {
      const part: Part = {
        codeExecutionResult: {
          output: 'print output',
          outcome: Outcome.OUTCOME_OK,
        },
      };
      const result = convertPartToInteractionContent(part);
      expect(result).to.deep.equal({
        type: 'code_execution_result',
        call_id: '',
        result: 'print output',
        is_error: false,
      });
    });

    it('should convert failed code_execution_result part', () => {
      const part: Part = {
        codeExecutionResult: {
          output: 'Error: division by zero',
          outcome: Outcome.OUTCOME_FAILED,
        },
      };
      const result = convertPartToInteractionContent(part);
      expect(result).to.deep.equal({
        type: 'code_execution_result',
        call_id: '',
        result: 'Error: division by zero',
        is_error: true,
      });
    });

    it('should convert executable_code part', () => {
      const part: Part = {
        executableCode: {
          code: 'print("hello")',
          language: 'PYTHON',
        },
      };
      const result = convertPartToInteractionContent(part);
      expect(result).to.deep.equal({
        type: 'code_execution_call',
        id: '',
        arguments: {
          code: 'print("hello")',
          language: 'PYTHON',
        },
      });
    });

    it('should return null for unsupported part', () => {
      const part: Part = {} as Part;
      const result = convertPartToInteractionContent(part);
      expect(result).to.be.null;
    });
  });

  describe('convertContentToTurn', () => {
    it('should convert content with single text part', () => {
      const content: Content = {
        role: 'user',
        parts: [{text: 'Hello'}],
      };
      const result = convertContentToTurn(content);
      expect(result).to.deep.equal({
        role: 'user',
        content: [{type: 'text', text: 'Hello'}],
      });
    });

    it('should convert content with multiple parts', () => {
      const content: Content = {
        role: 'model',
        parts: [
          {text: 'Here is the result:'},
          {
            functionCall: {
              id: 'call-1',
              name: 'search',
              args: {q: 'test'},
            } as FunctionCall,
          },
        ],
      };
      const result = convertContentToTurn(content);
      expect(result).to.deep.equal({
        role: 'model',
        content: [
          {type: 'text', text: 'Here is the result:'},
          {
            type: 'function_call',
            id: 'call-1',
            name: 'search',
            arguments: {q: 'test'},
          },
        ],
      });
    });

    it('should use default role if not specified', () => {
      const content: Content = {
        parts: [{text: 'Hello'}],
      } as Content;
      const result = convertContentToTurn(content);
      expect(result.role).to.equal('user');
    });

    it('should filter out unsupported parts', () => {
      const content: Content = {
        role: 'user',
        parts: [{text: 'Hello'}, {} as Part],
      };
      const result = convertContentToTurn(content);
      expect(result.content).to.have.length(1);
    });
  });

  describe('convertContentsToTurns', () => {
    it('should convert multiple contents', () => {
      const contents: Content[] = [
        {role: 'user', parts: [{text: 'Hi'}]},
        {role: 'model', parts: [{text: 'Hello!'}]},
        {role: 'user', parts: [{text: 'How are you?'}]},
      ];
      const result = convertContentsToTurns(contents);
      expect(result).to.have.length(3);
      expect(result[0]).to.deep.equal({
        role: 'user',
        content: [{type: 'text', text: 'Hi'}],
      });
    });

    it('should filter out empty contents', () => {
      const contents: Content[] = [
        {role: 'user', parts: [{text: 'Hi'}]},
        {role: 'model', parts: []},
        {role: 'user', parts: [{text: 'Hello'}]},
      ];
      const result = convertContentsToTurns(contents);
      expect(result).to.have.length(2);
    });
  });

  describe('convertToolsConfigToInteractionsFormat', () => {
    it('should return empty array when no tools', () => {
      const result = convertToolsConfigToInteractionsFormat(undefined);
      expect(result).to.deep.equal([]);
    });

    it('should convert function declarations', () => {
      const config = {
        tools: [
          {
            functionDeclarations: [
              {
                name: 'search',
                description: 'Search the web',
                parameters: {
                  type: 'object',
                  properties: {
                    query: {type: 'string'},
                  },
                  required: ['query'],
                },
              },
            ],
          },
        ],
      };
      const result = convertToolsConfigToInteractionsFormat(config);
      expect(result).to.have.length(1);
      expect(result[0].type).to.equal('function');
      expect(result[0].name).to.equal('search');
      expect(result[0].description).to.equal('Search the web');
    });

    it('should convert google_search tool', () => {
      const config = {
        tools: [{googleSearch: {}}],
      };
      const result = convertToolsConfigToInteractionsFormat(config);
      expect(result).to.deep.equal([{type: 'google_search'}]);
    });

    it('should convert code_execution tool', () => {
      const config = {
        tools: [{codeExecution: {}}],
      };
      const result = convertToolsConfigToInteractionsFormat(config);
      expect(result).to.deep.equal([{type: 'code_execution'}]);
    });
  });

  describe('convertInteractionOutputToPart', () => {
    it('should convert text output', () => {
      const output: InteractionOutput = {type: 'text', text: 'Hello'};
      const result = convertInteractionOutputToPart(output);
      expect(result).to.deep.equal({text: 'Hello'});
    });

    it('should convert function_call output', () => {
      const output: InteractionOutput = {
        type: 'function_call',
        id: 'call-1',
        name: 'search',
        arguments: {q: 'test'},
      };
      const result = convertInteractionOutputToPart(output);
      expect(result).to.not.be.null;
      expect(result!.functionCall).to.deep.include({
        id: 'call-1',
        name: 'search',
      });
    });

    it('should convert function_result output', () => {
      const output: InteractionOutput = {
        type: 'function_result',
        call_id: 'call-1',
        result: 'result data',
      };
      const result = convertInteractionOutputToPart(output);
      expect(result).to.not.be.null;
      expect(result!.functionResponse).to.deep.include({
        id: 'call-1',
        response: 'result data',
      });
    });

    it('should convert image output with data', () => {
      const output: InteractionOutput = {
        type: 'image',
        data: 'base64data',
        mime_type: 'image/png',
      };
      const result = convertInteractionOutputToPart(output);
      expect(result).to.deep.equal({
        inlineData: {
          data: 'base64data',
          mimeType: 'image/png',
        },
      });
    });

    it('should convert image output with uri', () => {
      const output: InteractionOutput = {
        type: 'image',
        uri: 'https://example.com/image.png',
        mime_type: 'image/png',
      };
      const result = convertInteractionOutputToPart(output);
      expect(result).to.deep.equal({
        fileData: {
          fileUri: 'https://example.com/image.png',
          mimeType: 'image/png',
        },
      });
    });

    it('should convert code_execution_result output', () => {
      const output: InteractionOutput = {
        type: 'code_execution_result',
        result: 'output text',
        is_error: false,
      };
      const result = convertInteractionOutputToPart(output);
      expect(result).to.not.be.null;
      expect(result!.codeExecutionResult).to.deep.include({
        output: 'output text',
        outcome: Outcome.OUTCOME_OK,
      });
    });

    it('should return null for thought output', () => {
      const output: InteractionOutput = {type: 'thought'};
      const result = convertInteractionOutputToPart(output);
      expect(result).to.be.null;
    });

    it('should return null for unknown output type', () => {
      const output: InteractionOutput = {type: 'unknown'};
      const result = convertInteractionOutputToPart(output);
      expect(result).to.be.null;
    });
  });

  describe('convertInteractionToLlmResponse', () => {
    it('should convert completed interaction', () => {
      const interaction: Interaction = {
        id: 'interaction-123',
        status: 'completed',
        outputs: [{type: 'text', text: 'Hello!'}],
        usage: {
          total_input_tokens: 10,
          total_output_tokens: 5,
        },
      };
      const result = convertInteractionToLlmResponse(interaction);
      expect(result.interactionId).to.equal('interaction-123');
      expect(result.turnComplete).to.be.true;
      expect(result.content?.parts?.[0]).to.deep.equal({text: 'Hello!'});
      expect(result.usageMetadata?.promptTokenCount).to.equal(10);
      expect(result.usageMetadata?.candidatesTokenCount).to.equal(5);
    });

    it('should convert requires_action interaction', () => {
      const interaction: Interaction = {
        id: 'interaction-456',
        status: 'requires_action',
        outputs: [
          {
            type: 'function_call',
            id: 'call-1',
            name: 'search',
            arguments: {q: 'test'},
          },
        ],
      };
      const result = convertInteractionToLlmResponse(interaction);
      expect(result.turnComplete).to.be.true;
      expect(result.content?.parts).to.have.length(1);
      expect(result.content?.parts?.[0].functionCall).to.exist;
    });

    it('should handle failed interaction', () => {
      const interaction: Interaction = {
        id: 'interaction-789',
        status: 'failed',
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests',
        },
      };
      const result = convertInteractionToLlmResponse(interaction);
      expect(result.errorCode).to.equal('RATE_LIMITED');
      expect(result.errorMessage).to.equal('Too many requests');
      expect(result.interactionId).to.equal('interaction-789');
    });

    it('should handle in_progress interaction', () => {
      const interaction: Interaction = {
        id: 'interaction-000',
        status: 'in_progress',
        outputs: [{type: 'text', text: 'Partial'}],
      };
      const result = convertInteractionToLlmResponse(interaction);
      expect(result.turnComplete).to.be.false;
      expect(result.finishReason).to.be.undefined;
    });
  });

  describe('convertInteractionEventToLlmResponse', () => {
    it('should handle text delta event', () => {
      const event: InteractionSSEEvent = {
        event_type: 'content.delta',
        delta: {type: 'text', text: 'Hello'},
      };
      const aggregatedParts: Part[] = [];
      const result = convertInteractionEventToLlmResponse(
        event,
        aggregatedParts,
        'int-123',
      );
      expect(result).to.not.be.null;
      expect(result!.partial).to.be.true;
      expect(result!.content?.parts?.[0]).to.deep.equal({text: 'Hello'});
      expect(aggregatedParts).to.have.length(1);
    });

    it('should accumulate function_call but not yield', () => {
      const event: InteractionSSEEvent = {
        event_type: 'content.delta',
        delta: {
          type: 'function_call',
          id: 'call-1',
          name: 'search',
          arguments: {q: 'test'},
        },
      };
      const aggregatedParts: Part[] = [];
      const result = convertInteractionEventToLlmResponse(
        event,
        aggregatedParts,
        'int-123',
      );
      expect(result).to.be.null;
      expect(aggregatedParts).to.have.length(1);
      expect(aggregatedParts[0].functionCall).to.exist;
    });

    it('should handle content.stop event', () => {
      const aggregatedParts: Part[] = [{text: 'Hello'}, {text: ' world'}];
      const event: InteractionSSEEvent = {event_type: 'content.stop'};
      const result = convertInteractionEventToLlmResponse(
        event,
        aggregatedParts,
        'int-123',
      );
      expect(result).to.not.be.null;
      expect(result!.partial).to.be.false;
      expect(result!.content?.parts).to.have.length(2);
    });

    it('should handle status_update completed event', () => {
      const aggregatedParts: Part[] = [{text: 'Done'}];
      const event: InteractionSSEEvent = {
        event_type: 'interaction.status_update',
        status: 'completed',
      };
      const result = convertInteractionEventToLlmResponse(
        event,
        aggregatedParts,
        'int-123',
      );
      expect(result).to.not.be.null;
      expect(result!.turnComplete).to.be.true;
      expect(result!.interactionId).to.equal('int-123');
    });

    it('should handle error event', () => {
      const event: InteractionSSEEvent = {
        event_type: 'error',
        error: {code: 'ERROR_CODE', message: 'Error message'},
      };
      const result = convertInteractionEventToLlmResponse(event, [], 'int-123');
      expect(result).to.not.be.null;
      expect(result!.errorCode).to.equal('ERROR_CODE');
      expect(result!.errorMessage).to.equal('Error message');
    });
  });

  describe('buildGenerationConfig', () => {
    it('should return empty object for undefined config', () => {
      const result = buildGenerationConfig(undefined);
      expect(result).to.deep.equal({});
    });

    it('should extract generation parameters', () => {
      const config = {
        temperature: 0.7,
        topP: 0.9,
        topK: 40,
        maxOutputTokens: 1000,
        stopSequences: ['END'],
        presencePenalty: 0.5,
        frequencyPenalty: 0.3,
      };
      const result = buildGenerationConfig(config);
      expect(result).to.deep.equal({
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        max_output_tokens: 1000,
        stop_sequences: ['END'],
        presence_penalty: 0.5,
        frequency_penalty: 0.3,
      });
    });

    it('should skip undefined values', () => {
      const config = {temperature: 0.5};
      const result = buildGenerationConfig(config);
      expect(result).to.deep.equal({temperature: 0.5});
      expect(result).to.not.have.property('top_p');
    });
  });

  describe('extractSystemInstruction', () => {
    it('should return null for undefined config', () => {
      const result = extractSystemInstruction(undefined);
      expect(result).to.be.null;
    });

    it('should return string system instruction', () => {
      const config = {systemInstruction: 'You are a helpful assistant'};
      const result = extractSystemInstruction(config);
      expect(result).to.equal('You are a helpful assistant');
    });

    it('should extract text from Content system instruction', () => {
      const config = {
        systemInstruction: {
          role: 'system',
          parts: [{text: 'Part 1'}, {text: 'Part 2'}],
        } as Content,
      };
      const result = extractSystemInstruction(config);
      expect(result).to.equal('Part 1\nPart 2');
    });

    it('should return null for empty Content', () => {
      const config = {
        systemInstruction: {
          role: 'system',
          parts: [],
        } as Content,
      };
      const result = extractSystemInstruction(config);
      expect(result).to.be.null;
    });
  });

  describe('getLatestUserContents', () => {
    it('should return empty array for empty contents', () => {
      const result = getLatestUserContents([]);
      expect(result).to.deep.equal([]);
    });

    it('should return latest user contents', () => {
      const contents: Content[] = [
        {role: 'user', parts: [{text: 'First'}]},
        {role: 'model', parts: [{text: 'Response'}]},
        {role: 'user', parts: [{text: 'Second'}]},
        {role: 'user', parts: [{text: 'Third'}]},
      ];
      const result = getLatestUserContents(contents);
      expect(result).to.have.length(2);
      expect(result[0].parts?.[0].text).to.equal('Second');
      expect(result[1].parts?.[0].text).to.equal('Third');
    });

    it('should include preceding model content with function_call when user has function_result', () => {
      const contents: Content[] = [
        {role: 'user', parts: [{text: 'Search for cats'}]},
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                id: 'call-1',
                name: 'search',
                args: {q: 'cats'},
              } as FunctionCall,
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                id: 'call-1',
                name: 'search',
                response: {results: []},
              } as FunctionResponse,
            },
          ],
        },
      ];
      const result = getLatestUserContents(contents);
      expect(result).to.have.length(2);
      expect(result[0].role).to.equal('model');
      expect(result[0].parts?.[0].functionCall).to.exist;
      expect(result[1].role).to.equal('user');
      expect(result[1].parts?.[0].functionResponse).to.exist;
    });

    it('should not include model content when user has no function_result', () => {
      const contents: Content[] = [
        {role: 'user', parts: [{text: 'Hello'}]},
        {role: 'model', parts: [{text: 'Hi there!'}]},
        {role: 'user', parts: [{text: 'How are you?'}]},
      ];
      const result = getLatestUserContents(contents);
      expect(result).to.have.length(1);
      expect(result[0].parts?.[0].text).to.equal('How are you?');
    });
  });

  describe('buildInteractionsRequestLog', () => {
    it('should format request log', () => {
      const turns: TurnParam[] = [
        {role: 'user', content: [{type: 'text', text: 'Hello'}]},
      ];
      const log = buildInteractionsRequestLog(
        'gemini-2.0-flash',
        turns,
        'You are helpful',
        [{type: 'function', name: 'search'}],
        {temperature: 0.5},
        'prev-int-123',
        true,
      );
      expect(log).to.include('Model: gemini-2.0-flash');
      expect(log).to.include('Stream: true');
      expect(log).to.include('Previous Interaction ID: prev-int-123');
      expect(log).to.include('You are helpful');
      expect(log).to.include('[user]: text: "Hello"');
    });

    it('should truncate long text', () => {
      const longText = 'A'.repeat(300);
      const turns: TurnParam[] = [
        {role: 'user', content: [{type: 'text', text: longText}]},
      ];
      const log = buildInteractionsRequestLog(
        'model',
        turns,
        null,
        null,
        null,
        null,
        false,
      );
      expect(log).to.include('...');
    });
  });

  describe('buildInteractionsResponseLog', () => {
    it('should format response log', () => {
      const interaction: Interaction = {
        id: 'int-123',
        status: 'completed',
        outputs: [{type: 'text', text: 'Hello!'}],
        usage: {total_input_tokens: 10, total_output_tokens: 5},
      };
      const log = buildInteractionsResponseLog(interaction);
      expect(log).to.include('Interaction ID: int-123');
      expect(log).to.include('Status: completed');
      expect(log).to.include('text: "Hello!"');
      expect(log).to.include('input_tokens: 10');
    });
  });

  describe('buildInteractionsEventLog', () => {
    it('should format text delta event log', () => {
      const event: InteractionSSEEvent = {
        event_type: 'content.delta',
        id: 'evt-1',
        delta: {type: 'text', text: 'Hello'},
      };
      const log = buildInteractionsEventLog(event);
      expect(log).to.include('content.delta');
      expect(log).to.include('(id: evt-1)');
      expect(log).to.include('text: "Hello"');
    });

    it('should format status update event log', () => {
      const event: InteractionSSEEvent = {
        event_type: 'interaction.status_update',
        status: 'completed',
      };
      const log = buildInteractionsEventLog(event);
      expect(log).to.include('interaction.status_update');
      expect(log).to.include('status: completed');
    });
  });
});
