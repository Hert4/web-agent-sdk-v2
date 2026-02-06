/**
 * @fileoverview PlaywrightDOMBridge - Extracts a distilled DOM snapshot from a Playwright page.
 *
 * This runs the DOM extraction inside the browser context via `page.evaluate`,
 * so Node.js never needs a global `document`.
 */

import type { DistilledDOM, DOMDistillationMode } from '../types';

export type IndexToSelector = Map<number, string>;

// Minimal subset of Playwright's Page we need
export interface PlaywrightPageLike {
  evaluate<R>(expression: string): Promise<R>;
  evaluate<R, Arg>(pageFunction: (arg: Arg) => R | Promise<R>, arg: Arg): Promise<R>;
}

export interface DistillResult {
  dom: DistilledDOM;
  indexToSelector: Array<[number, string]>;
}

export async function distillFromPlaywright(
  page: PlaywrightPageLike,
  mode: DOMDistillationMode
): Promise<{ dom: DistilledDOM; indexToSelector: IndexToSelector }> {
  // Inject __name shim into the browser context. esbuild/tsx wraps arrow-function
  // declarations with __name() calls when compiling, but __name is only defined at
  // the Node.js module scope — it doesn't exist inside Playwright's evaluate sandbox.
  // A string expression is NOT transformed by esbuild, so this is safe.
  await page.evaluate<void>('void(typeof __name==="undefined"&&(window.__name=function(f){return f}))');

  const result = await page.evaluate<DistillResult, { mode: DOMDistillationMode }>(
    ({ mode }) => {
      const estimateTokens = (text: string) => Math.ceil(text.length * 0.25);
      const truncate = (t: string, max = 200) => (t.length <= max ? t : t.slice(0, max) + '...');
      const norm = (t: string) => t.replace(/\s+/g, ' ').trim();

      const MAX = { text_only: 500, input_fields: 200, all_fields: 300, smart: 300 } as const;
      const max = ((): number => {
        const key = String(mode) as keyof typeof MAX;
        return (MAX[key] ?? 300) as number;
      })();

      const isVisible = (el: Element): boolean => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        if (el.hasAttribute('hidden')) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const selectorFor = (el: Element): string => {
        const anyEl = el as HTMLElement;
        if (anyEl.id) return `#${CSS.escape(anyEl.id)}`;
        const testId = anyEl.getAttribute?.('data-testid');
        if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
        const name = anyEl.getAttribute?.('name');
        if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;

        // Fallback: nth-of-type path
        const path: string[] = [];
        let cur: Element | null = el;
        while (cur && cur !== document.body) {
          const tag = cur.tagName.toLowerCase();
          const parentEl: HTMLElement | null = cur.parentElement;
          if (!parentEl) break;
          const siblings = Array.from(parentEl.children).filter((s) => (s as Element).tagName === cur!.tagName) as Element[];
          if (siblings.length === 1) path.unshift(tag);
          else {
            const idx = siblings.indexOf(cur) + 1;
            path.unshift(`${tag}:nth-of-type(${idx})`);
          }
          cur = parentEl;
        }
        return path.join(' > ');
      };

      const url = location.href;
      const title = document.title || '';
      const indexToSelector: Array<[number, string]> = [];

      const pushEl = (idx: number, el: Element, data: any) => {
        indexToSelector.push([idx, selectorFor(el)]);
        return data;
      };

      // Note: For simplicity we always return elements-based dom for ALL_FIELDS/INPUT_FIELDS
      // and content-based for TEXT_ONLY.
      if (String(mode) === 'text_only') {
        const tags = ['p','h1','h2','h3','h4','h5','h6','article','section','main','blockquote','li','td','th','caption','figcaption','label','legend','summary','dt','dd'];
        const content: any[] = [];
        const seen = new Set<string>();
        let idx = 0;
        for (const tag of tags) {
          const nodes = Array.from(document.querySelectorAll(tag));
          for (const el of nodes) {
            const text = norm(el.textContent || '');
            if (!text || text.length < 5 || seen.has(text)) continue;
            seen.add(text);
            const entry = pushEl(idx, el, { type: 'text', content: truncate(text), tag, index: idx });
            content.push(entry);
            idx++;
            if (content.length >= max) break;
          }
          if (content.length >= max) break;
        }
        const tokenCount = estimateTokens(JSON.stringify(content));
        return { dom: { mode, url, title, content, tokenCount, extractedAt: Date.now() } as any, indexToSelector };
      }

      const interactiveSelector = String(mode) === 'input_fields'
        ? [
            'input:not([type="hidden"])',
            'textarea',
            'select',
            'button',
            '[role="button"]',
            '[role="textbox"]',
            '[role="checkbox"]',
            '[role="radio"]',
            '[role="combobox"]',
            '[role="searchbox"]',
            '[contenteditable="true"]',
          ].join(', ')
        : [
            'a[href]',
            'button',
            'input:not([type="hidden"])',
            'select',
            'textarea',
            '[role]',
            '[tabindex]',
            '[onclick]',
            '[contenteditable="true"]',
          ].join(', ');

      const nodes = Array.from(document.querySelectorAll(interactiveSelector));
      const elements: any[] = [];
      let idx = 0;
      for (const el of nodes) {
        const visible = isVisible(el);
        if (!visible && !el.closest('form')) continue;
        const rect = (el as HTMLElement).getBoundingClientRect?.();
        const bb = rect && rect.width > 0 && rect.height > 0
          ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
          : undefined;
        const tag = el.tagName.toLowerCase();
        // Extract additional attributes for better element identification
        const htmlEl = el as HTMLInputElement;
        const placeholder = htmlEl.placeholder || htmlEl.getAttribute('placeholder') || '';
        const inputType = htmlEl.type || htmlEl.getAttribute('type') || '';
        const inputValue = htmlEl.value || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const nameAttr = el.getAttribute('name') || '';
        const role = el.getAttribute('role') || '';
        
        // Build a descriptive accessible name
        const accessibleName = truncate(norm(
          ariaLabel || 
          placeholder || 
          (el as HTMLElement).innerText || 
          nameAttr || 
          ''
        ));
        
        // Build context description for inputs
        let contextHint = '';
        if (tag === 'input' || tag === 'textarea') {
          const hints: string[] = [];
          if (placeholder) hints.push(`placeholder="${placeholder}"`);
          if (inputType && inputType !== 'text') hints.push(`type="${inputType}"`);
          if (inputValue) hints.push(`value="${truncate(inputValue, 50)}"`);
          if (role) hints.push(`role="${role}"`);
          contextHint = hints.join(' ');
        }
        
        const entry = pushEl(idx, el, {
          index: idx,
          tag,
          type: tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : 'input',
          selector: selectorFor(el),
          xpath: '',
          visible,
          interactable: visible,
          ...(bb ? { boundingBox: bb } : {}),
          accessibleName,
          text: truncate(norm(el.textContent || ''), 100),
          // New fields for better identification
          ...(placeholder ? { placeholder } : {}),
          ...(inputType ? { inputType } : {}),
          ...(inputValue ? { currentValue: truncate(inputValue, 50) } : {}),
          ...(contextHint ? { contextHint } : {}),
        });
        elements.push(entry);
        idx++;
        if (elements.length >= max) break;
      }

      const tokenCount = estimateTokens(JSON.stringify({ elements }));
      return { dom: { mode, url, title, elements, tokenCount, extractedAt: Date.now() } as any, indexToSelector };
    },
    { mode }
  );

  return {
    dom: result.dom,
    indexToSelector: new Map(result.indexToSelector),
  };
}
