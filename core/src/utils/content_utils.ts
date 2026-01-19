/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, Part} from '@google/genai';

/**
 * Checks if a part contains audio data.
 *
 * @param part The part to check.
 * @returns True if the part contains audio data (inline or file), false otherwise.
 */
export function isAudioPart(part: Part): boolean {
  // Check for inline audio data
  if (
    part.inlineData &&
    part.inlineData.mimeType &&
    part.inlineData.mimeType.startsWith('audio/')
  ) {
    return true;
  }

  // Check for file-based audio data
  if (
    part.fileData &&
    part.fileData.mimeType &&
    part.fileData.mimeType.startsWith('audio/')
  ) {
    return true;
  }

  return false;
}

/**
 * Filters out audio parts from a content object.
 *
 * Audio is filtered out because:
 * 1. Audio has already been transcribed.
 * 2. Sending audio via connection.send or connection.sendLiveContent is
 *    not supported by LIVE API (session will be corrupted).
 *
 * This function is used when:
 * 1. Agent transfer to a new agent
 * 2. Establishing a new live connection with previous ADK session history
 *
 * @param content The content to filter.
 * @returns A new Content with audio parts removed, or null if all parts were audio.
 */
export function filterAudioParts(content: Content): Content | null {
  if (!content.parts) {
    return null;
  }

  const filteredParts = content.parts.filter((part) => !isAudioPart(part));

  if (filteredParts.length === 0) {
    return null;
  }

  return {
    role: content.role,
    parts: filteredParts,
  };
}
