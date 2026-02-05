/**
 * @fileoverview Web Agent SDK v2.0 - Main Entry Point
 * 
 * A production-grade AI agent SDK for web automation with hierarchical
 * multi-agent architecture and DOM distillation.
 * 
 * @example
 * ```typescript
 * import { WebAgent, DOMDistillationMode } from 'web-agent-sdk';
 * 
 * const agent = new WebAgent({
 *   llm: {
 *     provider: 'openai',
 *     model: 'gpt-4-turbo',
 *     apiKey: process.env.OPENAI_API_KEY
 *   }
 * });
 * 
 * // Execute a task
 * const result = await agent.execute('Search for laptop on Amazon');
 * 
 * // Or use lower-level APIs
 * const context = await agent.getContext(DOMDistillationMode.INPUT_FIELDS);
 * await agent.act('click', { index: 5 });
 * ```
 */

// Core
export { WebAgent } from './core/WebAgent';

// Agents
export { PlannerAgent } from './agents/PlannerAgent';
export type { PageState, VerificationResult, RecoveryPlan, PlannerConfig } from './agents/PlannerAgent';
export { BrowserNavigationAgent } from './agents/BrowserNavigationAgent';
export type { BrowserNavConfig } from './agents/BrowserNavigationAgent';

// Services
export { DOMDistiller, createDistiller } from './services/DOMDistiller';
export { ActionExecutor } from './services/ActionExecutor';
export type { ActionExecutorConfig } from './services/ActionExecutor';
export { ChangeObserver } from './services/ChangeObserver';
export type { ChangeReport } from './services/ChangeObserver';
export { SkillRegistry, createPrimitiveSkills, createDefaultRegistry } from './services/SkillRegistry';
export { ErrorHandler, createErrorHandler, ErrorCategory } from './services/ErrorHandler';
export type { ClassifiedError, RecoveryStrategy } from './services/ErrorHandler';
export { StateManager, createStateManager } from './services/StateManager';
export type { Checkpoint, StateSnapshot } from './services/StateManager';
export { TokenTracker, createTokenTracker } from './services/TokenTracker';
export type { TokenUsageRecord, TokenMetrics } from './services/TokenTracker';

// Infrastructure
export { 
  LLMProvider, 
  OpenAIProvider, 
  AnthropicProvider, 
  createLLMProvider 
} from './infrastructure/LLMProvider';
export { 
  BrowserAdapter, 
  DOMBrowserAdapter, 
  PlaywrightAdapter 
} from './infrastructure/BrowserAdapter';

// Types
export * from './types';

// Re-export enums with values
export { DOMDistillationMode } from './types';
