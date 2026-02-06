/**
 * @fileoverview PlaywrightDistiller
 *
 * A DOMDistiller implementation that works in Node.js by asking Playwright
 * to extract a distilled DOM snapshot inside the browser page context.
 */

import type { DOMDistillationMode, DistilledDOM } from '../types';
import type { ActionExecutor } from './ActionExecutor';
import type { DOMDistiller } from './DOMDistiller';
import { distillFromPlaywright, type PlaywrightPageLike } from './PlaywrightDOMBridge';

export class PlaywrightDistiller implements Pick<DOMDistiller, 'distill' | 'getElement'> {
  private page: PlaywrightPageLike;
  private executor: ActionExecutor | undefined;

  constructor(page: PlaywrightPageLike, executor?: ActionExecutor) {
    this.page = page;
    this.executor = executor;
  }

  setExecutor(executor: ActionExecutor) {
    this.executor = executor;
  }

  async distill(mode: DOMDistillationMode): Promise<DistilledDOM> {
    const { dom, indexToSelector } = await distillFromPlaywright(this.page, mode);
    if (this.executor) this.executor.setIndexToSelectorMap(indexToSelector);
    return dom;
  }

  // Not available in Node mode
  getElement(_index: number): Element | null {
    return null;
  }
}
