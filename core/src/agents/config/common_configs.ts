/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {z} from 'zod';

/**
 * Configuration for a single argument in code references.
 *
 * Arguments can be named (with a `name` property) or positional (value only).
 */
export const ArgumentConfigSchema = z.object({
  /** The name of the argument (for named arguments). */
  name: z.string().optional(),
  /** The argument value. */
  value: z.unknown(),
});

/**
 * An argument configuration for code references.
 */
export type ArgumentConfig = z.infer<typeof ArgumentConfigSchema>;

/**
 * Configuration for referencing code (functions, classes, or instances).
 *
 * Used to specify callbacks, custom models, tools, and schemas by
 * their fully qualified name (module path + name).
 *
 * @example
 * ```yaml
 * # Simple reference (no arguments)
 * modelCode:
 *   name: my_package.models.create_custom_model
 *
 * # Reference with arguments
 * modelCode:
 *   name: my_package.models.create_custom_model
 *   args:
 *     - name: api_base
 *       value: https://api.example.com
 *     - name: temperature
 *       value: 0.7
 * ```
 */
export const CodeConfigSchema = z.object({
  /**
   * Fully qualified name of the code reference.
   *
   * For built-in tools, this can be the simple name (e.g., "google_search").
   * For user-defined code, use the fully qualified path
   * (e.g., "my_package.my_module.my_function").
   */
  name: z.string(),
  /**
   * Optional arguments to pass when instantiating the reference.
   *
   * Used when the reference is a class (constructor args) or
   * a factory function (function args).
   */
  args: z.array(ArgumentConfigSchema).optional(),
});

/**
 * A code reference configuration.
 */
export type CodeConfig = z.infer<typeof CodeConfigSchema>;

/**
 * Configuration for referencing a sub-agent.
 *
 * Sub-agents can be specified either by:
 * - A path to another YAML configuration file (`configPath`)
 * - A fully qualified reference to a code variable (`code`)
 *
 * Exactly one of `configPath` or `code` must be specified.
 *
 * @example
 * ```yaml
 * # Reference via config file
 * subAgents:
 *   - configPath: ./sub_agent.yaml
 *
 * # Reference via code
 * subAgents:
 *   - code: my_package.agents.sub_agent_instance
 * ```
 */
export const AgentRefConfigSchema = z.object({
  /**
   * Path to the agent's YAML configuration file.
   * Can be absolute or relative to the current config file.
   */
  configPath: z.string().optional(),
  /**
   * Fully qualified reference to an agent instance or class.
   */
  code: z.string().optional(),
}).refine(
    (data) => {
      const hasConfigPath = data.configPath !== undefined;
      const hasCode = data.code !== undefined;
      return (hasConfigPath && !hasCode) || (!hasConfigPath && hasCode);
    },
    {
      message: 'Exactly one of configPath or code must be specified',
    },
);

/**
 * An agent reference configuration.
 */
export type AgentRefConfig = z.infer<typeof AgentRefConfigSchema>;

/**
 * Configuration for a tool.
 *
 * Tools can be:
 * 1. Built-in ADK tools (e.g., "google_search", "code_execution")
 * 2. User-defined tool classes or instances
 * 3. Factory functions that return tools
 * 4. Regular functions to be wrapped as FunctionTools
 *
 * @example
 * ```yaml
 * tools:
 *   # Built-in tool (simple name)
 *   - name: google_search
 *
 *   # User-defined tool class with arguments
 *   - name: my_package.tools.CustomTool
 *     args:
 *       api_key: ${API_KEY}
 *       timeout: 30
 *
 *   # Tool instance (no arguments)
 *   - name: my_package.tools.my_tool_instance
 * ```
 */
export const ToolConfigSchema = z.object({
  /**
   * Name of the tool.
   *
   * Can be a simple name for built-in tools (e.g., "google_search")
   * or a fully qualified path for user-defined tools
   * (e.g., "my_package.tools.MyTool").
   */
  name: z.string(),
  /**
   * Optional arguments for tool instantiation.
   *
   * Used when the tool is a class or factory function.
   * For simple record-style args, use a key-value object.
   */
  args: z.record(z.unknown()).optional(),
});

/**
 * A tool configuration.
 */
export type ToolConfig = z.infer<typeof ToolConfigSchema>;

/**
 * Converts ArgumentConfig array to a key-value record.
 * Positional arguments are converted to indexed keys ("0", "1", etc.).
 */
export function argsToRecord(
    args?: ArgumentConfig[],
    ): Record<string, unknown>|undefined {
  if (!args || args.length === 0) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  let positionalIndex = 0;

  for (const arg of args) {
    if (arg.name !== undefined) {
      result[arg.name] = arg.value;
    } else {
      result[String(positionalIndex++)] = arg.value;
    }
  }

  return result;
}

/**
 * Checks if a value is a plain object (not null, not array, not class instance).
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Checks if a function is a class constructor.
 *
 * Classes in JavaScript are functions with a prototype that has a constructor.
 * Arrow functions and bound functions are not classes.
 */
export function isClass(fn: unknown): fn is new (...args: unknown[]) => unknown {
  if (typeof fn !== 'function') {
    return false;
  }

  // Check if it has prototype (classes do, arrow functions don't)
  if (!fn.prototype) {
    return false;
  }

  // Check if it's a native class (ES6+)
  const fnString = fn.toString();
  if (fnString.startsWith('class ') || fnString.startsWith('class{')) {
    return true;
  }

  // Check for constructor pattern in prototype
  return fn.prototype.constructor === fn &&
      Object.getOwnPropertyNames(fn.prototype).length > 1;
}
