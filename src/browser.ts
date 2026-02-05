/**
 * @fileoverview Browser-specific entry point for Web Agent SDK
 * 
 * This entry point is optimized for browser environments with:
 * - No Node.js dependencies
 * - Smaller bundle size
 * - Direct DOM access
 */

export { WebAgent } from './core/WebAgent';
export { DOMDistiller, createDistiller } from './services/DOMDistiller';
export { ActionExecutor } from './services/ActionExecutor';
export { ChangeObserver } from './services/ChangeObserver';
export { SkillRegistry, createPrimitiveSkills } from './services/SkillRegistry';
export { DOMBrowserAdapter } from './infrastructure/BrowserAdapter';
export * from './types';
