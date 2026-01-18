/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect} from 'vitest';
import {
  isAsyncGeneratorFunction,
  Aclosing,
  withAclosing,
} from '../../src/utils/async_generator_utils.js';

describe('isAsyncGeneratorFunction', () => {
  it('should return true for async generator function', () => {
    async function* streamData() {
      yield 'a';
      yield 'b';
    }
    expect(isAsyncGeneratorFunction(streamData)).toBe(true);
  });

  it('should return false for regular async function', async () => {
    async function getData() {
      return 'data';
    }
    expect(isAsyncGeneratorFunction(getData)).toBe(false);
  });

  it('should return false for regular function', () => {
    function getData() {
      return 'data';
    }
    expect(isAsyncGeneratorFunction(getData)).toBe(false);
  });

  it('should return false for regular generator function', () => {
    function* streamData() {
      yield 'a';
    }
    expect(isAsyncGeneratorFunction(streamData)).toBe(false);
  });

  it('should return false for non-function values', () => {
    expect(isAsyncGeneratorFunction(null)).toBe(false);
    expect(isAsyncGeneratorFunction(undefined)).toBe(false);
    expect(isAsyncGeneratorFunction('string')).toBe(false);
    expect(isAsyncGeneratorFunction(123)).toBe(false);
    expect(isAsyncGeneratorFunction({})).toBe(false);
    expect(isAsyncGeneratorFunction([])).toBe(false);
  });

  it('should return false for arrow functions', () => {
    const arrowFn = () => 'data';
    expect(isAsyncGeneratorFunction(arrowFn)).toBe(false);
  });

  it('should return false for async arrow functions', () => {
    const asyncArrowFn = async () => 'data';
    expect(isAsyncGeneratorFunction(asyncArrowFn)).toBe(false);
  });
});

describe('Aclosing', () => {
  it('should iterate through all values from async generator', async () => {
    async function* streamData() {
      yield 1;
      yield 2;
      yield 3;
    }

    const results: number[] = [];
    const aclosing = new Aclosing(streamData());
    for await (const item of aclosing) {
      results.push(item as number);
    }

    expect(results).toEqual([1, 2, 3]);
  });

  it('should close generator after iteration', async () => {
    let generatorClosed = false;

    async function* streamData() {
      try {
        yield 1;
        yield 2;
      } finally {
        generatorClosed = true;
      }
    }

    const aclosing = new Aclosing(streamData());
    for await (const _ of aclosing) {
      // Just iterate
    }

    expect(generatorClosed).toBe(true);
  });

  it('should close generator on early break', async () => {
    let generatorClosed = false;

    async function* streamData() {
      try {
        yield 1;
        yield 2;
        yield 3;
      } finally {
        generatorClosed = true;
      }
    }

    const aclosing = new Aclosing(streamData());
    for await (const item of aclosing) {
      if (item === 1) {
        break;
      }
    }

    // Close should be called via the Aclosing finally block
    expect(generatorClosed).toBe(true);
  });

  it('should handle empty generator', async () => {
    async function* emptyGen() {
      // Empty generator
    }

    const results: unknown[] = [];
    const aclosing = new Aclosing(emptyGen());
    for await (const item of aclosing) {
      results.push(item);
    }

    expect(results).toEqual([]);
  });

  it('should handle generator with single value', async () => {
    async function* singleGen() {
      yield 'only';
    }

    const results: string[] = [];
    const aclosing = new Aclosing(singleGen());
    for await (const item of aclosing) {
      results.push(item as string);
    }

    expect(results).toEqual(['only']);
  });

  it('should not call return multiple times', async () => {
    let returnCount = 0;

    async function* trackingGen(): AsyncGenerator<number> {
      try {
        yield 1;
      } finally {
        returnCount++;
      }
    }

    const aclosing = new Aclosing(trackingGen());
    for await (const _ of aclosing) {
      // iterate
    }

    // Manually close again
    await aclosing.close();

    expect(returnCount).toBe(1);
  });
});

describe('withAclosing', () => {
  it('should create an Aclosing wrapper', async () => {
    async function* streamData() {
      yield 'a';
      yield 'b';
    }

    const results: string[] = [];
    for await (const item of withAclosing(streamData())) {
      results.push(item as string);
    }

    expect(results).toEqual(['a', 'b']);
  });

  it('should close generator on early exit', async () => {
    let closed = false;

    async function* streamData() {
      try {
        yield 1;
        yield 2;
        yield 3;
      } finally {
        closed = true;
      }
    }

    for await (const item of withAclosing(streamData())) {
      if (item === 2) {
        break;
      }
    }

    expect(closed).toBe(true);
  });
});
