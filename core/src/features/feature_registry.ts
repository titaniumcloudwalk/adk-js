/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Feature flags registry for controlling experimental and WIP features.
 * Provides a way to enable/disable features via environment variables,
 * programmatic overrides, or CLI flags.
 */

import {logger} from '../utils/logger.js';

/**
 * Feature names enum for all registered features.
 */
export enum FeatureName {
  AUTHENTICATED_FUNCTION_TOOL = 'AUTHENTICATED_FUNCTION_TOOL',
  BASE_AUTHENTICATED_TOOL = 'BASE_AUTHENTICATED_TOOL',
  BIG_QUERY_TOOLSET = 'BIG_QUERY_TOOLSET',
  BIG_QUERY_TOOL_CONFIG = 'BIG_QUERY_TOOL_CONFIG',
  BIGTABLE_TOOL_SETTINGS = 'BIGTABLE_TOOL_SETTINGS',
  BIGTABLE_TOOLSET = 'BIGTABLE_TOOLSET',
  COMPUTER_USE = 'COMPUTER_USE',
  GOOGLE_CREDENTIALS_CONFIG = 'GOOGLE_CREDENTIALS_CONFIG',
  GOOGLE_TOOL = 'GOOGLE_TOOL',
  JSON_SCHEMA_FOR_FUNC_DECL = 'JSON_SCHEMA_FOR_FUNC_DECL',
  PROGRESSIVE_SSE_STREAMING = 'PROGRESSIVE_SSE_STREAMING',
  PUBSUB_TOOL_CONFIG = 'PUBSUB_TOOL_CONFIG',
  PUBSUB_TOOLSET = 'PUBSUB_TOOLSET',
  SPANNER_TOOLSET = 'SPANNER_TOOLSET',
  SPANNER_TOOL_SETTINGS = 'SPANNER_TOOL_SETTINGS',
  SPANNER_VECTOR_STORE = 'SPANNER_VECTOR_STORE',
  TOOL_CONFIG = 'TOOL_CONFIG',
  TOOL_CONFIRMATION = 'TOOL_CONFIRMATION',
}

/**
 * Feature lifecycle stages.
 */
export enum FeatureStage {
  /** Work in progress, not functioning completely. ADK internal development only. */
  WIP = 'wip',
  /** Feature works but API may change. */
  EXPERIMENTAL = 'experimental',
  /** Production-ready, no breaking changes without MAJOR version bump. */
  STABLE = 'stable',
}

/**
 * Feature configuration.
 */
export interface FeatureConfig {
  /** The feature stage. */
  stage: FeatureStage;
  /** Whether the feature is enabled by default. */
  defaultOn: boolean;
}

// Central registry: FeatureName -> FeatureConfig
const FEATURE_REGISTRY: Map<FeatureName, FeatureConfig> = new Map([
  [
    FeatureName.AUTHENTICATED_FUNCTION_TOOL,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
  [
    FeatureName.BASE_AUTHENTICATED_TOOL,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
  [
    FeatureName.BIG_QUERY_TOOLSET,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
  [
    FeatureName.BIG_QUERY_TOOL_CONFIG,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
  [
    FeatureName.BIGTABLE_TOOL_SETTINGS,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
  [
    FeatureName.BIGTABLE_TOOLSET,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
  [FeatureName.COMPUTER_USE, {stage: FeatureStage.EXPERIMENTAL, defaultOn: true}],
  [
    FeatureName.GOOGLE_CREDENTIALS_CONFIG,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
  [FeatureName.GOOGLE_TOOL, {stage: FeatureStage.EXPERIMENTAL, defaultOn: true}],
  [
    FeatureName.JSON_SCHEMA_FOR_FUNC_DECL,
    {stage: FeatureStage.WIP, defaultOn: false},
  ],
  [
    FeatureName.PROGRESSIVE_SSE_STREAMING,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
  [
    FeatureName.PUBSUB_TOOL_CONFIG,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
  [
    FeatureName.PUBSUB_TOOLSET,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
  [
    FeatureName.SPANNER_TOOLSET,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
  [
    FeatureName.SPANNER_TOOL_SETTINGS,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
  [
    FeatureName.SPANNER_VECTOR_STORE,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
  [FeatureName.TOOL_CONFIG, {stage: FeatureStage.EXPERIMENTAL, defaultOn: true}],
  [
    FeatureName.TOOL_CONFIRMATION,
    {stage: FeatureStage.EXPERIMENTAL, defaultOn: true},
  ],
]);

// Track which experimental features have already warned (warn only once)
const WARNED_FEATURES: Set<FeatureName> = new Set();

// Programmatic overrides (highest priority, checked before env vars)
const FEATURE_OVERRIDES: Map<FeatureName, boolean> = new Map();

/**
 * Get the configuration for a feature from the registry.
 *
 * @param featureName - The feature name.
 * @returns The feature config from the registry, or undefined if not found.
 */
function getFeatureConfig(featureName: FeatureName): FeatureConfig | undefined {
  return FEATURE_REGISTRY.get(featureName);
}

/**
 * Register a feature with a specific config.
 *
 * @param featureName - The feature name.
 * @param config - The feature config to register.
 */
export function registerFeature(
  featureName: FeatureName,
  config: FeatureConfig
): void {
  FEATURE_REGISTRY.set(featureName, config);
}

/**
 * Programmatically override a feature's enabled state.
 *
 * This override takes highest priority, superseding environment variables
 * and registry defaults. Use this when environment variables are not
 * available or practical in your deployment environment.
 *
 * @param featureName - The feature name to override.
 * @param enabled - Whether the feature should be enabled.
 * @throws Error if the feature is not registered.
 *
 * @example
 * ```typescript
 * import {FeatureName, overrideFeatureEnabled} from '@google/adk';
 *
 * // Enable a feature programmatically
 * overrideFeatureEnabled(FeatureName.JSON_SCHEMA_FOR_FUNC_DECL, true);
 * ```
 */
export function overrideFeatureEnabled(
  featureName: FeatureName,
  enabled: boolean
): void {
  const config = getFeatureConfig(featureName);
  if (!config) {
    throw new Error(`Feature ${featureName} is not registered.`);
  }
  FEATURE_OVERRIDES.set(featureName, enabled);
}

/**
 * Clear a programmatic feature override.
 *
 * @param featureName - The feature name to clear.
 */
export function clearFeatureOverride(featureName: FeatureName): void {
  FEATURE_OVERRIDES.delete(featureName);
}

/**
 * Clear all programmatic feature overrides.
 * Useful for testing.
 */
export function clearAllFeatureOverrides(): void {
  FEATURE_OVERRIDES.clear();
}

/**
 * Clear all warned features.
 * Useful for testing.
 */
export function clearWarnedFeatures(): void {
  WARNED_FEATURES.clear();
}

/**
 * Check if an environment variable is set to a truthy value.
 *
 * @param envVar - The environment variable name.
 * @returns True if the environment variable is set to a truthy value.
 */
function isEnvEnabled(envVar: string): boolean {
  const value = process.env[envVar];
  if (!value) {
    return false;
  }
  const lowerValue = value.toLowerCase();
  return lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes';
}

/**
 * Emit a warning for a non-stable feature, but only once per feature.
 *
 * @param featureName - The feature name.
 * @param featureStage - The feature stage.
 */
function emitNonStableWarningOnce(
  featureName: FeatureName,
  featureStage: FeatureStage
): void {
  if (!WARNED_FEATURES.has(featureName)) {
    WARNED_FEATURES.add(featureName);
    const fullMessage = `[${featureStage.toUpperCase()}] feature ${featureName} is enabled.`;
    logger.warn(fullMessage);
  }
}

/**
 * Check if a feature is enabled at runtime.
 *
 * This function is used for runtime behavior gating within stable features.
 * It allows you to conditionally enable new behavior based on feature flags.
 *
 * Priority order (highest to lowest):
 *   1. Programmatic overrides (via overrideFeatureEnabled)
 *   2. Environment variables (ADK_ENABLE_* / ADK_DISABLE_*)
 *   3. Registry defaults
 *
 * @param featureName - The feature name (e.g., FeatureName.RESUMABILITY).
 * @returns True if the feature is enabled, False otherwise.
 * @throws Error if the feature is not registered.
 *
 * @example
 * ```typescript
 * import {FeatureName, isFeatureEnabled} from '@google/adk';
 *
 * function executeAgentLoop() {
 *   if (isFeatureEnabled(FeatureName.RESUMABILITY)) {
 *     // New behavior: save checkpoints for resuming
 *     return executeWithCheckpoints();
 *   } else {
 *     // Old behavior: run without checkpointing
 *     return executeStandard();
 *   }
 * }
 * ```
 */
export function isFeatureEnabled(featureName: FeatureName): boolean {
  const config = getFeatureConfig(featureName);
  if (!config) {
    throw new Error(`Feature ${featureName} is not registered.`);
  }

  // Check programmatic overrides first (highest priority)
  if (FEATURE_OVERRIDES.has(featureName)) {
    const enabled = FEATURE_OVERRIDES.get(featureName)!;
    if (enabled && config.stage !== FeatureStage.STABLE) {
      emitNonStableWarningOnce(featureName, config.stage);
    }
    return enabled;
  }

  // Check environment variables second
  const enableVar = `ADK_ENABLE_${featureName}`;
  const disableVar = `ADK_DISABLE_${featureName}`;
  if (isEnvEnabled(enableVar)) {
    if (config.stage !== FeatureStage.STABLE) {
      emitNonStableWarningOnce(featureName, config.stage);
    }
    return true;
  }
  if (isEnvEnabled(disableVar)) {
    return false;
  }

  // Fall back to registry config
  if (config.stage !== FeatureStage.STABLE && config.defaultOn) {
    emitNonStableWarningOnce(featureName, config.stage);
  }
  return config.defaultOn;
}

/**
 * Get all registered feature names.
 *
 * @returns Array of all registered feature names.
 */
export function getAllFeatureNames(): FeatureName[] {
  return Array.from(FEATURE_REGISTRY.keys());
}

/**
 * Apply feature overrides from CLI flags.
 *
 * @param enableFeatures - Array of feature names to enable (comma-separated strings allowed).
 */
export function applyFeatureOverrides(enableFeatures: string[]): void {
  for (const featuresStr of enableFeatures) {
    for (let featureNameStr of featuresStr.split(',')) {
      featureNameStr = featureNameStr.trim();
      if (!featureNameStr) {
        continue;
      }
      if (Object.values(FeatureName).includes(featureNameStr as FeatureName)) {
        overrideFeatureEnabled(featureNameStr as FeatureName, true);
      } else {
        const validNames = Object.values(FeatureName).join(', ');
        logger.warn(
          `Unknown feature name '${featureNameStr}'. Valid names are: ${validNames}`
        );
      }
    }
  }
}
