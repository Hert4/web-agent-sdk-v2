/**
 * @fileoverview BrowserAdapter - Abstraction for browser automation
 * 
 * Supports both:
 * - Browser environment (direct DOM manipulation)
 * - Node.js with Playwright/Puppeteer
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
}

export interface TypeOptions {
  delay?: number;
}

export interface WaitOptions {
  timeout?: number;
  state?: 'visible' | 'hidden' | 'attached' | 'detached';
}

export interface ScreenshotOptions {
  fullPage?: boolean;
  path?: string;
}

// ============================================================================
// ABSTRACT BASE CLASS
// ============================================================================

export abstract class BrowserAdapter {
  abstract click(element: Element | string, options?: ClickOptions): Promise<void>;
  abstract doubleClick(element: Element | string): Promise<void>;
  abstract type(element: Element | string, text: string, options?: TypeOptions): Promise<void>;
  abstract clear(element: Element | string): Promise<void>;
  abstract select(element: Element | string, value: string | string[]): Promise<void>;
  abstract check(element: Element | string): Promise<void>;
  abstract uncheck(element: Element | string): Promise<void>;
  abstract hover(element: Element | string): Promise<void>;
  abstract focus(element: Element | string): Promise<void>;
  abstract scroll(direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void>;
  abstract scrollToElement(element: Element | string): Promise<void>;
  abstract press(key: string, modifiers?: string[]): Promise<void>;
  abstract wait(duration: number): Promise<void>;
  abstract waitForSelector(selector: string, options?: WaitOptions): Promise<void>;
  abstract navigate(url: string): Promise<void>;
  abstract goBack(): Promise<void>;
  abstract goForward(): Promise<void>;
  abstract refresh(): Promise<void>;
  abstract screenshot(options?: ScreenshotOptions): Promise<string>;
  abstract getUrl(): string;
  abstract getTitle(): string;
}

// ============================================================================
// BROWSER ADAPTER (for browser environment)
// ============================================================================

export class DOMBrowserAdapter extends BrowserAdapter {
  private document: Document;
  private window: Window;

  constructor(doc?: Document, win?: Window) {
    super();
    this.document = doc || document;
    this.window = win || window;
  }

  private getElement(elementOrSelector: Element | string): Element {
    if (typeof elementOrSelector === 'string') {
      const el = this.document.querySelector(elementOrSelector);
      if (!el) throw new Error(`Element not found: ${elementOrSelector}`);
      return el;
    }
    return elementOrSelector;
  }

  async click(element: Element | string, options?: ClickOptions): Promise<void> {
    const el = this.getElement(element);

    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      button: options?.button === 'right' ? 2 : options?.button === 'middle' ? 1 : 0,
    });

    el.dispatchEvent(event);

    // Also trigger native click for form elements
    if (el instanceof HTMLElement) {
      el.click();
    }
  }

  async doubleClick(element: Element | string): Promise<void> {
    const el = this.getElement(element);

    const event = new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true,
    });

    el.dispatchEvent(event);
  }

  async type(element: Element | string, text: string, options?: TypeOptions): Promise<void> {
    const el = this.getElement(element);

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();

      // Type character by character with delay
      const delay = options?.delay ?? 0;

      for (const char of text) {
        el.value += char;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: char }));

        if (delay > 0) {
          await this.wait(delay);
        }
      }

      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.hasAttribute('contenteditable')) {
      el.textContent = (el.textContent || '') + text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
  }

  async clear(element: Element | string): Promise<void> {
    const el = this.getElement(element);

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = '';
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (el.hasAttribute('contenteditable')) {
      el.textContent = '';
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
  }

  async select(element: Element | string, value: string | string[]): Promise<void> {
    const el = this.getElement(element);

    if (el instanceof HTMLSelectElement) {
      const values = Array.isArray(value) ? value : [value];

      for (const option of el.options) {
        option.selected = values.includes(option.value);
      }

      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  async check(element: Element | string): Promise<void> {
    const el = this.getElement(element);

    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      if (!el.checked) {
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  async uncheck(element: Element | string): Promise<void> {
    const el = this.getElement(element);

    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      if (el.checked) {
        el.checked = false;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  async hover(element: Element | string): Promise<void> {
    const el = this.getElement(element);

    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  }

  async focus(element: Element | string): Promise<void> {
    const el = this.getElement(element);

    if (el instanceof HTMLElement) {
      el.focus();
    }
  }

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void> {
    const x = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const y = direction === 'up' ? -amount : direction === 'down' ? amount : 0;

    this.window.scrollBy({ left: x, top: y, behavior: 'smooth' });
  }

  async scrollToElement(element: Element | string): Promise<void> {
    const el = this.getElement(element);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // async press(key: string, modifiers?: string[]): Promise<void> {
  //   const eventInit: KeyboardEventInit = {
  //     key,
  //     bubbles: true,
  //     cancelable: true,
  //     ctrlKey: modifiers?.includes('Control'),
  //     shiftKey: modifiers?.includes('Shift'),
  //     altKey: modifiers?.includes('Alt'),
  //     metaKey: modifiers?.includes('Meta'),
  //   };

  //   this.document.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  //   this.document.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  // }

  async press(key: string, modifiers?: string[]): Promise<void> {
    const eventInit: KeyboardEventInit = {
      key,
      bubbles: true,
      cancelable: true,
      ctrlKey: modifiers?.includes('Control') ?? false,
      shiftKey: modifiers?.includes('Shift') ?? false,
      altKey: modifiers?.includes('Alt') ?? false,
      metaKey: modifiers?.includes('Meta') ?? false,
    };

    this.document.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    this.document.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  }

  async wait(duration: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, duration));
  }

  async waitForSelector(selector: string, options?: WaitOptions): Promise<void> {
    const timeout = options?.timeout ?? 5000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const el = this.document.querySelector(selector);

      if (options?.state === 'hidden' || options?.state === 'detached') {
        if (!el) return;
      } else {
        if (el) {
          if (options?.state === 'visible') {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return;
          } else {
            return;
          }
        }
      }

      await this.wait(100);
    }

    throw new Error(`Timeout waiting for selector: ${selector}`);
  }

  async navigate(url: string): Promise<void> {
    this.window.location.href = url;
  }

  async goBack(): Promise<void> {
    this.window.history.back();
  }

  async goForward(): Promise<void> {
    this.window.history.forward();
  }

  async refresh(): Promise<void> {
    this.window.location.reload();
  }

  async screenshot(_options?: ScreenshotOptions): Promise<string> {
    // In browser, we'd need html2canvas or similar
    console.warn('Screenshot not implemented in browser adapter');
    return '';
  }

  getUrl(): string {
    return this.window.location.href;
  }

  getTitle(): string {
    return this.document.title;
  }
}

// ============================================================================
// PLAYWRIGHT ADAPTER (for Node.js)
// ============================================================================

export class PlaywrightAdapter extends BrowserAdapter {
  // Exposed for Node-mode distiller (duck-typed in WebAgent.setBrowserAdapter)
  public page: PlaywrightPage;
  private cachedTitle = '';

  constructor(page: PlaywrightPage) {
    super();
    this.page = page;
  }

  private getSelector(element: Element | string): string {
    if (typeof element === 'string') return element;
    // If Element is passed, we need to convert to selector
    // This shouldn't happen in Playwright context but handle gracefully
    throw new Error('PlaywrightAdapter requires string selectors');
  }

  async click(element: Element | string, options?: ClickOptions): Promise<void> {
    const selector = this.getSelector(element);
    await this.page.click(selector, {
      button: options?.button,
      clickCount: options?.clickCount,
      delay: options?.delay,
    });
  }

  async doubleClick(element: Element | string): Promise<void> {
    const selector = this.getSelector(element);
    await this.page.dblclick(selector);
  }

  async type(element: Element | string, text: string, options?: TypeOptions): Promise<void> {
    const selector = this.getSelector(element);
    await this.page.type(selector, text, { delay: options?.delay });
  }

  async clear(element: Element | string): Promise<void> {
    const selector = this.getSelector(element);
    await this.page.fill(selector, '');
  }

  async select(element: Element | string, value: string | string[]): Promise<void> {
    const selector = this.getSelector(element);
    await this.page.selectOption(selector, value);
  }

  async check(element: Element | string): Promise<void> {
    const selector = this.getSelector(element);
    await this.page.check(selector);
  }

  async uncheck(element: Element | string): Promise<void> {
    const selector = this.getSelector(element);
    await this.page.uncheck(selector);
  }

  async hover(element: Element | string): Promise<void> {
    const selector = this.getSelector(element);
    await this.page.hover(selector);
  }

  async focus(element: Element | string): Promise<void> {
    const selector = this.getSelector(element);
    await this.page.focus(selector);
  }

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void> {
    const x = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
    const y = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
    await this.page.mouse.wheel(x, y);
  }

  async scrollToElement(element: Element | string): Promise<void> {
    const selector = this.getSelector(element);
    await this.page.locator(selector).scrollIntoViewIfNeeded();
  }

  async press(key: string, modifiers?: string[]): Promise<void> {
    const combo = modifiers ? `${modifiers.join('+')}+${key}` : key;
    await this.page.keyboard.press(combo);
  }

  async wait(duration: number): Promise<void> {
    await this.page.waitForTimeout(duration);
  }

  async waitForSelector(selector: string, options?: WaitOptions): Promise<void> {
    await this.page.waitForSelector(selector, {
      timeout: options?.timeout,
      state: options?.state,
    });
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url);
    this.cachedTitle = await this.page.title();
  }

  async goBack(): Promise<void> {
    await this.page.goBack();
    this.cachedTitle = await this.page.title();
  }

  async goForward(): Promise<void> {
    await this.page.goForward();
    this.cachedTitle = await this.page.title();
  }

  async refresh(): Promise<void> {
    await this.page.reload();
    this.cachedTitle = await this.page.title();
  }

  async screenshot(options?: ScreenshotOptions): Promise<string> {
    const buffer = await this.page.screenshot({
      fullPage: options?.fullPage,
      path: options?.path,
    });
    return buffer.toString('base64');
  }

  getUrl(): string {
    return this.page.url();
  }

  getTitle(): string {
    return this.cachedTitle;
  }

  /** Refresh the cached title from the page (call after navigations). */
  async refreshTitle(): Promise<string> {
    this.cachedTitle = await this.page.title();
    return this.cachedTitle;
  }
}

// ============================================================================
// TYPE DECLARATIONS
// ============================================================================

interface PlaywrightPage {
  click(selector: string, options?: unknown): Promise<void>;
  dblclick(selector: string): Promise<void>;
  type(selector: string, text: string, options?: unknown): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  // Playwright's Page.selectOption returns the selected values (string[])
  // https://playwright.dev/docs/api/class-page#page-select-option
  selectOption(selector: string, value: string | string[]): Promise<string[]>;
  check(selector: string): Promise<void>;
  uncheck(selector: string): Promise<void>;
  hover(selector: string): Promise<void>;
  focus(selector: string): Promise<void>;
  mouse: { wheel(x: number, y: number): Promise<void> };
  locator(selector: string): { scrollIntoViewIfNeeded(): Promise<void> };
  keyboard: { press(key: string): Promise<void> };
  waitForTimeout(timeout: number): Promise<void>;
  // Playwright returns an ElementHandle (or null) here; we don't use the return value.
  waitForSelector(selector: string, options?: unknown): Promise<unknown>;
  goto(url: string): Promise<unknown>;
  goBack(): Promise<unknown>;
  goForward(): Promise<unknown>;
  reload(): Promise<unknown>;
  screenshot(options?: unknown): Promise<Buffer>;
  url(): string;
  title(): Promise<string>;
}
