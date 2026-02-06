/**
 * @fileoverview BrowserNavigationAgent - Low-level browser automation execution
 * 
 * Responsible for:
 * 1. Executing single subtasks from PlannerAgent
 * 2. Choosing appropriate DOM distillation mode
 * 3. Observing DOM changes after actions
 * 4. Reporting detailed results back
 */

import type {
  SubTask,
  SubTaskResult,
  ActionResult,
  ActionType,
  DOMDistillationMode,
  DistilledDOM,
  LLMMessage,
  SubTaskErrorCode,
} from '../types';
import { DOMDistillationMode as Mode } from '../types';
import type { LLMProvider } from '../infrastructure/LLMProvider';
import type { DOMDistiller } from '../services/DOMDistiller';
import type { ActionExecutor } from '../services/ActionExecutor';
import type { ChangeObserver } from '../services/ChangeObserver';

// ============================================================================
// TYPES
// ============================================================================

export interface BrowserNavConfig {
  maxStepsPerSubtask?: number;
  customSystemPrompt?: string;
  screenshotOnAction?: boolean;
}

interface ActionDecision {
  action: ActionType;
  params: Record<string, unknown>;
  reasoning?: string;
}

// ============================================================================
// PROMPTS
// ============================================================================

const BROWSER_NAV_SYSTEM_PROMPT = `You are a browser automation agent. Execute subtasks by choosing actions on the page.

## Available Actions:
- click: { index: number } - Click element by index
- type: { index: number, text: string } - Type into input
- select: { index: number, value: string } - Select option
- scroll: { direction: "up"|"down", amount?: number }
- wait: { duration: number } - Wait milliseconds
- navigate: { url: string } - Go to URL

## Response Format (JSON only):
{
  "action": "click",
  "params": { "index": 5 },
  "reasoning": "Clicking the search button to submit"
}

Choose the best action based on the subtask and current page state.`;

// ============================================================================
// BROWSER NAVIGATION AGENT
// ============================================================================

export class BrowserNavigationAgent {
  private llm: LLMProvider;
  private distiller: DOMDistiller;
  private executor: ActionExecutor;
  private observer: ChangeObserver;
  private config: Required<BrowserNavConfig>;
  private totalTokens = 0;
  
  constructor(
    llmProvider: LLMProvider,
    distiller: DOMDistiller,
    executor: ActionExecutor,
    observer: ChangeObserver,
    config: BrowserNavConfig = {}
  ) {
    this.llm = llmProvider;
    this.distiller = distiller;
    this.executor = executor;
    this.observer = observer;
    this.config = {
      maxStepsPerSubtask: config.maxStepsPerSubtask ?? 10,
      customSystemPrompt: config.customSystemPrompt ?? BROWSER_NAV_SYSTEM_PROMPT,
      screenshotOnAction: config.screenshotOnAction ?? false,
    };
  }
  
  /**
   * Execute a single subtask
   */
  async executeSubTask(subtask: SubTask): Promise<SubTaskResult> {
    const startTime = Date.now();
    const steps: ActionResult[] = [];
    let retryCount = 0;
    
    try {
      // Choose distillation mode based on subtask
      const mode = this.chooseDOMMode(subtask);
      
      for (let step = 0; step < this.config.maxStepsPerSubtask; step++) {
        // Get current page state
        const dom = await this.distiller.distill(mode);
        
        // Decide next action
        const decision = await this.decideAction(subtask, dom, steps);
        
        // Check for completion signal
        if (decision.action === 'done' as ActionType) {
          return this.createResult(subtask.id, true, steps, startTime, retryCount);
        }
        
        // Start observing changes
        this.observer.startObserving();
        
        // Execute action
        const result = await this.executor.execute(
          decision.action,
          decision.params as never
        );
        
        // Stop observing and get changes
        const changes = this.observer.stopObserving();
        
        // Enrich result with observations
        const enrichedResult: ActionResult = {
          ...result,
          mutations: changes.mutations,
          verbalFeedback: changes.verbalFeedback || result.verbalFeedback,
        };
        
        steps.push(enrichedResult);
        
        // Check if action succeeded
        if (!result.success) {
          retryCount++;
          if (retryCount >= 3) {
            return this.createResult(subtask.id, false, steps, startTime, retryCount, {
              code: 'ACTION_FAILED' as SubTaskErrorCode,
              message: result.error?.message || 'Action failed',
              step,
              lastAction: enrichedResult,
            });
          }
        }
        
        // Check if subtask is complete
        const isComplete = await this.checkCompletion(subtask, dom, steps);
        if (isComplete) {
          return this.createResult(subtask.id, true, steps, startTime, retryCount);
        }
      }
      
      // Max steps exceeded
      return this.createResult(subtask.id, false, steps, startTime, retryCount, {
        code: 'MAX_STEPS_EXCEEDED' as SubTaskErrorCode,
        message: `Exceeded max steps (${this.config.maxStepsPerSubtask})`,
        step: steps.length,
      });
      
    } catch (error) {
      return this.createResult(subtask.id, false, steps, startTime, retryCount, {
        code: 'ACTION_FAILED' as SubTaskErrorCode,
        message: error instanceof Error ? error.message : 'Unknown error',
        step: steps.length,
      });
    }
  }
  
  /**
   * Choose the best DOM distillation mode for a subtask
   */
  chooseDOMMode(subtask: SubTask): DOMDistillationMode {
    const action = subtask.action.toLowerCase();
    
    // Form-related actions → INPUT_FIELDS mode
    if (['type', 'fill', 'input', 'select', 'check', 'login', 'signup', 'search'].some(a => action.includes(a))) {
      return Mode.INPUT_FIELDS;
    }
    
    // Reading/extraction → TEXT_ONLY mode
    if (['read', 'extract', 'get', 'find', 'verify', 'check'].some(a => action.includes(a))) {
      return Mode.TEXT_ONLY;
    }
    
    // Navigation/clicking → ALL_FIELDS mode
    return Mode.ALL_FIELDS;
  }
  
  /**
   * Decide the next action based on subtask and current DOM
   */
  private async decideAction(
    subtask: SubTask,
    dom: DistilledDOM,
    previousSteps: ActionResult[]
  ): Promise<ActionDecision> {
    const messages: LLMMessage[] = [
      { role: 'system', content: this.config.customSystemPrompt },
      {
        role: 'user',
        content: this.buildActionPrompt(subtask, dom, previousSteps),
      },
    ];
    
    const response = await this.llm.complete({ messages, responseFormat: 'json' });
    this.totalTokens += response.usage.totalTokens;
    
    try {
      return JSON.parse(response.content) as ActionDecision;
    } catch {
      // Default to waiting if parse fails
      return { action: 'wait', params: { duration: 1000 } };
    }
  }
  
  /**
   * Build prompt for action decision
   */
  private buildActionPrompt(
    subtask: SubTask,
    dom: DistilledDOM,
    previousSteps: ActionResult[]
  ): string {
    const elements = 'elements' in dom ? dom.elements : ('content' in dom ? dom.content : []);
    
    let prompt = `## Subtask
${subtask.description}
Target: ${subtask.target || 'Not specified'}
Value: ${subtask.value || 'Not specified'}

## Current Page
URL: ${dom.url}
Title: ${dom.title}

## Available Elements (${elements.length} total)
`;

    // Add elements (limited to prevent context overflow)
    const maxElements = 50;
    elements.slice(0, maxElements).forEach((el) => {
      if ('text' in el || 'content' in el) {
        const text = 'text' in el ? el.text : 'content' in el ? el.content : '';
        prompt += `[${el.index}] ${el.tag}: ${text?.slice(0, 80)}\n`;
      }
    });
    
    if (elements.length > maxElements) {
      prompt += `... and ${elements.length - maxElements} more elements\n`;
    }
    
    // Add previous steps
    if (previousSteps.length > 0) {
      prompt += `\n## Previous Actions (${previousSteps.length})\n`;
      previousSteps.slice(-3).forEach(step => {
        prompt += `- ${step.action}: ${step.success ? 'Success' : 'Failed'} - ${step.verbalFeedback}\n`;
      });
    }
    
    prompt += `\nChoose the next action. If subtask is complete, return { "action": "done" }`;
    
    return prompt;
  }
  
  /**
   * Check if subtask appears to be complete
   */
  private async checkCompletion(
    subtask: SubTask,
    dom: DistilledDOM,
    steps: ActionResult[]
  ): Promise<boolean> {
    // Simple heuristics first
    const lastStep = steps[steps.length - 1];
    if (!lastStep) return false;
    
    // Check verbal feedback for completion indicators
    const feedback = lastStep.verbalFeedback.toLowerCase();
    const completionPhrases = ['success', 'added', 'submitted', 'logged in', 'complete', 'done'];
    
    if (completionPhrases.some(p => feedback.includes(p))) {
      return true;
    }
    
    // Check verification criteria if specified
    if (subtask.verification) {
      const verification = subtask.verification.toLowerCase();
      if (verification.includes('url') && dom.url.includes(subtask.value || '')) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Create subtask result
   */
  private createResult(
    subtaskId: string,
    success: boolean,
    steps: ActionResult[],
    startTime: number,
    retryCount: number,
    error?: SubTaskResult['error']
  ): SubTaskResult {
    return {
      subtaskId,
      success,
      steps,
      ...(error !== undefined && { error }),
      startTime,
      endTime: Date.now(),
      tokensUsed: this.totalTokens,
      retryCount,
    };
  }
  
  getTokensUsed(): number {
    return this.totalTokens;
  }
}
