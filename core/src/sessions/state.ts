/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A state mapping that maintains the current value and the pending-commit
 * delta.
 */
export class State {
  static readonly APP_PREFIX = 'app:';
  static readonly USER_PREFIX = 'user:';
  static readonly TEMP_PREFIX = 'temp:';

  constructor(
      /** The current value of the state. */
      private value: Record<string, unknown> = {},
      /** The delta change to the current value that hasn't been committed. */
      private delta: Record<string, unknown> = {},
  ) {}

  /**
   * Returns the value of the state dict for the given key.
   *
   * @param key The key to get the value for.
   * @param defaultValue The default value to return if the key is not found.
   * @return The value of the state for the given key, or the default value if
   *     not found.
   */
  get<T>(key: string, defaultValue?: T): T|undefined {
    if (key in this.delta) {
      return this.delta[key] as T;
    }

    if (key in this.value) {
      return this.value[key] as T;
    }

    return defaultValue;
  }

  /**
   * Sets the value of the state dict for the given key.
   *
   * @param key The key to set the value for.
   * @param value The value to set.
   */
  set(key: string, value: unknown) {
    this.value[key] = value;
    this.delta[key] = value;
  }

  /**
   * Whether the state has pending delta.
   */
  has(key: string): boolean {
    return key in this.value || key in this.delta;
  }

  /**
   * Gets the value of a key, or sets it to a default if the key doesn't exist.
   *
   * This method is similar to Python's dict.setdefault() method. It provides
   * atomic get-or-set behavior for state values.
   *
   * @param key The key to get or set the value for.
   * @param defaultValue The default value to set and return if the key doesn't exist.
   * @return The existing value if the key exists, or the default value after setting it.
   *
   * @example
   * ```typescript
   * const state = new State();
   * // Key doesn't exist, so set and return default
   * const value1 = state.setDefault('counter', 0); // Returns 0
   * // Key now exists, so return existing value
   * const value2 = state.setDefault('counter', 5); // Returns 0, not 5
   * ```
   */
  setDefault<T>(key: string, defaultValue?: T): T|undefined {
    if (this.has(key)) {
      return this.get(key) as T;
    } else {
      this.set(key, defaultValue);
      return defaultValue;
    }
  }

  /**
   * Whether the state has pending delta.
   */
  hasDelta(): boolean {
    return Object.keys(this.delta).length > 0;
  }

  /**
   * Updates the state dict with the given delta.
   *
   * @param delta The delta to update the state with.
   */
  update(delta: Record<string, unknown>) {
    this.delta = {...this.delta, ...delta};
    this.value = {...this.value, ...delta};
  }

  /**
   * Returns the state as a plain JSON object.
   */
  toRecord(): Record<string, unknown> {
    return {...this.value, ...this.delta};
  }
}
