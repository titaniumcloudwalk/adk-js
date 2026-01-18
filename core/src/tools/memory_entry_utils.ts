/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {MemoryEntry} from '../memory/memory_entry.js';

/**
 * Extracts the text from the memory entry.
 *
 * @param memory The memory entry to extract text from.
 * @param splitter The string to use for joining multiple text parts. Defaults to ' '.
 * @returns The extracted text, or empty string if no text parts are present.
 */
export function extractText(memory: MemoryEntry, splitter: string = ' '): string {
  if (!memory.content.parts) {
    return '';
  }
  return memory.content.parts
      .filter((part) => part.text)
      .map((part) => part.text)
      .join(splitter);
}
