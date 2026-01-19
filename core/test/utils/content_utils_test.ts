/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, expect, it} from 'vitest';

import {
  filterAudioParts,
  isAudioPart,
} from '../../src/utils/content_utils.js';

describe('isAudioPart', () => {
  it('returns true for inline audio data with audio/pcm mime type', () => {
    const part = {
      inlineData: {
        data: 'base64data',
        mimeType: 'audio/pcm',
      },
    };
    expect(isAudioPart(part)).toBe(true);
  });

  it('returns true for inline audio data with audio/wav mime type', () => {
    const part = {
      inlineData: {
        data: 'base64data',
        mimeType: 'audio/wav',
      },
    };
    expect(isAudioPart(part)).toBe(true);
  });

  it('returns true for inline audio data with audio/mp3 mime type', () => {
    const part = {
      inlineData: {
        data: 'base64data',
        mimeType: 'audio/mp3',
      },
    };
    expect(isAudioPart(part)).toBe(true);
  });

  it('returns true for inline audio data with audio/ogg mime type', () => {
    const part = {
      inlineData: {
        data: 'base64data',
        mimeType: 'audio/ogg',
      },
    };
    expect(isAudioPart(part)).toBe(true);
  });

  it('returns true for file-based audio data', () => {
    const part = {
      fileData: {
        fileUri: 'artifact://app/user/session/_adk_live/audio.pcm#1',
        mimeType: 'audio/pcm',
      },
    };
    expect(isAudioPart(part)).toBe(true);
  });

  it('returns false for inline image data', () => {
    const part = {
      inlineData: {
        data: 'base64data',
        mimeType: 'image/png',
      },
    };
    expect(isAudioPart(part)).toBe(false);
  });

  it('returns false for file-based image data', () => {
    const part = {
      fileData: {
        fileUri: 'gs://bucket/image.jpg',
        mimeType: 'image/jpeg',
      },
    };
    expect(isAudioPart(part)).toBe(false);
  });

  it('returns false for text parts', () => {
    const part = {
      text: 'Hello world',
    };
    expect(isAudioPart(part)).toBe(false);
  });

  it('returns false for function call parts', () => {
    const part = {
      functionCall: {
        name: 'myFunction',
        args: {},
      },
    };
    expect(isAudioPart(part)).toBe(false);
  });

  it('returns false for inline data without mime type', () => {
    const part = {
      inlineData: {
        data: 'base64data',
      },
    };
    expect(isAudioPart(part)).toBe(false);
  });

  it('returns false for file data without mime type', () => {
    const part = {
      fileData: {
        fileUri: 'gs://bucket/file',
      },
    };
    expect(isAudioPart(part)).toBe(false);
  });
});

describe('filterAudioParts', () => {
  it('returns null for content without parts', () => {
    const content = {
      role: 'user',
    };
    expect(filterAudioParts(content)).toBeNull();
  });

  it('returns null for content with only audio parts', () => {
    const content = {
      role: 'user',
      parts: [
        {
          inlineData: {
            data: 'base64audio',
            mimeType: 'audio/pcm',
          },
        },
        {
          fileData: {
            fileUri: 'artifact://audio.wav',
            mimeType: 'audio/wav',
          },
        },
      ],
    };
    expect(filterAudioParts(content)).toBeNull();
  });

  it('preserves content with text parts only', () => {
    const content = {
      role: 'user',
      parts: [{text: 'Hello'}],
    };

    const result = filterAudioParts(content);

    expect(result).toEqual({
      role: 'user',
      parts: [{text: 'Hello'}],
    });
  });

  it('preserves content with image parts only', () => {
    const content = {
      role: 'user',
      parts: [
        {
          inlineData: {
            data: 'base64image',
            mimeType: 'image/png',
          },
        },
      ],
    };

    const result = filterAudioParts(content);

    expect(result).toEqual({
      role: 'user',
      parts: [
        {
          inlineData: {
            data: 'base64image',
            mimeType: 'image/png',
          },
        },
      ],
    });
  });

  it('filters audio parts from mixed content', () => {
    const content = {
      role: 'user',
      parts: [
        {
          inlineData: {
            data: 'base64audio',
            mimeType: 'audio/wav',
          },
        },
        {text: 'transcribed text'},
      ],
    };

    const result = filterAudioParts(content);

    expect(result).toEqual({
      role: 'user',
      parts: [{text: 'transcribed text'}],
    });
  });

  it('preserves model role in filtered content', () => {
    const content = {
      role: 'model',
      parts: [
        {text: 'Response text'},
        {
          inlineData: {
            data: 'base64audio',
            mimeType: 'audio/pcm',
          },
        },
      ],
    };

    const result = filterAudioParts(content);

    expect(result).toEqual({
      role: 'model',
      parts: [{text: 'Response text'}],
    });
  });

  it('preserves multiple non-audio parts', () => {
    const content = {
      role: 'user',
      parts: [
        {text: 'Look at this image'},
        {
          inlineData: {
            data: 'base64image',
            mimeType: 'image/jpeg',
          },
        },
      ],
    };

    const result = filterAudioParts(content);

    expect(result).toEqual({
      role: 'user',
      parts: [
        {text: 'Look at this image'},
        {
          inlineData: {
            data: 'base64image',
            mimeType: 'image/jpeg',
          },
        },
      ],
    });
  });

  it('filters multiple audio parts while preserving other parts', () => {
    const content = {
      role: 'user',
      parts: [
        {
          inlineData: {
            data: 'audio1',
            mimeType: 'audio/pcm',
          },
        },
        {text: 'transcription'},
        {
          fileData: {
            fileUri: 'artifact://audio.mp3',
            mimeType: 'audio/mp3',
          },
        },
        {
          inlineData: {
            data: 'image',
            mimeType: 'image/png',
          },
        },
      ],
    };

    const result = filterAudioParts(content);

    expect(result).toEqual({
      role: 'user',
      parts: [
        {text: 'transcription'},
        {
          inlineData: {
            data: 'image',
            mimeType: 'image/png',
          },
        },
      ],
    });
  });
});
