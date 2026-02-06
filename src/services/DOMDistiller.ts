/**
 * @fileoverview DOM Distiller - Core component for extracting and compressing DOM information
 * 
 * This is the most critical component for token reduction. It implements multiple
 * distillation modes to extract only the relevant information from the page.
 * 
 * Token reduction targets:
 * - TEXT_ONLY: 95% reduction (50K → 2.5K tokens)
 * - INPUT_FIELDS: 90% reduction (50K → 5K tokens)  
 * - ALL_FIELDS: 80% reduction (50K → 10K tokens)
 * 
 * @example
 * ```typescript
 * const distiller = new DOMDistiller(document);
 * const distilled = await distiller.distill(DOMDistillationMode.INPUT_FIELDS);
 * console.log(distilled.tokenCount); // ~5000 tokens
 * ```
 */

import type {
  DOMDistillationMode,
  DistilledDOM,
  TextOnlyDOM,
  InputFieldsDOM,
  AllFieldsDOM,
  TextElement,
  InputFieldElement,
  InteractiveElement,
  FormInfo,
  LandmarkInfo,
  BoundingBox,
  DistillationMetrics,
} from '../types';

import { DOMDistillationMode as Mode } from '../types';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Tags to always exclude from extraction */
const EXCLUDED_TAGS = new Set([
  'script', 'style', 'noscript', 'svg', 'path', 'defs', 'clippath',
  'lineargradient', 'radialgradient', 'stop', 'mask', 'filter',
  'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix',
  'template', 'slot', 'iframe', 'object', 'embed', 'applet',
  'head', 'meta', 'link', 'base', 'title'
]);

/** Tags that contain meaningful text content */
const TEXT_CONTENT_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'article', 'section', 'main', 'blockquote',
  'li', 'td', 'th', 'caption', 'figcaption',
  'label', 'legend', 'summary', 'dt', 'dd'
]);

/** ARIA roles that indicate interactivity */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'checkbox', 'radio', 'textbox', 'combobox',
  'listbox', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'tab', 'tabpanel', 'switch', 'searchbox', 'spinbutton', 'slider',
  'scrollbar', 'progressbar', 'tree', 'treeitem', 'grid', 'gridcell'
]);

/** Landmark roles for navigation */
const LANDMARK_ROLES = new Set([
  'banner', 'complementary', 'contentinfo', 'form', 'main',
  'navigation', 'region', 'search'
]);

/** Approximate tokens per character (for estimation) */
const TOKENS_PER_CHAR = 0.25;

/** Maximum text length to keep per element */
const MAX_TEXT_LENGTH = 200;

/** Maximum elements to keep per mode */
const MAX_ELEMENTS = {
  [Mode.TEXT_ONLY]: 500,
  [Mode.INPUT_FIELDS]: 200,
  [Mode.ALL_FIELDS]: 300,
  [Mode.SMART]: 300,
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Estimates token count from text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

/**
 * Truncates text to maximum length while keeping it meaningful
 */
function truncateText(text: string, maxLength: number = MAX_TEXT_LENGTH): string {
  if (text.length <= maxLength) return text;
  
  // Try to break at word boundary
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  
  if (lastSpace > maxLength * 0.7) {
    return truncated.slice(0, lastSpace) + '...';
  }
  
  return truncated + '...';
}

/**
 * Normalizes whitespace in text
 */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Generates a CSS selector for an element
 */
function generateSelector(element: Element): string {
  // Try ID first (most specific)
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }
  
  // Try unique class combination
  if (element.classList.length > 0) {
    const classSelector = Array.from(element.classList)
      .map(c => `.${CSS.escape(c)}`)
      .join('');
    
    // Check if unique
    try {
      const matches = document.querySelectorAll(classSelector);
      if (matches.length === 1) {
        return classSelector;
      }
    } catch {
      // Invalid selector, continue
    }
  }
  
  // Try data attributes
  const dataTestId = element.getAttribute('data-testid');
  if (dataTestId) {
    return `[data-testid="${CSS.escape(dataTestId)}"]`;
  }
  
  const dataId = element.getAttribute('data-id');
  if (dataId) {
    return `[data-id="${CSS.escape(dataId)}"]`;
  }
  
  // Build path from root
  const path: string[] = [];
  let current: Element | null = element;
  
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    
    if (current.id) {
      selector = `#${CSS.escape(current.id)}`;
      path.unshift(selector);
      break;
    }
    
    // Add nth-child if needed
    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children);
      const sameTagSiblings = siblings.filter((s: Element) => s.tagName === current!.tagName);
      
      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }
    
    path.unshift(selector);
    current = parent;
  }
  
  return path.join(' > ');
}

/**
 * Generates an XPath for an element
 */
function generateXPath(element: Element): string {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }
  
  const parts: string[] = [];
  let current: Element | null = element;
  
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling: Element | null = current.previousElementSibling;
    
    while (sibling) {
      if (sibling.tagName === current.tagName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }
    
    const tagName = current.tagName.toLowerCase();
    const part = index > 1 ? `${tagName}[${index}]` : tagName;
    parts.unshift(part);
    
    current = current.parentElement;
  }
  
  return '/' + parts.join('/');
}

/**
 * Gets the bounding box of an element
 */
function getBoundingBox(element: Element): BoundingBox | undefined {
  const rect = element.getBoundingClientRect();
  
  if (rect.width === 0 && rect.height === 0) {
    return undefined;
  }
  
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/**
 * Checks if an element is visible
 */
function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  
  const style = window.getComputedStyle(element);
  
  if (style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      element.hasAttribute('hidden')) {
    return false;
  }
  
  const rect = element.getBoundingClientRect();
  
  // Check if element has dimensions
  if (rect.width === 0 && rect.height === 0) {
    return false;
  }
  
  // Check if element is in viewport (with buffer)
  const buffer = 100;
  const inViewport = 
    rect.top < window.innerHeight + buffer &&
    rect.bottom > -buffer &&
    rect.left < window.innerWidth + buffer &&
    rect.right > -buffer;
  
  return inViewport;
}

/**
 * Checks if an element is interactable
 */
function isInteractable(element: Element): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  
  if (!isVisible(element)) {
    return false;
  }
  
  if (element.hasAttribute('disabled') ||
      element.getAttribute('aria-disabled') === 'true') {
    return false;
  }
  
  // Check if covered by another element
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  try {
    const topElement = document.elementFromPoint(centerX, centerY);
    if (topElement && !element.contains(topElement) && topElement !== element) {
      // Element might be covered
      return false;
    }
  } catch {
    // elementFromPoint can throw in some cases
  }
  
  return true;
}

/**
 * Gets accessible name for an element
 */
function getAccessibleName(element: Element): string {
  // aria-label takes precedence
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return ariaLabel;
  }
  
  // aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelElement = document.getElementById(labelledBy);
    if (labelElement) {
      return normalizeWhitespace(labelElement.textContent || '');
    }
  }
  
  // For inputs, check associated label
  if (element instanceof HTMLInputElement || 
      element instanceof HTMLSelectElement || 
      element instanceof HTMLTextAreaElement) {
    // Check for label wrapping the input
    const parentLabel = element.closest('label');
    if (parentLabel) {
      return normalizeWhitespace(parentLabel.textContent || '');
    }
    
    // Check for label with for attribute
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) {
        return normalizeWhitespace(label.textContent || '');
      }
    }
  }
  
  // title attribute
  const title = element.getAttribute('title');
  if (title) {
    return title;
  }
  
  // Text content for buttons/links
  const text = normalizeWhitespace(element.textContent || '');
  return truncateText(text, 100);
}

/**
 * Gets input type for element
 */
function getInputType(element: Element): InputFieldElement['type'] {
  const tag = element.tagName.toLowerCase();
  
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'select';
  if (tag === 'button') return 'button';
  
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
    return 'input';
  }
  
  // Check role
  const role = element.getAttribute('role');
  if (role === 'button') return 'button';
  if (role === 'checkbox') return 'checkbox';
  if (role === 'radio') return 'radio';
  if (role === 'textbox') return 'input';
  if (role === 'combobox' || role === 'listbox') return 'select';
  
  return 'input';
}

/**
 * Extracts form information
 */
function extractForms(document: Document): FormInfo[] {
  const forms: FormInfo[] = [];
  const formElements = document.querySelectorAll('form');
  
  formElements.forEach((form, index) => {
    const fields = form.querySelectorAll('input, select, textarea, button');
    const fieldIndices: number[] = [];
    
    fields.forEach(field => {
      const idx = parseInt(field.getAttribute('data-agent-index') || '-1', 10);
      if (idx >= 0) {
        fieldIndices.push(idx);
      }
    });
    
    const name = form.getAttribute('name');
    const action = form.getAttribute('action');
    const method = form.getAttribute('method');
    forms.push({
      index,
      ...(name ? { name } : {}),
      ...(action ? { action } : {}),
      ...(method ? { method } : {}),
      fieldIndices,
    });
  });
  
  return forms;
}

/**
 * Extracts landmark information
 */
function extractLandmarks(document: Document): LandmarkInfo[] {
  const landmarks: LandmarkInfo[] = [];
  
  // ARIA landmarks
  LANDMARK_ROLES.forEach(role => {
    const elements = document.querySelectorAll(`[role="${role}"]`);
    elements.forEach(element => {
      const idx = parseInt(element.getAttribute('data-agent-index') || '-1', 10);
      const label = element.getAttribute('aria-label');
      landmarks.push({
        role,
        ...(label ? { label } : {}),
        elementIndex: idx,
      });
    });
  });

  // Semantic HTML landmarks
  const semanticMappings: Record<string, string> = {
    'header': 'banner',
    'footer': 'contentinfo',
    'main': 'main',
    'nav': 'navigation',
    'aside': 'complementary',
  };

  Object.entries(semanticMappings).forEach(([tag, role]) => {
    const elements = document.querySelectorAll(tag);
    elements.forEach(element => {
      // Skip if already has role attribute
      if (element.hasAttribute('role')) return;

      const idx = parseInt(element.getAttribute('data-agent-index') || '-1', 10);
      const label = element.getAttribute('aria-label');
      landmarks.push({
        role,
        ...(label ? { label } : {}),
        elementIndex: idx,
      });
    });
  });
  
  return landmarks;
}

// ============================================================================
// DOM DISTILLER CLASS
// ============================================================================

/**
 * DOM Distiller - Extracts and compresses DOM information for LLM consumption
 */
export class DOMDistiller {
  private document: Document;
  private elementIndex: number = 0;
  private elementMap: Map<number, Element> = new Map();
  
  constructor(doc?: Document) {
    // In Node.js there is no global `document`; Playwright/Puppeteer adapters
    // must provide a Document-like object or the distiller must be used only in
    // browser builds.
    if (doc) {
      this.document = doc;
    } else if (typeof document !== 'undefined') {
      this.document = document;
    } else {
      throw new Error(
        'DOMDistiller requires a DOM Document. In Node.js, use a BrowserAdapter that supplies DOM context or run in a browser environment.'
      );
    }
  }
  
  /**
   * Main distillation method
   */
  async distill(mode: DOMDistillationMode): Promise<DistilledDOM> {
    const startTime = performance.now();
    
    // Reset state
    this.elementIndex = 0;
    this.elementMap.clear();
    
    let result: DistilledDOM;
    
    switch (mode) {
      case Mode.TEXT_ONLY:
        result = this.distillTextOnly();
        break;
      case Mode.INPUT_FIELDS:
        result = this.distillInputFields();
        break;
      case Mode.ALL_FIELDS:
        result = this.distillAllFields();
        break;
      case Mode.SMART:
        result = this.distillSmart();
        break;
      default:
        throw new Error(`Unknown distillation mode: ${mode}`);
    }
    
    const processingTime = performance.now() - startTime;
    
    // Log metrics in debug mode
    if (typeof process !== 'undefined' && process.env?.['DEBUG']) {
      console.log(`[DOMDistiller] Mode: ${mode}, Tokens: ${result.tokenCount}, Time: ${processingTime.toFixed(2)}ms`);
    }
    
    return result;
  }
  
  /**
   * Get element by index (for action execution)
   */
  getElement(index: number): Element | null {
    return this.elementMap.get(index) || null;
  }
  
  /**
   * Get metrics for the last distillation
   */
  getMetrics(rawHtml: string, distilled: DistilledDOM): DistillationMetrics {
    const rawTokens = estimateTokens(rawHtml);
    const distilledTokens = distilled.tokenCount;
    
    return {
      rawTokens,
      distilledTokens,
      reductionRatio: rawTokens > 0 ? (1 - distilledTokens / rawTokens) : 0,
      elementsTotal: this.document.querySelectorAll('*').length,
      elementsKept: this.elementMap.size,
      processingTimeMs: 0, // Would need to track this
    };
  }
  
  // ==========================================================================
  // DISTILLATION MODES
  // ==========================================================================
  
  /**
   * TEXT_ONLY mode - Extract only readable content
   * Best for: Reading/understanding page content, summarization
   */
  private distillTextOnly(): TextOnlyDOM {
    const content: TextElement[] = [];
    const seen = new Set<string>();
    
    // Get main content area first
    const mainContent = this.document.querySelector('main, article, [role="main"]');
    const rootElement = mainContent || this.document.body;
    
    // Walk through text content tags
    TEXT_CONTENT_TAGS.forEach(tag => {
      const elements = rootElement.querySelectorAll(tag);
      
      elements.forEach(element => {
        // Skip if inside excluded areas
        if (this.isInsideExcluded(element)) return;
        
        const text = normalizeWhitespace(element.textContent || '');
        
        // Skip empty or duplicate content
        if (!text || text.length < 5 || seen.has(text)) return;
        seen.add(text);
        
        // Assign index
        const index = this.assignIndex(element);
        
        content.push({
          type: 'text',
          content: truncateText(text),
          tag: element.tagName.toLowerCase(),
          index,
        });
        
        // Limit elements
        if (content.length >= MAX_ELEMENTS[Mode.TEXT_ONLY]) return;
      });
    });
    
    // Calculate token count
    const json = JSON.stringify(content);
    const tokenCount = estimateTokens(json);
    
    return {
      mode: Mode.TEXT_ONLY,
      url: this.document.location?.href || '',
      title: this.document.title || '',
      content,
      tokenCount,
      extractedAt: Date.now(),
    };
  }
  
  /**
   * INPUT_FIELDS mode - Extract form elements and inputs
   * Best for: Form filling, data entry
   */
  private distillInputFields(): InputFieldsDOM {
    const elements: InputFieldElement[] = [];
    
    // Query all form-related elements
    const selector = [
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
    ].join(', ');
    
    const formElements = this.document.querySelectorAll(selector);
    
    formElements.forEach(element => {
      // Skip excluded areas
      if (this.isInsideExcluded(element)) return;
      
      // Check visibility
      const visible = isVisible(element);
      const interactable = isInteractable(element);
      
      // Skip if not visible at all
      if (!visible && !element.closest('form')) return;
      
      const index = this.assignIndex(element);
      const bb = getBoundingBox(element);
      const role = element.getAttribute('role');
      const inputType = element instanceof HTMLInputElement ? element.type : null;
      const value = this.getElementValue(element);
      const placeholder = element.getAttribute('placeholder');
      const label = this.getLabel(element);
      const pattern = element.getAttribute('pattern');
      const options = this.getSelectOptions(element);
      const buttonText = this.getButtonText(element);
      const inputElement: InputFieldElement = {
        index,
        tag: element.tagName.toLowerCase(),
        type: getInputType(element),
        selector: generateSelector(element),
        xpath: generateXPath(element),
        visible,
        interactable,
        ...(bb ? { boundingBox: bb } : {}),
        ...(role ? { role } : {}),
        accessibleName: getAccessibleName(element),
        ...(inputType ? { inputType } : {}),
        ...(value ? { value } : {}),
        ...(placeholder ? { placeholder } : {}),
        ...(label ? { label } : {}),
        required: element.hasAttribute('required') ||
                  element.getAttribute('aria-required') === 'true',
        disabled: element.hasAttribute('disabled') ||
                  element.getAttribute('aria-disabled') === 'true',
        ...(pattern ? { pattern } : {}),
        ...(options ? { options } : {}),
        ...(buttonText ? { buttonText } : {}),
      };
      
      elements.push(inputElement);
      
      // Limit elements
      if (elements.length >= MAX_ELEMENTS[Mode.INPUT_FIELDS]) return;
    });
    
    // Sort by position (top to bottom, left to right)
    elements.sort((a, b) => {
      if (!a.boundingBox || !b.boundingBox) return 0;
      if (Math.abs(a.boundingBox.y - b.boundingBox.y) > 20) {
        return a.boundingBox.y - b.boundingBox.y;
      }
      return a.boundingBox.x - b.boundingBox.x;
    });
    
    // Mark indices for forms
    elements.forEach((el, i) => {
      const element = this.elementMap.get(el.index);
      if (element) {
        element.setAttribute('data-agent-index', i.toString());
      }
    });
    
    const forms = extractForms(this.document);
    
    // Calculate token count
    const json = JSON.stringify({ elements, forms });
    const tokenCount = estimateTokens(json);
    
    return {
      mode: Mode.INPUT_FIELDS,
      url: this.document.location?.href || '',
      title: this.document.title || '',
      elements,
      forms,
      tokenCount,
      extractedAt: Date.now(),
    };
  }
  
  /**
   * ALL_FIELDS mode - Extract all interactive elements
   * Best for: Complex navigation, exploration
   */
  private distillAllFields(): AllFieldsDOM {
    const elements: InteractiveElement[] = [];
    
    // Query all potentially interactive elements
    const selector = [
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
    
    const interactiveElements = this.document.querySelectorAll(selector);
    
    interactiveElements.forEach(element => {
      // Skip excluded areas
      if (this.isInsideExcluded(element)) return;
      
      // Skip elements with non-interactive roles
      const role = element.getAttribute('role');
      if (role && !INTERACTIVE_ROLES.has(role) && !LANDMARK_ROLES.has(role)) {
        return;
      }
      
      const visible = isVisible(element);
      const interactable = isInteractable(element);
      
      // Skip invisible non-form elements
      if (!visible && !element.closest('form')) return;
      
      const index = this.assignIndex(element);
      const tag = element.tagName.toLowerCase();
      
      const bb = getBoundingBox(element);
      const href = element.getAttribute('href');
      const attributes = this.getRelevantAttributes(element);
      const context = this.getContext(element);
      const interactiveElement: InteractiveElement = {
        index,
        tag,
        type: this.getInteractiveType(element),
        selector: generateSelector(element),
        xpath: generateXPath(element),
        visible,
        interactable,
        ...(bb ? { boundingBox: bb } : {}),
        ...(role ? { role } : {}),
        accessibleName: getAccessibleName(element),
        text: truncateText(normalizeWhitespace(element.textContent || ''), 100),
        ...(href ? { href } : {}),
        ...(attributes ? { attributes } : {}),
        ...(context ? { context } : {}),
      };
      
      elements.push(interactiveElement);
      
      // Limit elements
      if (elements.length >= MAX_ELEMENTS[Mode.ALL_FIELDS]) return;
    });
    
    // Sort by position
    elements.sort((a, b) => {
      if (!a.boundingBox || !b.boundingBox) return 0;
      if (Math.abs(a.boundingBox.y - b.boundingBox.y) > 20) {
        return a.boundingBox.y - b.boundingBox.y;
      }
      return a.boundingBox.x - b.boundingBox.x;
    });
    
    // Mark indices
    elements.forEach((el, i) => {
      const element = this.elementMap.get(el.index);
      if (element) {
        element.setAttribute('data-agent-index', i.toString());
      }
    });
    
    const landmarks = extractLandmarks(this.document);
    
    // Calculate token count
    const json = JSON.stringify({ elements, landmarks });
    const tokenCount = estimateTokens(json);
    
    return {
      mode: Mode.ALL_FIELDS,
      url: this.document.location?.href || '',
      title: this.document.title || '',
      elements,
      landmarks,
      tokenCount,
      extractedAt: Date.now(),
    };
  }
  
  /**
   * SMART mode - Automatically choose the best mode based on page content
   */
  private distillSmart(): DistilledDOM {
    // Analyze page characteristics
    const inputCount = this.document.querySelectorAll('input, textarea, select').length;
    const linkCount = this.document.querySelectorAll('a[href]').length;
    const textLength = (this.document.body.textContent || '').length;
    
    // If page has many inputs, use INPUT_FIELDS mode
    if (inputCount > 5) {
      return this.distillInputFields();
    }
    
    // If page has many links but few inputs, use ALL_FIELDS mode
    if (linkCount > 20 && inputCount <= 5) {
      return this.distillAllFields();
    }
    
    // If page is text-heavy, use TEXT_ONLY mode
    if (textLength > 10000 && inputCount < 3 && linkCount < 20) {
      return this.distillTextOnly();
    }
    
    // Default to ALL_FIELDS for general navigation
    return this.distillAllFields();
  }
  
  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================
  
  private assignIndex(element: Element): number {
    const index = this.elementIndex++;
    this.elementMap.set(index, element);
    return index;
  }
  
  private isInsideExcluded(element: Element): boolean {
    let current: Element | null = element;
    
    while (current && current !== this.document.body) {
      const tag = current.tagName.toLowerCase();
      
      if (EXCLUDED_TAGS.has(tag)) {
        return true;
      }
      
      // Check for hidden elements
      if (current instanceof HTMLElement) {
        if (current.hidden || 
            current.getAttribute('aria-hidden') === 'true') {
          return true;
        }
      }
      
      current = current.parentElement;
    }
    
    return false;
  }
  
  private getElementValue(element: Element): string | undefined {
    if (element instanceof HTMLInputElement) {
      return element.type === 'password' ? '********' : element.value;
    }
    if (element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    if (element instanceof HTMLSelectElement) {
      return element.value;
    }
    if (element.hasAttribute('contenteditable')) {
      return element.textContent || undefined;
    }
    return undefined;
  }
  
  private getLabel(element: Element): string | undefined {
    // Check for wrapping label
    const parentLabel = element.closest('label');
    if (parentLabel) {
      return truncateText(normalizeWhitespace(parentLabel.textContent || ''), 100);
    }
    
    // Check for associated label
    if (element.id) {
      const label = this.document.querySelector(`label[for="${element.id}"]`);
      if (label) {
        return truncateText(normalizeWhitespace(label.textContent || ''), 100);
      }
    }
    
    // Check aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      return ariaLabel;
    }
    
    return undefined;
  }
  
  private getSelectOptions(element: Element): InputFieldElement['options'] {
    if (!(element instanceof HTMLSelectElement)) {
      return undefined;
    }
    
    return Array.from(element.options).map(option => ({
      value: option.value,
      text: option.text,
      selected: option.selected,
    }));
  }
  
  private getButtonText(element: Element): string | undefined {
    if (element.tagName.toLowerCase() === 'button' ||
        element.getAttribute('role') === 'button' ||
        (element instanceof HTMLInputElement && 
         ['submit', 'button', 'reset'].includes(element.type))) {
      return truncateText(normalizeWhitespace(element.textContent || ''), 50) ||
             element.getAttribute('value') ||
             undefined;
    }
    return undefined;
  }
  
  private getInteractiveType(element: Element): InteractiveElement['type'] {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role');
    
    if (tag === 'a') return 'link';
    if (tag === 'button' || role === 'button') return 'button';
    if (tag === 'input') return 'input';
    if (tag === 'select' || role === 'listbox' || role === 'combobox') return 'select';
    if (role === 'checkbox') return 'checkbox';
    if (role === 'radio') return 'radio';
    if (tag === 'textarea' || role === 'textbox') return 'textarea';
    if (role === 'menu' || role === 'menubar') return 'menu';
    if (role === 'tab') return 'tab';
    if (role === 'dialog' || tag === 'dialog') return 'dialog';
    
    return 'other';
  }
  
  private getRelevantAttributes(element: Element): Record<string, string> | undefined {
    const relevant: Record<string, string> = {};
    const attrs = ['name', 'type', 'value', 'placeholder', 'data-testid', 'data-action'];
    
    attrs.forEach(attr => {
      const value = element.getAttribute(attr);
      if (value) {
        relevant[attr] = value;
      }
    });
    
    return Object.keys(relevant).length > 0 ? relevant : undefined;
  }
  
  private getContext(element: Element): string | undefined {
    // Get parent context for better understanding
    const parent = element.parentElement;
    if (!parent) return undefined;
    
    // Check for landmark or section
    const landmark = element.closest('[role], nav, main, aside, section, article');
    if (landmark && landmark !== element) {
      const role = landmark.getAttribute('role') || landmark.tagName.toLowerCase();
      const label = landmark.getAttribute('aria-label');
      return label ? `${role}: ${label}` : role;
    }
    
    return undefined;
  }
}

/**
 * Factory function to create a DOMDistiller
 */
export function createDistiller(doc?: Document): DOMDistiller {
  return new DOMDistiller(doc);
}
