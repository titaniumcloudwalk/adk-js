/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {State} from './state.js';

/**
 * Result of extracting state deltas from a state dictionary.
 */
export interface StateDeltas {
  /** App-level state (keys with app: prefix removed). */
  app: Record<string, unknown>;
  /** User-level state (keys with user: prefix removed). */
  user: Record<string, unknown>;
  /** Session-level state (keys without prefixes). */
  session: Record<string, unknown>;
}

/**
 * Extracts app, user, and session state deltas from a state dictionary.
 *
 * Keys prefixed with 'app:' are extracted to the app delta (prefix removed).
 * Keys prefixed with 'user:' are extracted to the user delta (prefix removed).
 * Keys prefixed with 'temp:' are ignored (temporary state).
 * All other keys are extracted to the session delta.
 *
 * @param state The state dictionary to extract deltas from.
 * @returns An object containing app, user, and session state deltas.
 */
export function extractStateDelta(
    state?: Record<string, unknown>): StateDeltas {
  const deltas: StateDeltas = {app: {}, user: {}, session: {}};

  if (!state) {
    return deltas;
  }

  for (const key of Object.keys(state)) {
    if (key.startsWith(State.APP_PREFIX)) {
      deltas.app[key.substring(State.APP_PREFIX.length)] = state[key];
    } else if (key.startsWith(State.USER_PREFIX)) {
      deltas.user[key.substring(State.USER_PREFIX.length)] = state[key];
    } else if (!key.startsWith(State.TEMP_PREFIX)) {
      deltas.session[key] = state[key];
    }
    // temp: prefixed keys are ignored (not persisted)
  }

  return deltas;
}

/**
 * Merges app, user, and session states into a single state dictionary.
 *
 * App-level state keys are prefixed with 'app:'.
 * User-level state keys are prefixed with 'user:'.
 * Session-level state keys are used as-is.
 *
 * @param appState The app-level state.
 * @param userState The user-level state.
 * @param sessionState The session-level state.
 * @returns A merged state dictionary with appropriate prefixes.
 */
export function mergeState(
    appState: Record<string, unknown>,
    userState: Record<string, unknown>,
    sessionState: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {...sessionState};

  for (const key of Object.keys(appState)) {
    merged[State.APP_PREFIX + key] = appState[key];
  }

  for (const key of Object.keys(userState)) {
    merged[State.USER_PREFIX + key] = userState[key];
  }

  return merged;
}
