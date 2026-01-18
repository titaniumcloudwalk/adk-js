/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {createRunConfig, StreamingMode} from '@google/adk';
import {logger} from '../../src/utils/logger.js';

describe('RunConfig', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('createRunConfig', () => {
    it('should create config with default values', () => {
      const config = createRunConfig();

      expect(config.saveInputBlobsAsArtifacts).toBe(false);
      expect(config.supportCfc).toBe(false);
      expect(config.enableAffectiveDialog).toBe(false);
      expect(config.streamingMode).toBe(StreamingMode.NONE);
      expect(config.saveLiveBlob).toBe(false);
      expect(config.maxLlmCalls).toBe(500);
    });

    it('should accept and set new optional fields', () => {
      const config = createRunConfig({
        sessionResumption: {},
        contextWindowCompression: {triggerTokens: '1000'},
        saveLiveBlob: true,
        customMetadata: {key: 'value', number: 42},
      });

      expect(config.sessionResumption).toEqual({});
      expect(config.contextWindowCompression).toEqual({triggerTokens: '1000'});
      expect(config.saveLiveBlob).toBe(true);
      expect(config.customMetadata).toEqual({key: 'value', number: 42});
    });

    it('should migrate saveLiveAudio to saveLiveBlob', () => {
      const config = createRunConfig({
        saveLiveAudio: true,
      });

      expect(config.saveLiveBlob).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        "The 'saveLiveAudio' config is deprecated and will be removed in a future " +
        "release. Please use 'saveLiveBlob' instead."
      );
    });

    it('should not override saveLiveBlob if both saveLiveAudio and saveLiveBlob are set', () => {
      const config = createRunConfig({
        saveLiveAudio: false,
        saveLiveBlob: true,
      });

      // saveLiveBlob takes precedence
      expect(config.saveLiveBlob).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        "The 'saveLiveAudio' config is deprecated and will be removed in a future " +
        "release. Please use 'saveLiveBlob' instead."
      );
    });

    it('should warn when saveLiveAudio is false but still migrate', () => {
      const config = createRunConfig({
        saveLiveAudio: false,
      });

      expect(config.saveLiveBlob).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        "The 'saveLiveAudio' config is deprecated and will be removed in a future " +
        "release. Please use 'saveLiveBlob' instead."
      );
    });

    it('should warn when saveInputBlobsAsArtifacts is true', () => {
      const config = createRunConfig({
        saveInputBlobsAsArtifacts: true,
      });

      expect(config.saveInputBlobsAsArtifacts).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        "The 'saveInputBlobsAsArtifacts' config is deprecated and will be removed in a future " +
        "release. Please use 'artifact handling in tool context' instead."
      );
    });

    it('should not warn when saveInputBlobsAsArtifacts is false', () => {
      createRunConfig({
        saveInputBlobsAsArtifacts: false,
      });

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('should support customMetadata with various types', () => {
      const customMetadata = {
        string: 'value',
        number: 123,
        boolean: true,
        array: [1, 2, 3],
        nested: {key: 'value'},
        nullValue: null,
      };

      const config = createRunConfig({customMetadata});

      expect(config.customMetadata).toEqual(customMetadata);
    });

    it('should override default values with provided params', () => {
      const config = createRunConfig({
        saveInputBlobsAsArtifacts: true,
        supportCfc: true,
        enableAffectiveDialog: true,
        streamingMode: StreamingMode.BIDI,
        maxLlmCalls: 100,
      });

      expect(config.saveInputBlobsAsArtifacts).toBe(true);
      expect(config.supportCfc).toBe(true);
      expect(config.enableAffectiveDialog).toBe(true);
      expect(config.streamingMode).toBe(StreamingMode.BIDI);
      expect(config.maxLlmCalls).toBe(100);
    });

    it('should handle maxLlmCalls validation', () => {
      const config = createRunConfig({maxLlmCalls: 0});

      expect(config.maxLlmCalls).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('maxLlmCalls is less than or equal to 0')
      );
    });

    it('should throw error for maxLlmCalls exceeding MAX_SAFE_INTEGER', () => {
      expect(() => {
        createRunConfig({maxLlmCalls: Number.MAX_SAFE_INTEGER + 1});
      }).toThrow('maxLlmCalls should be less than');
    });

    it('should handle all live agent config fields', () => {
      const config = createRunConfig({
        speechConfig: {voiceConfig: {prebuiltVoiceConfig: {voiceName: 'en-US-Wavenet-A'}}},
        responseModalities: ['TEXT', 'AUDIO'],
        outputAudioTranscription: {model: 'chirp'},
        inputAudioTranscription: {model: 'chirp'},
        realtimeInputConfig: {enabled: true},
        enableAffectiveDialog: true,
        proactivity: {enabled: true},
      });

      expect(config.speechConfig).toBeDefined();
      expect(config.responseModalities).toEqual(['TEXT', 'AUDIO']);
      expect(config.outputAudioTranscription).toEqual({model: 'chirp'});
      expect(config.inputAudioTranscription).toEqual({model: 'chirp'});
      expect(config.realtimeInputConfig).toEqual({enabled: true});
      expect(config.enableAffectiveDialog).toBe(true);
      expect(config.proactivity).toEqual({enabled: true});
    });
  });
});
