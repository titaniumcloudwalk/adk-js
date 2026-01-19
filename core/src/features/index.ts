/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  FeatureName,
  FeatureStage,
  type FeatureConfig,
  registerFeature,
  overrideFeatureEnabled,
  clearFeatureOverride,
  clearAllFeatureOverrides,
  clearWarnedFeatures,
  isFeatureEnabled,
  getAllFeatureNames,
  applyFeatureOverrides,
} from './feature_registry.js';
