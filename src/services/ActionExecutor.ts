/**
 * @fileoverview ActionExecutor - Executes browser actions
 */

import type {
  ActionType,
  ActionParams,
  ActionResult,
  ActionError,
  ActionErrorCode,
  ElementSnapshot,
} from '../types';
import type { BrowserAdapter } from '../infrastructure/BrowserAdapter';
import type { DOMDistiller } from './DOMDistiller';

// ============================================================================
// TYPES
// ============================================================================

export interface ActionExecutorConfig {
  defaultTimeout?: number;
  typeDelay?: number;
  scrollAmount?: number;
}

// ============================================================================
// ACTION EXECUTOR
// ============================================================================

export class ActionExecutor {
  private browser: BrowserAdapter;
  private distiller: DOMDistiller;
  private config: Required<ActionExecutorConfig>;
  // In Node+Playwright we can't pass real DOM Elements around.
  // This map lets us resolve distiller indices to selectors.
  private indexToSelector: Map<number, string> = new Map();
  
  constructor(
    browser: BrowserAdapter,
    distiller: DOMDistiller,
    config: ActionExecutorConfig = {}
  ) {
    this.browser = browser;
    this.distiller = distiller;
    this.config = {
      defaultTimeout: config.defaultTimeout ?? 5000,
      typeDelay: config.typeDelay ?? 50,
      scrollAmount: config.scrollAmount ?? 300,
    };
  }

  /**
   * Provide a mapping from element index -> selector.
   * Used by PlaywrightAdapter to execute actions.
   */
  setIndexToSelectorMap(map: Map<number, string>): void {
    this.indexToSelector = map;
  }
  
  /**
   * Execute an action
   */
  async execute<T extends ActionType>(
    action: T,
    params: ActionParams[T]
  ): Promise<ActionResult> {
    const startTime = Date.now();
    let before: ElementSnapshot | undefined;
    let after: ElementSnapshot | undefined;
    
    try {
      // Get element snapshot before action
      if ('index' in params && typeof params.index === 'number') {
        before = await this.getElementSnapshot(params.index);
      }
      
      // Execute the action
      await this.executeAction(action, params);
      
      // Get element snapshot after action
      if (before) {
        after = await this.getElementSnapshot((params as { index: number }).index);
      }
      
      const duration = Date.now() - startTime;
      const verbalFeedback = this.generateFeedback(action, params, true);
      
      return {
        success: true,
        action,
        params,
        duration,
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
        verbalFeedback,
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      const actionError = this.createError(error);
      const verbalFeedback = this.generateFeedback(action, params, false, actionError);
      
      return {
        success: false,
        action,
        params,
        error: actionError,
        duration,
        ...(before ? { before } : {}),
        verbalFeedback,
      };
    }
  }
  
  /**
   * Execute specific action type
   */
  private async executeAction<T extends ActionType>(
    action: T,
    params: ActionParams[T]
  ): Promise<void> {
    switch (action) {
      case 'click': {
        const p = params as ActionParams['click'];
        const element = this.getElement(p.index);
        await this.browser.click(element, p.button ? { button: p.button } : {});
        break;
      }
      
      case 'doubleClick': {
        const p = params as ActionParams['doubleClick'];
        const element = this.getElement(p.index);
        await this.browser.doubleClick(element);
        break;
      }
      
      case 'type': {
        const p = params as ActionParams['type'];
        const element = this.getElement(p.index);
        if (p.clearFirst) {
          await this.browser.clear(element);
        }
        await this.browser.type(element, p.text, { delay: p.delay ?? this.config.typeDelay });
        break;
      }
      
      case 'clear': {
        const p = params as ActionParams['clear'];
        const element = this.getElement(p.index);
        await this.browser.clear(element);
        break;
      }
      
      case 'select': {
        const p = params as ActionParams['select'];
        const element = this.getElement(p.index);
        await this.browser.select(element, p.value);
        break;
      }
      
      case 'check': {
        const p = params as ActionParams['check'];
        const element = this.getElement(p.index);
        await this.browser.check(element);
        break;
      }
      
      case 'uncheck': {
        const p = params as ActionParams['uncheck'];
        const element = this.getElement(p.index);
        await this.browser.uncheck(element);
        break;
      }
      
      case 'hover': {
        const p = params as ActionParams['hover'];
        const element = this.getElement(p.index);
        await this.browser.hover(element);
        break;
      }
      
      case 'scroll': {
        const p = params as ActionParams['scroll'];
        await this.browser.scroll(p.direction, p.amount ?? this.config.scrollAmount);
        break;
      }
      
      case 'scrollToElement': {
        const p = params as ActionParams['scrollToElement'];
        const element = this.getElement(p.index);
        await this.browser.scrollToElement(element);
        break;
      }
      
      case 'focus': {
        const p = params as ActionParams['focus'];
        const element = this.getElement(p.index);
        await this.browser.focus(element);
        break;
      }
      
      case 'press': {
        const p = params as ActionParams['press'];
        await this.browser.press(p.key, p.modifiers);
        break;
      }
      
      case 'wait': {
        const p = params as ActionParams['wait'];
        await this.browser.wait(p.duration);
        break;
      }
      
      case 'waitForElement': {
        const p = params as ActionParams['waitForElement'];
        await this.browser.waitForSelector(p.selector, {
          timeout: p.timeout ?? this.config.defaultTimeout,
          ...(p.state ? { state: p.state } : {}),
        });
        break;
      }
      
      case 'navigate': {
        const p = params as ActionParams['navigate'];
        await this.browser.navigate(p.url);
        break;
      }
      
      case 'goBack': {
        await this.browser.goBack();
        break;
      }
      
      case 'goForward': {
        await this.browser.goForward();
        break;
      }
      
      case 'refresh': {
        await this.browser.refresh();
        break;
      }
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
  
  /**
   * Get element by index from distiller
   */
  private getElement(index: number): Element {
    // Browser mode: we have real Elements.
    const element = this.distiller.getElement(index);
    if (element) return element;

    // Node mode: fall back to selector string (casted through Element to satisfy types).
    const selector = this.indexToSelector.get(index);
    if (selector) return selector as unknown as Element;

    throw new Error(`Element not found at index ${index}`);
  }
  
  /**
   * Get snapshot of element state
   */
  private async getElementSnapshot(index: number): Promise<ElementSnapshot | undefined> {
    try {
      const element = this.distiller.getElement(index);
      if (!element) return undefined;
      
      const rect = element.getBoundingClientRect();
      
      const snapshot: ElementSnapshot = {
        index,
        selector: element.id ? `#${element.id}` : element.tagName.toLowerCase(),
        exists: true,
        visible: rect.width > 0 && rect.height > 0,
        ...(element instanceof HTMLInputElement ? { value: element.value } : {}),
        ...(element.textContent ? { text: element.textContent.slice(0, 100) } : {}),
        ...(rect.width > 0 ? { boundingBox: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        } } : {}),
      };
      return snapshot;
    } catch {
      return undefined;
    }
  }
  
  /**
   * Create error object from exception
   */
  private createError(error: unknown): ActionError {
    const message = error instanceof Error ? error.message : String(error);
    
    let code: ActionErrorCode = 'UNKNOWN' as ActionErrorCode;
    let recoverable = true;
    let suggestion: string | undefined;
    
    if (message.includes('not found')) {
      code = 'ELEMENT_NOT_FOUND' as ActionErrorCode;
      suggestion = 'Try refreshing the page or waiting for the element';
    } else if (message.includes('not visible')) {
      code = 'ELEMENT_NOT_VISIBLE' as ActionErrorCode;
      suggestion = 'Try scrolling to the element first';
    } else if (message.includes('timeout')) {
      code = 'TIMEOUT' as ActionErrorCode;
      suggestion = 'Try increasing the timeout or waiting for page load';
    } else if (message.includes('network')) {
      code = 'NETWORK_ERROR' as ActionErrorCode;
      recoverable = false;
    }
    
    return { code, message, recoverable, ...(suggestion ? { suggestion } : {}) };
  }
  
  /**
   * Capture screenshot and return base64 string
   */
  async captureScreenshot(fullPage = false): Promise<string> {
    return this.browser.screenshot({ fullPage });
  }
  
  /**
   * Generate human-readable feedback
   */
  private generateFeedback(
    action: ActionType,
    params: ActionParams[ActionType],
    success: boolean,
    error?: ActionError
  ): string {
    if (!success && error) {
      return `Failed to ${action}: ${error.message}`;
    }
    
    switch (action) {
      case 'click':
        return `Clicked element at index ${(params as ActionParams['click']).index}`;
      case 'type':
        return `Typed "${(params as ActionParams['type']).text.slice(0, 20)}..." into element`;
      case 'select':
        return `Selected "${(params as ActionParams['select']).value}" from dropdown`;
      case 'scroll':
        return `Scrolled ${(params as ActionParams['scroll']).direction}`;
      case 'navigate':
        return `Navigated to ${(params as ActionParams['navigate']).url}`;
      case 'wait':
        return `Waited ${(params as ActionParams['wait']).duration}ms`;
      default:
        return `Executed ${action} successfully`;
    }
  }
}
