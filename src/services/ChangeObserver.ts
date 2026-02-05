/**
 * @fileoverview ChangeObserver - Tracks DOM mutations and generates verbal feedback
 */

import type { DOMChange } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface ChangeReport {
  mutations: DOMChange[];
  verbalFeedback: string;
  urlChanged: boolean;
  newUrl?: string;
  titleChanged: boolean;
  newTitle?: string;
}

interface ObserverState {
  url: string;
  title: string;
  mutations: MutationRecord[];
}

// ============================================================================
// CHANGE OBSERVER
// ============================================================================

export class ChangeObserver {
  private observer: MutationObserver | null = null;
  private state: ObserverState | null = null;
  private document: Document;
  
  constructor(doc?: Document) {
    this.document = doc || document;
  }
  
  /**
   * Start observing DOM changes
   */
  startObserving(): void {
    // Store initial state
    this.state = {
      url: this.document.location?.href || '',
      title: this.document.title || '',
      mutations: [],
    };
    
    // Create mutation observer
    this.observer = new MutationObserver((mutations) => {
      if (this.state) {
        this.state.mutations.push(...mutations);
      }
    });
    
    // Start observing
    this.observer.observe(this.document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      characterDataOldValue: true,
    });
  }
  
  /**
   * Stop observing and return change report
   */
  stopObserving(): ChangeReport {
    // Stop observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    
    if (!this.state) {
      return {
        mutations: [],
        verbalFeedback: 'No changes observed',
        urlChanged: false,
        titleChanged: false,
      };
    }
    
    const currentUrl = this.document.location?.href || '';
    const currentTitle = this.document.title || '';
    
    const urlChanged = currentUrl !== this.state.url;
    const titleChanged = currentTitle !== this.state.title;
    
    // Process mutations into DOMChange objects
    const changes = this.processMutations(this.state.mutations);
    
    // Generate verbal feedback
    const verbalFeedback = this.generateVerbalFeedback(
      changes,
      urlChanged,
      currentUrl,
      titleChanged,
      currentTitle
    );
    
    // Clear state
    this.state = null;
    
    return {
      mutations: changes,
      verbalFeedback,
      urlChanged,
      newUrl: urlChanged ? currentUrl : undefined,
      titleChanged,
      newTitle: titleChanged ? currentTitle : undefined,
    };
  }
  
  /**
   * Process raw mutations into structured changes
   */
  private processMutations(mutations: MutationRecord[]): DOMChange[] {
    const changes: DOMChange[] = [];
    const seen = new Set<string>();
    
    for (const mutation of mutations) {
      const target = this.describeElement(mutation.target);
      
      switch (mutation.type) {
        case 'childList': {
          // Added nodes
          for (const node of Array.from(mutation.addedNodes)) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const desc = this.describeElement(node);
              const key = `added:${desc}`;
              
              if (!seen.has(key)) {
                seen.add(key);
                changes.push({
                  type: 'added',
                  target: desc,
                  description: `New ${this.getElementDescription(node as Element)} appeared`,
                });
              }
            }
          }
          
          // Removed nodes
          for (const node of Array.from(mutation.removedNodes)) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const desc = this.describeElement(node);
              const key = `removed:${desc}`;
              
              if (!seen.has(key)) {
                seen.add(key);
                changes.push({
                  type: 'removed',
                  target: desc,
                  description: `${this.getElementDescription(node as Element)} was removed`,
                });
              }
            }
          }
          break;
        }
        
        case 'attributes': {
          const key = `modified:${target}:${mutation.attributeName}`;
          
          if (!seen.has(key) && mutation.attributeName) {
            seen.add(key);
            
            const element = mutation.target as Element;
            const newValue = element.getAttribute(mutation.attributeName);
            
            // Only report meaningful attribute changes
            if (this.isSignificantAttributeChange(mutation.attributeName, mutation.oldValue, newValue)) {
              changes.push({
                type: 'modified',
                target,
                description: `${mutation.attributeName} changed from "${mutation.oldValue}" to "${newValue}"`,
              });
            }
          }
          break;
        }
        
        case 'characterData': {
          const key = `text:${target}`;
          
          if (!seen.has(key)) {
            seen.add(key);
            changes.push({
              type: 'text',
              target,
              description: 'Text content changed',
            });
          }
          break;
        }
      }
    }
    
    return changes;
  }
  
  /**
   * Generate human-readable feedback from changes
   */
  private generateVerbalFeedback(
    changes: DOMChange[],
    urlChanged: boolean,
    newUrl: string,
    titleChanged: boolean,
    newTitle: string
  ): string {
    const parts: string[] = [];
    
    // URL change is most significant
    if (urlChanged) {
      const urlPath = new URL(newUrl).pathname;
      parts.push(`Page navigated to ${urlPath}`);
    }
    
    // Title change
    if (titleChanged && !urlChanged) {
      parts.push(`Page title changed to "${newTitle}"`);
    }
    
    // Summarize DOM changes
    const addedCount = changes.filter(c => c.type === 'added').length;
    const removedCount = changes.filter(c => c.type === 'removed').length;
    const modifiedCount = changes.filter(c => c.type === 'modified').length;
    
    // Look for significant changes
    const significantChanges = this.findSignificantChanges(changes);
    
    if (significantChanges.length > 0) {
      parts.push(...significantChanges.slice(0, 3));
    } else if (addedCount + removedCount + modifiedCount > 0) {
      const summary: string[] = [];
      if (addedCount > 0) summary.push(`${addedCount} elements added`);
      if (removedCount > 0) summary.push(`${removedCount} elements removed`);
      if (modifiedCount > 0) summary.push(`${modifiedCount} elements modified`);
      parts.push(summary.join(', '));
    }
    
    if (parts.length === 0) {
      return 'No significant changes detected';
    }
    
    return parts.join('. ');
  }
  
  /**
   * Find significant/notable changes
   */
  private findSignificantChanges(changes: DOMChange[]): string[] {
    const significant: string[] = [];
    
    for (const change of changes) {
      const target = change.target.toLowerCase();
      const desc = change.description.toLowerCase();
      
      // Modal/dialog appearing
      if (target.includes('modal') || target.includes('dialog') || target.includes('popup')) {
        if (change.type === 'added') {
          significant.push('A modal/dialog appeared');
        } else if (change.type === 'removed') {
          significant.push('A modal/dialog was closed');
        }
      }
      
      // Error messages
      if (target.includes('error') || desc.includes('error')) {
        significant.push('An error message appeared');
      }
      
      // Success messages
      if (target.includes('success') || desc.includes('success')) {
        significant.push('A success message appeared');
      }
      
      // Loading states
      if (target.includes('loading') || target.includes('spinner')) {
        if (change.type === 'added') {
          significant.push('Page is loading');
        } else if (change.type === 'removed') {
          significant.push('Loading completed');
        }
      }
      
      // Form submission
      if (desc.includes('submitted') || desc.includes('form')) {
        significant.push('Form state changed');
      }
      
      // Cart/checkout
      if (target.includes('cart') || target.includes('checkout')) {
        significant.push('Cart/checkout was updated');
      }
    }
    
    return [...new Set(significant)]; // Remove duplicates
  }
  
  /**
   * Describe an element for feedback
   */
  private describeElement(node: Node): string {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return node.nodeName.toLowerCase();
    }
    
    const element = node as Element;
    let desc = element.tagName.toLowerCase();
    
    if (element.id) {
      desc += `#${element.id}`;
    } else if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(' ').filter(c => c).slice(0, 2);
      if (classes.length > 0) {
        desc += '.' + classes.join('.');
      }
    }
    
    return desc;
  }
  
  /**
   * Get human-readable element description
   */
  private getElementDescription(element: Element): string {
    const tag = element.tagName.toLowerCase();
    
    // Check for common UI patterns
    const role = element.getAttribute('role');
    if (role) {
      return role;
    }
    
    // Check classes for hints
    const className = element.className?.toLowerCase() || '';
    if (className.includes('modal')) return 'modal';
    if (className.includes('dialog')) return 'dialog';
    if (className.includes('popup')) return 'popup';
    if (className.includes('menu')) return 'menu';
    if (className.includes('dropdown')) return 'dropdown';
    if (className.includes('toast')) return 'notification';
    if (className.includes('alert')) return 'alert';
    
    // Check tag
    switch (tag) {
      case 'dialog': return 'dialog';
      case 'nav': return 'navigation';
      case 'form': return 'form';
      case 'button': return 'button';
      case 'input': return 'input field';
      case 'select': return 'dropdown';
      default: return tag;
    }
  }
  
  /**
   * Check if attribute change is significant
   */
  private isSignificantAttributeChange(
    attr: string,
    oldValue: string | null,
    newValue: string | null
  ): boolean {
    // Ignore common non-significant changes
    const ignored = ['style', 'class', 'data-reactid', 'data-reactroot'];
    if (ignored.includes(attr)) return false;
    
    // Significant attributes
    const significant = ['disabled', 'hidden', 'aria-hidden', 'aria-expanded', 'value', 'checked', 'selected'];
    if (significant.includes(attr)) return true;
    
    return false;
  }
}
