/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Environment types for computer use operations.
 * Specifies the type of environment the computer is operating in.
 */
export enum ComputerEnvironment {
  /** Defaults to browser. */
  ENVIRONMENT_UNSPECIFIED = 'ENVIRONMENT_UNSPECIFIED',
  /** Operates in a web browser. */
  ENVIRONMENT_BROWSER = 'ENVIRONMENT_BROWSER',
}

/**
 * Represents the current state of the computer environment.
 */
export interface ComputerState {
  /**
   * The screenshot in PNG format as bytes (Uint8Array or Buffer).
   */
  screenshot?: Uint8Array;
  /**
   * The current URL of the webpage being displayed.
   */
  url?: string;
}

/**
 * Direction type for scroll operations.
 */
export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Abstract interface for computer environments.
 *
 * This interface defines the standard interface for controlling
 * computer environments, including web browsers and other interactive systems.
 * Implementations can use browser automation tools like Playwright to
 * provide concrete implementations.
 *
 * @example
 * ```typescript
 * class PlaywrightComputer implements BaseComputer {
 *   private browser: Browser;
 *   private page: Page;
 *
 *   async screenSize(): Promise<[number, number]> {
 *     const viewport = this.page.viewportSize();
 *     return [viewport?.width ?? 1920, viewport?.height ?? 1080];
 *   }
 *
 *   async clickAt(x: number, y: number): Promise<ComputerState> {
 *     await this.page.mouse.click(x, y);
 *     return this.currentState();
 *   }
 *   // ... implement other methods
 * }
 * ```
 */
export interface BaseComputer {
  /**
   * Returns the screen size of the environment.
   * @returns A tuple of [width, height] in pixels.
   */
  screenSize(): Promise<[number, number]>;

  /**
   * Opens the web browser.
   * @returns The current state after opening the browser.
   */
  openWebBrowser(): Promise<ComputerState>;

  /**
   * Clicks at a specific x, y coordinate on the webpage.
   *
   * The 'x' and 'y' values are absolute values, scaled to the height and width of the screen.
   *
   * @param x The x-coordinate to click at.
   * @param y The y-coordinate to click at.
   * @returns The current state after clicking.
   */
  clickAt(x: number, y: number): Promise<ComputerState>;

  /**
   * Hovers at a specific x, y coordinate on the webpage.
   *
   * May be used to explore sub-menus that appear on hover.
   * The 'x' and 'y' values are absolute values, scaled to the height and width of the screen.
   *
   * @param x The x-coordinate to hover at.
   * @param y The y-coordinate to hover at.
   * @returns The current state after hovering.
   */
  hoverAt(x: number, y: number): Promise<ComputerState>;

  /**
   * Types text at a specific x, y coordinate.
   *
   * The system automatically presses ENTER after typing. To disable this, set `pressEnter` to false.
   * The system automatically clears any existing content before typing. To disable this, set `clearBeforeTyping` to false.
   * The 'x' and 'y' values are absolute values, scaled to the height and width of the screen.
   *
   * @param x The x-coordinate to type at.
   * @param y The y-coordinate to type at.
   * @param text The text to type.
   * @param pressEnter Whether to press ENTER after typing. Defaults to true.
   * @param clearBeforeTyping Whether to clear existing content before typing. Defaults to true.
   * @returns The current state after typing.
   */
  typeTextAt(
    x: number,
    y: number,
    text: string,
    pressEnter?: boolean,
    clearBeforeTyping?: boolean,
  ): Promise<ComputerState>;

  /**
   * Scrolls the entire webpage "up", "down", "left" or "right" based on direction.
   *
   * @param direction The direction to scroll.
   * @returns The current state after scrolling.
   */
  scrollDocument(direction: ScrollDirection): Promise<ComputerState>;

  /**
   * Scrolls up, down, right, or left at a x, y coordinate by magnitude.
   *
   * The 'x' and 'y' values are absolute values, scaled to the height and width of the screen.
   *
   * @param x The x-coordinate to scroll at.
   * @param y The y-coordinate to scroll at.
   * @param direction The direction to scroll.
   * @param magnitude The amount to scroll.
   * @returns The current state after scrolling.
   */
  scrollAt(
    x: number,
    y: number,
    direction: ScrollDirection,
    magnitude: number,
  ): Promise<ComputerState>;

  /**
   * Waits for n seconds to allow unfinished webpage processes to complete.
   *
   * @param seconds The number of seconds to wait.
   * @returns The current state after waiting.
   */
  wait(seconds: number): Promise<ComputerState>;

  /**
   * Navigates back to the previous webpage in the browser history.
   *
   * @returns The current state after navigating back.
   */
  goBack(): Promise<ComputerState>;

  /**
   * Navigates forward to the next webpage in the browser history.
   *
   * @returns The current state after navigating forward.
   */
  goForward(): Promise<ComputerState>;

  /**
   * Directly jumps to a search engine home page.
   *
   * Used when you need to start with a search. For example, this is used when
   * the current website doesn't have the information needed or because a new
   * task is being started.
   *
   * @returns The current state after navigating to search.
   */
  search(): Promise<ComputerState>;

  /**
   * Navigates directly to a specified URL.
   *
   * @param url The URL to navigate to.
   * @returns The current state after navigation.
   */
  navigate(url: string): Promise<ComputerState>;

  /**
   * Presses keyboard keys and combinations, such as "control+c" or "enter".
   *
   * @param keys List of keys to press in combination.
   * @returns The current state after key press.
   */
  keyCombination(keys: string[]): Promise<ComputerState>;

  /**
   * Drag and drop an element from a x, y coordinate to a destination coordinate.
   *
   * The 'x', 'y', 'destinationX' and 'destinationY' values are absolute values,
   * scaled to the height and width of the screen.
   *
   * @param x The x-coordinate to start dragging from.
   * @param y The y-coordinate to start dragging from.
   * @param destinationX The x-coordinate to drop at.
   * @param destinationY The y-coordinate to drop at.
   * @returns The current state after drag and drop.
   */
  dragAndDrop(
    x: number,
    y: number,
    destinationX: number,
    destinationY: number,
  ): Promise<ComputerState>;

  /**
   * Returns the current state of the current webpage.
   *
   * @returns The current environment state.
   */
  currentState(): Promise<ComputerState>;

  /**
   * Returns the environment of the computer.
   */
  environment(): Promise<ComputerEnvironment>;

  /**
   * Initialize the computer.
   * Called before the toolset starts using the computer.
   */
  initialize?(): Promise<void>;

  /**
   * Cleanup resources of the computer.
   * Called when the toolset is closed.
   */
  close?(): Promise<void>;
}

/**
 * List of methods that should be excluded when creating tools from BaseComputer methods.
 * These are utility methods that should not be exposed as tools to the LLM.
 */
export const EXCLUDED_COMPUTER_METHODS = new Set([
  'screenSize',
  'environment',
  'close',
  'initialize',
]);
