/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {State} from '../../src/sessions/state.js';

describe('State', () => {
  describe('setDefault', () => {
    it('should return and set default value when key does not exist', () => {
      const state = new State();
      const result = state.setDefault('counter', 0);

      expect(result).toBe(0);
      expect(state.get('counter')).toBe(0);
    });

    it('should return existing value when key exists', () => {
      const state = new State();
      state.set('counter', 42);

      const result = state.setDefault('counter', 0);

      expect(result).toBe(42);
      expect(state.get('counter')).toBe(42);
    });

    it('should handle undefined default value', () => {
      const state = new State();
      const result = state.setDefault('key');

      expect(result).toBeUndefined();
      expect(state.get('key')).toBeUndefined();
      expect(state.has('key')).toBe(true);
    });

    it('should work with object values', () => {
      const state = new State();
      const defaultObj = {count: 1, name: 'test'};

      const result = state.setDefault('config', defaultObj);

      expect(result).toEqual(defaultObj);
      expect(state.get('config')).toEqual(defaultObj);
    });

    it('should work with array values', () => {
      const state = new State();
      const defaultArray = [1, 2, 3];

      const result = state.setDefault('items', defaultArray);

      expect(result).toEqual(defaultArray);
      expect(state.get('items')).toEqual(defaultArray);
    });

    it('should update delta when setting default', () => {
      const state = new State();

      expect(state.hasDelta()).toBe(false);

      state.setDefault('key', 'value');

      expect(state.hasDelta()).toBe(true);
    });

    it('should not update delta when key already exists', () => {
      const state = new State({'existing': 'value'}, {});

      expect(state.hasDelta()).toBe(false);

      state.setDefault('existing', 'newValue');

      expect(state.hasDelta()).toBe(false);
      expect(state.get('existing')).toBe('value');
    });

    it('should work with boolean values', () => {
      const state = new State();

      const result = state.setDefault('flag', false);

      expect(result).toBe(false);
      expect(state.get('flag')).toBe(false);
    });

    it('should work with number zero', () => {
      const state = new State();

      const result = state.setDefault('count', 0);

      expect(result).toBe(0);
      expect(state.get('count')).toBe(0);
    });

    it('should work with empty string', () => {
      const state = new State();

      const result = state.setDefault('text', '');

      expect(result).toBe('');
      expect(state.get('text')).toBe('');
    });

    it('should work with null value', () => {
      const state = new State();

      const result = state.setDefault('nullable', null);

      expect(result).toBeNull();
      expect(state.get('nullable')).toBeNull();
    });

    it('should respect value in delta over value in committed state', () => {
      const state = new State({'key': 'committed'}, {'key': 'pending'});

      const result = state.setDefault('key', 'default');

      expect(result).toBe('pending');
      expect(state.get('key')).toBe('pending');
    });

    it('should work with app-scoped keys', () => {
      const state = new State();

      const result = state.setDefault('app:config', {setting: 'value'});

      expect(result).toEqual({setting: 'value'});
      expect(state.get('app:config')).toEqual({setting: 'value'});
    });

    it('should work with user-scoped keys', () => {
      const state = new State();

      const result = state.setDefault('user:preferences', {theme: 'dark'});

      expect(result).toEqual({theme: 'dark'});
      expect(state.get('user:preferences')).toEqual({theme: 'dark'});
    });

    it('should work with temp-scoped keys', () => {
      const state = new State();

      const result = state.setDefault('temp:cache', {data: [1, 2, 3]});

      expect(result).toEqual({data: [1, 2, 3]});
      expect(state.get('temp:cache')).toEqual({data: [1, 2, 3]});
    });

    it('should work in a typical counter pattern', () => {
      const state = new State();

      // First call initializes counter
      let count = state.setDefault('visits', 0) as number;
      expect(count).toBe(0);

      // Increment the counter
      state.set('visits', count + 1);

      // Second call should return existing value
      count = state.setDefault('visits', 0) as number;
      expect(count).toBe(1);
    });

    it('should work in a typical list initialization pattern', () => {
      const state = new State();

      // Initialize empty list if not exists
      let items = state.setDefault<string[]>('items', []);
      expect(items).toEqual([]);

      // Add item to list
      items = items || [];
      items.push('item1');
      state.set('items', items);

      // Get list again - should have the item
      items = state.setDefault<string[]>('items', []);
      expect(items).toEqual(['item1']);
    });
  });

  describe('State integration tests', () => {
    it('should work correctly with get, set, has, and setDefault', () => {
      const state = new State();

      // Test setDefault on non-existent key
      expect(state.has('key1')).toBe(false);
      const val1 = state.setDefault('key1', 'default1');
      expect(val1).toBe('default1');
      expect(state.has('key1')).toBe(true);

      // Test setDefault on existing key
      const val2 = state.setDefault('key1', 'default2');
      expect(val2).toBe('default1');

      // Test set after setDefault
      state.set('key2', 'value2');
      const val3 = state.setDefault('key2', 'default3');
      expect(val3).toBe('value2');
    });
  });
});
