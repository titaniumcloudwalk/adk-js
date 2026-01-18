/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {expect} from 'chai';

import {LlmAgent} from '../../src/agents/llm_agent.js';
import {App, createEventsCompactionConfig, validateAppName} from '../../src/apps/app.js';

describe('App', () => {
  describe('validateAppName', () => {
    it('should accept valid names', () => {
      expect(validateAppName('myApp')).to.equal('myApp');
      expect(validateAppName('my_app')).to.equal('my_app');
      expect(validateAppName('MyApp123')).to.equal('MyApp123');
      expect(validateAppName('_privateApp')).to.equal('_privateApp');
      expect(validateAppName('app_123_test')).to.equal('app_123_test');
    });

    it('should reject invalid names', () => {
      expect(() => validateAppName('')).to.throw('Invalid app name');
      expect(() => validateAppName('123app')).to.throw('Invalid app name');
      expect(() => validateAppName('my-app')).to.throw('Invalid app name');
      expect(() => validateAppName('my app')).to.throw('Invalid app name');
      expect(() => validateAppName('my.app')).to.throw('Invalid app name');
    });

    it('should reject reserved name "user"', () => {
      expect(() => validateAppName('user')).to.throw(
          'App name cannot be "user"');
    });
  });

  describe('constructor', () => {
    it('should create an App with minimal config', () => {
      const rootAgent = new LlmAgent({
        name: 'test_agent',
        model: 'gemini-2.0-flash',
      });

      const app = new App({
        name: 'test_app',
        rootAgent,
      });

      expect(app.name).to.equal('test_app');
      expect(app.rootAgent).to.equal(rootAgent);
      expect(app.plugins).to.deep.equal([]);
      expect(app.eventsCompactionConfig).to.be.undefined;
      expect(app.contextCacheConfig).to.be.undefined;
      expect(app.resumabilityConfig).to.be.undefined;
    });

    it('should create an App with full config', () => {
      const rootAgent = new LlmAgent({
        name: 'test_agent',
        model: 'gemini-2.0-flash',
      });

      const compactionConfig = createEventsCompactionConfig({
        compactionInterval: 5,
        overlapSize: 1,
      });

      const app = new App({
        name: 'full_app',
        rootAgent,
        eventsCompactionConfig: compactionConfig,
        resumabilityConfig: {isResumable: true},
      });

      expect(app.name).to.equal('full_app');
      expect(app.eventsCompactionConfig).to.deep.equal({
        compactionInterval: 5,
        overlapSize: 1,
        summarizer: undefined,
      });
      expect(app.resumabilityConfig).to.deep.equal({isResumable: true});
    });

    it('should throw on invalid name', () => {
      const rootAgent = new LlmAgent({
        name: 'test_agent',
        model: 'gemini-2.0-flash',
      });

      expect(() => new App({
        name: 'invalid-name',
        rootAgent,
      })).to.throw('Invalid app name');
    });
  });

  describe('createEventsCompactionConfig', () => {
    it('should create config with defaults', () => {
      const config = createEventsCompactionConfig();
      expect(config.compactionInterval).to.equal(10);
      expect(config.overlapSize).to.equal(2);
      expect(config.summarizer).to.be.undefined;
    });

    it('should override defaults with provided values', () => {
      const config = createEventsCompactionConfig({
        compactionInterval: 5,
        overlapSize: 1,
      });
      expect(config.compactionInterval).to.equal(5);
      expect(config.overlapSize).to.equal(1);
    });
  });
});
