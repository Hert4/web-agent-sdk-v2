/**
 * @fileoverview WebAgent - Main entry point and facade for the SDK
 */

import { EventEmitter } from 'eventemitter3';
import type {
  WebAgentConfig, TaskResult, TaskPlan, SubTask, SubTaskResult,
  ActionResult, WebAgentEvents, DOMDistillationMode, DistilledDOM,
  ActionType, ActionParams, TaskError,
} from '../types';
import { DOMDistillationMode as Mode } from '../types';
import { PlannerAgent, type PageState } from '../agents/PlannerAgent';
import { BrowserNavigationAgent } from '../agents/BrowserNavigationAgent';
import { DOMDistiller } from '../services/DOMDistiller';
import { ActionExecutor } from '../services/ActionExecutor';
import { ChangeObserver } from '../services/ChangeObserver';
import { PlaywrightDistiller } from '../services/PlaywrightDistiller';
import { SkillRegistry, createDefaultRegistry, type PrimitiveSkillsConfig } from '../services/SkillRegistry';
import { ErrorHandler, createErrorHandler } from '../services/ErrorHandler';
import { StateManager, createStateManager } from '../services/StateManager';
import { TokenTracker, createTokenTracker } from '../services/TokenTracker';
import { createLLMProvider, type LLMProvider } from '../infrastructure/LLMProvider';
import { DOMBrowserAdapter, type BrowserAdapter } from '../infrastructure/BrowserAdapter';

const DEFAULT_CONFIG = {
  maxStepsPerSubtask: 10,
  maxSubtasksPerTask: 20,
  maxTotalSteps: 100,
  actionTimeout: 5000,
  debug: false,
  screenshots: false,
  retry: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
} as const;

type ConfigWithDefaults = WebAgentConfig & typeof DEFAULT_CONFIG;

export class WebAgent extends EventEmitter<WebAgentEvents> {
  private readonly config: ConfigWithDefaults;
  private llm: LLMProvider;
  private browser: BrowserAdapter;
  private distiller: Pick<DOMDistiller, 'distill' | 'getElement'>;
  private executor: ActionExecutor;
  private observer: ChangeObserver;
  private planner: PlannerAgent;
  private browserNav: BrowserNavigationAgent;
  private skills: SkillRegistry;
  private errorHandler: ErrorHandler;
  private stateManager: StateManager;
  private tokenTracker: TokenTracker;
  private isRunning = false;
  private shouldStop = false;
  private currentTaskId: string | null = null;

  constructor(config: WebAgentConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config, retry: { ...DEFAULT_CONFIG.retry, ...config.retry } } as ConfigWithDefaults;
    this.llm = createLLMProvider(config.llm);
    // Default adapter:
    // - Browser env: DOMBrowserAdapter
    // - Node.js env: user must provide a Playwright/Puppeteer adapter via setBrowserAdapter
    this.browser = typeof document === 'undefined' ? (null as unknown as BrowserAdapter) : new DOMBrowserAdapter();
    // Important: DOMDistiller requires a real browser `document`.
    // In Node.js we initialize later when a PlaywrightAdapter is provided.
    this.distiller = typeof document === 'undefined'
      ? (null as unknown as Pick<DOMDistiller, 'distill' | 'getElement'>)
      : new DOMDistiller();
    this.executor = new ActionExecutor(this.browser, this.distiller as unknown as DOMDistiller);
    this.observer = typeof document === 'undefined'
      ? ({ startObserving() {}, stopObserving() { return { mutations: [], verbalFeedback: '' }; } } as unknown as ChangeObserver)
      : new ChangeObserver();
    this.errorHandler = createErrorHandler({ maxRetries: this.config.retry.maxRetries });
    // In Node.js there's no window/document; StateManager is only usable when
    // a real DOM is available (browser) or doc/win are injected.
    this.stateManager = typeof document === 'undefined'
      ? ({ saveCheckpoint() { return { id: '', label: '', timestamp: Date.now(), url: '', scrollPosition: { x: 0, y: 0 }, formData: new Map() }; } } as unknown as StateManager)
      : createStateManager();
    this.tokenTracker = createTokenTracker();
    this.skills = createDefaultRegistry({ distiller: this.distiller as unknown as DOMDistiller, executor: this.executor, browser: this.browser } as PrimitiveSkillsConfig);
    this.planner = new PlannerAgent(this.llm, {
      maxSubtasks: this.config.maxSubtasksPerTask,
      ...(config.prompts?.planner ? { customSystemPrompt: config.prompts.planner } : {}),
    });
    this.browserNav = new BrowserNavigationAgent(this.llm, this.distiller as unknown as DOMDistiller, this.executor, this.observer, {
      maxStepsPerSubtask: this.config.maxStepsPerSubtask,
      screenshotOnAction: this.config.screenshots,
      ...(config.prompts?.browserNav ? { customSystemPrompt: config.prompts.browserNav } : {}),
    });
    this.debug('WebAgent initialized');
  }

  async execute(task: string): Promise<TaskResult> {
    if (this.isRunning) throw new Error('Agent is already running');
    this.isRunning = true;
    this.shouldStop = false;
    const taskId = this.generateTaskId();
    this.currentTaskId = taskId;
    const startTime = Date.now();
    let totalTokens = 0, totalSteps = 0;
    let plan: TaskPlan | null = null;
    const subtaskResults: SubTaskResult[] = [];

    try {
      this.emit('task:start', { taskId, task });
      this.debug(`[${taskId}] Starting: ${task}`);
      this.stateManager.saveCheckpoint('task_start');
      // Refresh cached title for Playwright adapter before reading page state
      if ('refreshTitle' in this.browser && typeof (this.browser as any).refreshTitle === 'function') {
        await (this.browser as any).refreshTitle();
      }
      const pageState = this.getPageState();

      // Planning phase
      this.debug(`[${taskId}] Planning...`);
      plan = await this.planner.planTask(task, pageState);
      const plannerTokens = this.planner.getTokensUsed(); // ?
      this.tokenTracker.track('planner', this.config.llm.model, plannerTokens, 0);
      totalTokens += plannerTokens;
      this.emit('task:plan', { taskId, plan });
      this.debug(`[${taskId}] Created ${plan.subtasks.length} subtasks`);

      // Execution phase with improved failure handling
      let consecutiveSubtaskFailures = 0;
      const MAX_CONSECUTIVE_SUBTASK_FAILURES = 2; // Stop after 2 consecutive subtask failures
      
      for (let i = 0; i < plan.subtasks.length; i++) {
        const subtask = plan.subtasks[i]!;
        if (this.shouldStop) { this.debug(`[${taskId}] Stopped by user`); break; }
        if (totalSteps >= this.config.maxTotalSteps) { this.debug(`[${taskId}] Max steps exceeded`); break; }

        this.emit('subtask:start', { taskId, subtask });
        this.debug(`[${taskId}] Subtask ${i+1}/${plan.subtasks.length}: ${subtask.description}`);
        
        const result = await this.executeSubtaskWithRetry(subtask);
        subtaskResults.push(result);
        totalSteps += result.steps.length;
        totalTokens += result.tokensUsed;
        this.tokenTracker.track('browserNav', this.config.llm.model, result.tokensUsed, 0);

        if (result.success) {
          this.emit('subtask:complete', { taskId, result });
          this.stateManager.saveCheckpoint(`subtask_${i+1}`);
          consecutiveSubtaskFailures = 0; // Reset on success
        } else {
          consecutiveSubtaskFailures++;
          this.debug(`[${taskId}] Subtask ${i+1} failed (${consecutiveSubtaskFailures} consecutive): ${result.error?.message ?? 'unknown'}`);
          
          if (result.error) {
            this.emit('subtask:error', { taskId, subtask, error: result.error });
          }
          
          // Check if this is a critical failure that should stop execution
          const isCriticalFailure = this.isCriticalSubtaskFailure(subtask, result, i, plan.subtasks.length);
          
          if (isCriticalFailure) {
            this.debug(`[${taskId}] Critical subtask failure detected, aborting task`);
            break;
          }
          
          // If too many consecutive failures, abort
          if (consecutiveSubtaskFailures >= MAX_CONSECUTIVE_SUBTASK_FAILURES) {
            this.debug(`[${taskId}] ${consecutiveSubtaskFailures} consecutive subtask failures, aborting task`);
            break;
          }
          
          // Attempt recovery
          const recovery = await this.attemptRecovery(subtask, result, pageState);
          
          // If recovery suggests abort, stop immediately
          if (!recovery.shouldContinue) {
            this.debug(`[${taskId}] Recovery strategy: abort`);
            break;
          }
          
          // If recovery suggests retry, re-execute the same subtask
          if (recovery.strategy === 'retry' && recovery.retrySubtask) {
            this.debug(`[${taskId}] Retrying subtask ${i+1} with modifications`);
            const retryResult = await this.executeSubtaskWithRetry(recovery.retrySubtask);
            subtaskResults.push(retryResult);
            totalSteps += retryResult.steps.length;
            totalTokens += retryResult.tokensUsed;
            
            if (!retryResult.success) {
              this.debug(`[${taskId}] Retry also failed, aborting`);
              break;
            } else {
              consecutiveSubtaskFailures = 0;
            }
          }
          
          // If recovery suggests skip, continue to next subtask but log warning
          if (recovery.strategy === 'skip') {
            this.debug(`[${taskId}] Skipping failed subtask ${i+1} as per recovery strategy`);
            // Don't reset consecutiveSubtaskFailures for skipped subtasks
          }
        }
      }

      const success = subtaskResults.length > 0 && subtaskResults.every(r => r.success);
      // Surface the first subtask error at the task level for easier debugging
      const firstFailedSubtask = subtaskResults.find(r => !r.success && r.error);
      const taskError: TaskError | undefined = !success && firstFailedSubtask?.error
        ? { code: firstFailedSubtask.error.code, message: firstFailedSubtask.error.message, recoveryAttempts: 0 }
        : undefined;
      const taskResult: TaskResult = {
        taskId, success, plan: plan!, subtaskResults,
        summary: this.generateSummary(task, success, subtaskResults),
        totalSteps, totalTokens, totalDuration: Date.now() - startTime,
        ...(taskError ? { error: taskError } : {}),
      };
      this.emit('task:complete', { taskId, result: taskResult });
      return taskResult;

    } catch (error) {
      const taskError: TaskError = { code: 'EXECUTION_ERROR', message: error instanceof Error ? error.message : 'Unknown', recoveryAttempts: 0 };
      this.emit('task:error', { taskId, error: taskError });
      return {
        taskId, success: false,
        plan: plan || { taskId, originalTask: task, subtasks: [], estimatedTotalSteps: 0, createdAt: startTime },
        subtaskResults, summary: `Failed: ${taskError.message}`,
        totalSteps, totalTokens, totalDuration: Date.now() - startTime, error: taskError,
      };
    } finally {
      this.isRunning = false;
      this.currentTaskId = null;
      this.errorHandler.resetAll();
    }
  }

  private async executeSubtaskWithRetry(subtask: SubTask): Promise<SubTaskResult> {
    let lastResult: SubTaskResult | null = null;
    for (let attempt = 0; attempt <= this.config.retry.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.config.retry.backoffMs * Math.pow(this.config.retry.backoffMultiplier, attempt - 1);
        await new Promise(r => setTimeout(r, delay));
      }
      lastResult = await this.browserNav.executeSubTask(subtask);
      if (lastResult.success) return lastResult;
      if (lastResult.error) {
        const classified = this.errorHandler.classify(new Error(lastResult.error.message), subtask.id);
        if (!classified.retryable) break;
        this.errorHandler.recordRetry(subtask.id);
      }
    }
    return lastResult!;
  }

  /**
   * Determine if a subtask failure is critical and should stop execution
   */
  private isCriticalSubtaskFailure(
    subtask: SubTask,
    result: SubTaskResult,
    subtaskIndex: number,
    totalSubtasks: number
  ): boolean {
    // First subtask failure is usually critical - can't proceed without foundation
    if (subtaskIndex === 0) {
      this.debug(`First subtask failed - this is critical`);
      return true;
    }
    
    // High priority subtasks are critical
    if (subtask.priority === 'high') {
      this.debug(`High priority subtask failed - this is critical`);
      return true;
    }
    
    // Check error codes that indicate fundamental issues
    const criticalErrorCodes = [
      'NO_PROGRESS',
      'MODEL_REPORTED_FAILURE',
      'CONSECUTIVE_FAILURES',
    ];
    
    if (result.error && criticalErrorCodes.includes(result.error.code)) {
      this.debug(`Critical error code: ${result.error.code}`);
      return true;
    }
    
    // If we're past 50% and failing, likely critical
    if (subtaskIndex < totalSubtasks / 2 && !result.success) {
      // Early subtasks are usually dependencies for later ones
      return true;
    }
    
    return false;
  }

  /**
   * Attempt to recover from a failed subtask
   */
  private async attemptRecovery(
    subtask: SubTask,
    result: SubTaskResult,
    pageState: PageState
  ): Promise<{ shouldContinue: boolean; strategy: string; retrySubtask: SubTask | undefined }> {
    try {
      const errorMsg = result.error?.message ?? 'Unknown subtask failure';
      const recovery = await this.planner.handleFailure(subtask, new Error(errorMsg), pageState);
      this.emit('error:recovery', { taskId: this.currentTaskId!, error: result.error, strategy: recovery.strategy });
      
      // Build retry subtask if recovery suggests modifications
      let retrySubtask: SubTask | undefined = undefined;
      if (recovery.strategy === 'retry' && recovery.retryModifications) {
        retrySubtask = { ...subtask, ...recovery.retryModifications };
      }
      
      return {
        shouldContinue: recovery.strategy !== 'abort',
        strategy: recovery.strategy,
        retrySubtask,
      };
    } catch {
      return { shouldContinue: false, strategy: 'abort', retrySubtask: undefined };
    }
  }

  async act<T extends ActionType>(action: T, params: ActionParams[T]): Promise<ActionResult> {
    const taskId = this.currentTaskId || 'direct';
    this.emit('action:start', { taskId, action, params });
    this.observer.startObserving();
    try {
      const result = await this.executor.execute(action, params);
      const changes = this.observer.stopObserving();
      const enriched = { ...result, mutations: changes.mutations, verbalFeedback: changes.verbalFeedback || result.verbalFeedback };
      this.emit('action:complete', { taskId, result: enriched });
      return enriched;
    } catch (error) {
      this.observer.stopObserving();
      throw error;
    }
  }

  async getContext(mode: DOMDistillationMode = Mode.ALL_FIELDS): Promise<DistilledDOM> {
    return this.distiller.distill(mode);
  }

  async chat(message: string): Promise<string> {
    const pageState = this.getPageState();
    const ctx = await this.distiller.distill(Mode.TEXT_ONLY);
    const pageContent = ctx.mode === Mode.TEXT_ONLY
      ? ctx.content.slice(0, 10).map(c => c.content).join('\n')
      : '';
    const resp = await this.llm.complete({
      messages: [
        { role: 'system', content: 'Answer based on the web page context.' },
        { role: 'user', content: `URL: ${pageState.url}\nTitle: ${pageState.title}\n\n${pageContent}\n\nQuestion: ${message}` },
      ],
    });
    return resp.content;
  }

  stop(): void { this.shouldStop = true; }
  isActive(): boolean { return this.isRunning; }
  getCurrentTaskId(): string | null { return this.currentTaskId; }
  getSkillRegistry(): SkillRegistry { return this.skills; }
  getStateManager(): StateManager { return this.stateManager; }
  getTokenMetrics() { return this.tokenTracker.getMetrics(); }
  
  setBrowserAdapter(adapter: BrowserAdapter): void {
    this.browser = adapter;

    // If we're in Node and user sets PlaywrightAdapter, switch to PlaywrightDistiller.
    if (typeof document === 'undefined') {
      // PlaywrightAdapter holds a `page` internally; it's not part of BrowserAdapter interface.
      // We duck-type it.
      const anyAdapter = adapter as unknown as { page?: unknown };
      const page = (anyAdapter as any).page;
      if (!page) {
        throw new Error('In Node.js you must pass a PlaywrightAdapter(page) to setBrowserAdapter()');
      }
      const pwDistiller = new PlaywrightDistiller(page);
      // Important: use the *current* ActionExecutor so distiller can update the
      // index->selector map used by Node adapters.
      pwDistiller.setExecutor(this.executor);
      this.distiller = pwDistiller as unknown as Pick<DOMDistiller, 'distill' | 'getElement'>;
    }

    this.executor = new ActionExecutor(adapter, this.distiller as unknown as DOMDistiller);
    // Re-bind executor on PlaywrightDistiller so index->selector mapping
    // updates the new executor (previously it was attached to the old executor).
    if (typeof document === 'undefined' && this.distiller && 'setExecutor' in (this.distiller as any)) {
      try { (this.distiller as any).setExecutor(this.executor); } catch { /* ignore */ }
    }
    this.skills = createDefaultRegistry({ distiller: this.distiller as unknown as DOMDistiller, executor: this.executor, browser: this.browser } as PrimitiveSkillsConfig);
    this.browserNav = new BrowserNavigationAgent(this.llm, this.distiller as unknown as DOMDistiller, this.executor, this.observer, {
      maxStepsPerSubtask: this.config.maxStepsPerSubtask,
      screenshotOnAction: this.config.screenshots,
      ...(this.config.prompts?.browserNav ? { customSystemPrompt: this.config.prompts.browserNav } : {}),
    });
  }

  private getPageState(): PageState { return { url: this.browser.getUrl(), title: this.browser.getTitle() }; }
  private generateSummary(task: string, success: boolean, results: SubTaskResult[]): string {
    const done = results.filter(r => r.success).length;
    const steps = results.reduce((s, r) => s + r.steps.length, 0);
    if (success) return `Completed "${task}" in ${steps} steps`;
    if (done > 0) return `Partial: ${done}/${results.length} subtasks done`;
    return `Failed: "${task}"`;
  }
  private generateTaskId(): string { return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
  private debug(msg: string): void { if (this.config.debug) console.log(`[WebAgent] ${msg}`); }
}
