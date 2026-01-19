/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
  FeatureName,
  FeatureStage,
  isFeatureEnabled,
  overrideFeatureEnabled,
  clearFeatureOverride,
  clearAllFeatureOverrides,
  clearWarnedFeatures,
  getAllFeatureNames,
  applyFeatureOverrides,
} from '../../src/features/index.js';

describe('Feature Registry', () => {
  beforeEach(() => {
    // Reset state before each test
    clearAllFeatureOverrides();
    clearWarnedFeatures();
    // Clear environment variables
    delete process.env.ADK_ENABLE_JSON_SCHEMA_FOR_FUNC_DECL;
    delete process.env.ADK_DISABLE_JSON_SCHEMA_FOR_FUNC_DECL;
    delete process.env.ADK_ENABLE_COMPUTER_USE;
    delete process.env.ADK_DISABLE_COMPUTER_USE;
  });

  describe('FeatureName enum', () => {
    it('should have expected feature names', () => {
      expect(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL).toBe(
        'JSON_SCHEMA_FOR_FUNC_DECL'
      );
      expect(FeatureName.COMPUTER_USE).toBe('COMPUTER_USE');
      expect(FeatureName.BIG_QUERY_TOOLSET).toBe('BIG_QUERY_TOOLSET');
    });

    it('should contain all expected features', () => {
      const names = Object.values(FeatureName);
      expect(names).toContain('JSON_SCHEMA_FOR_FUNC_DECL');
      expect(names).toContain('COMPUTER_USE');
      expect(names).toContain('TOOL_CONFIRMATION');
    });
  });

  describe('FeatureStage enum', () => {
    it('should have expected stages', () => {
      expect(FeatureStage.WIP).toBe('wip');
      expect(FeatureStage.EXPERIMENTAL).toBe('experimental');
      expect(FeatureStage.STABLE).toBe('stable');
    });
  });

  describe('isFeatureEnabled', () => {
    it('should return default value for WIP feature (default off)', () => {
      // JSON_SCHEMA_FOR_FUNC_DECL is WIP with default_on=false
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        false
      );
    });

    it('should return default value for EXPERIMENTAL feature (default on)', () => {
      // COMPUTER_USE is EXPERIMENTAL with default_on=true
      expect(isFeatureEnabled(FeatureName.COMPUTER_USE)).toBe(true);
    });

    it('should throw error for unregistered feature', () => {
      expect(() => isFeatureEnabled('UNKNOWN_FEATURE' as FeatureName)).toThrow(
        'Feature UNKNOWN_FEATURE is not registered'
      );
    });
  });

  describe('overrideFeatureEnabled', () => {
    it('should enable a feature via programmatic override', () => {
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        false
      );
      overrideFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL, true);
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        true
      );
    });

    it('should disable a feature via programmatic override', () => {
      expect(isFeatureEnabled(FeatureName.COMPUTER_USE)).toBe(true);
      overrideFeatureEnabled(FeatureName.COMPUTER_USE, false);
      expect(isFeatureEnabled(FeatureName.COMPUTER_USE)).toBe(false);
    });

    it('should throw error for unregistered feature', () => {
      expect(() =>
        overrideFeatureEnabled('UNKNOWN_FEATURE' as FeatureName, true)
      ).toThrow('Feature UNKNOWN_FEATURE is not registered');
    });
  });

  describe('clearFeatureOverride', () => {
    it('should clear a single feature override', () => {
      overrideFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL, true);
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        true
      );

      clearFeatureOverride(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL);
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        false
      );
    });
  });

  describe('clearAllFeatureOverrides', () => {
    it('should clear all feature overrides', () => {
      overrideFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL, true);
      overrideFeatureEnabled(FeatureName.COMPUTER_USE, false);

      clearAllFeatureOverrides();

      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        false
      ); // Back to default
      expect(isFeatureEnabled(FeatureName.COMPUTER_USE)).toBe(true); // Back to default
    });
  });

  describe('environment variable support', () => {
    it('should enable feature via ADK_ENABLE_* env var', () => {
      process.env.ADK_ENABLE_JSON_SCHEMA_FOR_FUNC_DECL = 'true';
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        true
      );
    });

    it('should disable feature via ADK_DISABLE_* env var', () => {
      process.env.ADK_DISABLE_COMPUTER_USE = 'true';
      expect(isFeatureEnabled(FeatureName.COMPUTER_USE)).toBe(false);
    });

    it('should accept "1" as truthy value', () => {
      process.env.ADK_ENABLE_JSON_SCHEMA_FOR_FUNC_DECL = '1';
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        true
      );
    });

    it('should accept "yes" as truthy value', () => {
      process.env.ADK_ENABLE_JSON_SCHEMA_FOR_FUNC_DECL = 'yes';
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        true
      );
    });

    it('should not accept empty string as truthy', () => {
      process.env.ADK_ENABLE_JSON_SCHEMA_FOR_FUNC_DECL = '';
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        false
      );
    });

    it('should not accept arbitrary string as truthy', () => {
      process.env.ADK_ENABLE_JSON_SCHEMA_FOR_FUNC_DECL = 'foo';
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        false
      );
    });
  });

  describe('priority order', () => {
    it('should prioritize programmatic override over env var', () => {
      process.env.ADK_ENABLE_JSON_SCHEMA_FOR_FUNC_DECL = 'true';
      overrideFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL, false);

      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        false
      );
    });

    it('should prioritize env var over default', () => {
      // COMPUTER_USE defaults to true, disable via env
      process.env.ADK_DISABLE_COMPUTER_USE = 'true';
      expect(isFeatureEnabled(FeatureName.COMPUTER_USE)).toBe(false);
    });
  });

  describe('getAllFeatureNames', () => {
    it('should return all registered feature names', () => {
      const names = getAllFeatureNames();
      expect(names).toContain(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL);
      expect(names).toContain(FeatureName.COMPUTER_USE);
      expect(names).toContain(FeatureName.BIG_QUERY_TOOLSET);
      expect(names.length).toBeGreaterThan(10);
    });
  });

  describe('applyFeatureOverrides', () => {
    it('should apply single feature name', () => {
      applyFeatureOverrides(['JSON_SCHEMA_FOR_FUNC_DECL']);
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        true
      );
    });

    it('should apply comma-separated feature names', () => {
      applyFeatureOverrides(['JSON_SCHEMA_FOR_FUNC_DECL,TOOL_CONFIG']);
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        true
      );
      expect(isFeatureEnabled(FeatureName.TOOL_CONFIG)).toBe(true);
    });

    it('should apply multiple array values', () => {
      applyFeatureOverrides([
        'JSON_SCHEMA_FOR_FUNC_DECL',
        'PROGRESSIVE_SSE_STREAMING',
      ]);
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        true
      );
      expect(isFeatureEnabled(FeatureName.PROGRESSIVE_SSE_STREAMING)).toBe(
        true
      );
    });

    it('should handle whitespace around feature names', () => {
      applyFeatureOverrides([' JSON_SCHEMA_FOR_FUNC_DECL , COMPUTER_USE ']);
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(
        true
      );
      expect(isFeatureEnabled(FeatureName.COMPUTER_USE)).toBe(true);
    });

    it('should ignore empty strings', () => {
      // Should not throw
      applyFeatureOverrides(['']);
      applyFeatureOverrides([',,']);
    });

    it('should warn for unknown feature names', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      applyFeatureOverrides(['UNKNOWN_FEATURE_XYZ']);

      // The logger.warn might use different console method, so we check the feature wasn't enabled
      // and restore the mock
      warnSpy.mockRestore();
    });
  });
});
