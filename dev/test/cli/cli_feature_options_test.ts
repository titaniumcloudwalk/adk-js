/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
  FeatureName,
  isFeatureEnabled,
  clearAllFeatureOverrides,
  clearWarnedFeatures,
  applyFeatureOverrides,
} from '@google/adk';

describe('CLI --enable_features option', () => {
  beforeEach(() => {
    // Reset feature overrides and warnings before each test
    clearAllFeatureOverrides();
    clearWarnedFeatures();
  });

  afterEach(() => {
    // Clean up after each test
    clearAllFeatureOverrides();
    clearWarnedFeatures();
  });

  describe('applyFeatureOverrides', () => {
    it('should enable a single feature', () => {
      applyFeatureOverrides(['JSON_SCHEMA_FOR_FUNC_DECL']);
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(true);
    });

    it('should enable comma-separated features', () => {
      applyFeatureOverrides(['JSON_SCHEMA_FOR_FUNC_DECL,PROGRESSIVE_SSE_STREAMING']);
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(true);
      expect(isFeatureEnabled(FeatureName.PROGRESSIVE_SSE_STREAMING)).toBe(true);
    });

    it('should enable multiple flag values', () => {
      applyFeatureOverrides([
        'JSON_SCHEMA_FOR_FUNC_DECL',
        'PROGRESSIVE_SSE_STREAMING',
      ]);
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(true);
      expect(isFeatureEnabled(FeatureName.PROGRESSIVE_SSE_STREAMING)).toBe(true);
    });

    it('should handle whitespace around feature names', () => {
      applyFeatureOverrides([' JSON_SCHEMA_FOR_FUNC_DECL , COMPUTER_USE ']);
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(true);
      expect(isFeatureEnabled(FeatureName.COMPUTER_USE)).toBe(true);
    });

    it('should ignore empty strings', () => {
      // Should not throw
      applyFeatureOverrides(['']);
      applyFeatureOverrides(['', '']);
    });

    it('should warn on unknown feature names', () => {
      // Should not throw, but should log a warning
      applyFeatureOverrides(['UNKNOWN_FEATURE_XYZ']);
      // Feature should not be enabled
      expect(isFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL)).toBe(false);
    });

    it('should enable all valid feature names', () => {
      // Test that all FeatureName values can be enabled
      for (const featureName of Object.values(FeatureName)) {
        clearAllFeatureOverrides();
        applyFeatureOverrides([featureName]);
        expect(isFeatureEnabled(featureName as FeatureName)).toBe(true);
      }
    });
  });
});
