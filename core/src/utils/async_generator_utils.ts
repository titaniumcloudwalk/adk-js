/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Checks if a function is an async generator function.
 *
 * This detects functions defined with `async function*` syntax that
 * return AsyncGenerator objects when called.
 *
 * @param fn The function to check
 * @returns true if fn is an async generator function
 *
 * @example
 * ```typescript
 * async function* streamData() { yield 'data'; }
 * isAsyncGeneratorFunction(streamData); // true
 *
 * async function getData() { return 'data'; }
 * isAsyncGeneratorFunction(getData); // false
 * ```
 */
export function isAsyncGeneratorFunction(fn: unknown): fn is (...args: unknown[]) => AsyncGenerator<unknown> {
  if (typeof fn !== 'function') {
    return false;
  }
  // Check constructor name for AsyncGeneratorFunction
  const constructorName = fn.constructor?.name;
  if (constructorName === 'AsyncGeneratorFunction') {
    return true;
  }
  // Fallback: Check the string representation
  const fnStr = fn.toString();
  return fnStr.startsWith('async function*') ||
         fnStr.startsWith('async *') ||
         /^async\s+function\s*\*/.test(fnStr);
}

/**
 * A utility class that provides async iterator cleanup similar to Python's Aclosing.
 *
 * This ensures proper cleanup of async generators by calling their return() method
 * when the generator is no longer needed, even if an error occurs.
 *
 * @example
 * ```typescript
 * const aclosing = new Aclosing(myAsyncGenerator());
 * try {
 *   for await (const item of aclosing) {
 *     // process item
 *   }
 * } finally {
 *   await aclosing.close();
 * }
 * ```
 */
export class Aclosing<T> implements AsyncIterable<T> {
  private readonly generator: AsyncGenerator<T>;
  private closed = false;

  constructor(generator: AsyncGenerator<T>) {
    this.generator = generator;
  }

  /**
   * Closes the async generator, calling its return() method for cleanup.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.generator.return) {
      await this.generator.return(undefined);
    }
  }

  /**
   * Implements async iterator protocol.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
    try {
      for await (const item of this.generator) {
        yield item;
      }
    } finally {
      await this.close();
    }
  }
}

/**
 * Helper function to wrap an async generator with automatic cleanup.
 *
 * @param generator The async generator to wrap
 * @returns An Aclosing instance for safe iteration
 *
 * @example
 * ```typescript
 * for await (const item of withAclosing(myAsyncGen())) {
 *   // process item
 * }
 * // Generator is automatically closed
 * ```
 */
export function withAclosing<T>(generator: AsyncGenerator<T>): Aclosing<T> {
  return new Aclosing(generator);
}
