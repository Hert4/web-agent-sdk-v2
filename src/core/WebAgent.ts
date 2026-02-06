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
  private distiller: DOMDistiller;
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
    this.browser = new DOMBrowserAdapter();
    this.distiller = new DOMDistiller();
    this.executor = new ActionExecutor(this.browser, this.distiller);
    this.observer = new ChangeObserver();
    this.errorHandler = createErrorHandler({ maxRetries: this.config.retry.maxRetries });
    this.stateManager = createStateManager();
    this.tokenTracker = createTokenTracker();
    this.skills = createDefaultRegistry({ distiller: this.distiller, executor: this.executor, browser: this.browser } as PrimitiveSkillsConfig);
    this.planner = new PlannerAgent(this.llm, {
      maxSubtasks: this.config.maxSubtasksPerTask,
      ...(config.prompts?.planner ? { customSystemPrompt: config.prompts.planner } : {}),
    });
    this.browserNav = new BrowserNavigationAgent(this.llm, this.distiller, this.executor, this.observer, {
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
      const pageState = this.getPageState();

      // Planning phase
      this.debug(`[${taskId}] Planning...`);
      plan = await this.planner.planTask(task, pageState);
      const plannerTokens = this.planner.getTokensUsed();
      this.tokenTracker.track('planner', this.config.llm.model, plannerTokens, 0);
      totalTokens += plannerTokens;
      this.emit('task:plan', { taskId, plan });
      this.debug(`[${taskId}] Created ${plan.subtasks.length} subtasks`);

      // Execution phase
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
        } else {
          if (result.error) {
            this.emit('subtask:error', { taskId, subtask, error: result.error });
          }
          const shouldContinue = await this.attemptRecovery(subtask, result, pageState);
          if (!shouldContinue) break;
        }
      }

      const success = subtaskResults.length > 0 && subtaskResults.every(r => r.success);
      const taskResult: TaskResult = {
        taskId, success, plan: plan!, subtaskResults,
        summary: this.generateSummary(task, success, subtaskResults),
        totalSteps, totalTokens, totalDuration: Date.now() - startTime,
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

  private async attemptRecovery(subtask: SubTask, result: SubTaskResult, pageState: PageState): Promise<boolean> {
    try {
      const errorMsg = result.error?.message ?? 'Unknown subtask failure';
      const recovery = await this.planner.handleFailure(subtask, new Error(errorMsg), pageState);
      this.emit('error:recovery', { taskId: this.currentTaskId!, error: result.error, strategy: recovery.strategy });
      return recovery.strategy !== 'abort';
    } catch { return false; }
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
    this.executor = new ActionExecutor(adapter, this.distiller);
    this.skills = createDefaultRegistry({ distiller: this.distiller, executor: this.executor, browser: this.browser } as PrimitiveSkillsConfig);
    this.browserNav = new BrowserNavigationAgent(this.llm, this.distiller, this.executor, this.observer, {
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
