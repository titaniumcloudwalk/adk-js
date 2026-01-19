/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dynamic import helper for dockerode.
 * This module exists to allow mocking in tests.
 *
 * @internal
 */
export async function importDocker(): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dockerode = await (Function('return import("dockerode")')() as Promise<any>);
  return dockerode.default || dockerode;
}

/**
 * Dynamic import helper for @kubernetes/client-node.
 * This module exists to allow mocking in tests.
 *
 * @internal
 */
export async function importKubernetes(): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (Function('return import("@kubernetes/client-node")')() as Promise<any>);
}
