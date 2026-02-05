/**
 * @fileoverview PlannerAgent - High-level task planning and decomposition
 */

import type {
  SubTask,
  SubTaskResult,
  TaskPlan,
  LLMMessage,
} from '../types';
import type { LLMProvider } from '../infrastructure/LLMProvider';

// ============================================================================
// TYPES
// ============================================================================

export interface PlannerConfig {
  maxSubtasks?: number;
  customSystemPrompt?: string;
}

export interface PageState {
  url: string;
  title: string;
  summary?: string;
}

export interface VerificationResult {
  completed: boolean;
  confidence: number;
  reason: string;
  suggestion?: string;
}

export interface RecoveryPlan {
  recoverable: boolean;
  strategy: 'retry' | 'alternative' | 'skip' | 'abort';
  alternativeSubtasks?: SubTask[];
  retryModifications?: Partial<SubTask>;
  reason: string;
}

// ============================================================================
// PROMPTS
// ============================================================================

const PLANNER_SYSTEM_PROMPT = `You are a task planning agent for web automation. Break down user tasks into atomic subtasks.

## SubTask Format:
- id: Unique identifier (string)
- description: Human-readable description
- action: One of [search, click, type, select, scroll, wait, navigate, verify, extract]
- target: Element to interact with
- value: Value to input (optional)
- verification: How to verify success
- estimatedSteps: Expected browser actions (1-5)

## Output Format (JSON only):
{
  "subtasks": [
    { "id": "1", "description": "...", "action": "...", "target": "...", "verification": "...", "estimatedSteps": 1 }
  ]
}`;

// ============================================================================
// PLANNER AGENT
// ============================================================================

export class PlannerAgent {
  private llm: LLMProvider;
  private config: Required<PlannerConfig>;
  private totalTokens = 0;
  
  constructor(llmProvider: LLMProvider, config: PlannerConfig = {}) {
    this.llm = llmProvider;
    this.config = {
      maxSubtasks: config.maxSubtasks ?? 20,
      customSystemPrompt: config.customSystemPrompt ?? PLANNER_SYSTEM_PROMPT,
    };
  }
  
  async planTask(userTask: string, pageState: PageState): Promise<TaskPlan> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const messages: LLMMessage[] = [
      { role: 'system', content: this.config.customSystemPrompt },
      {
        role: 'user',
        content: `Current page: ${pageState.url} - "${pageState.title}"\n\nTask: "${userTask}"\n\nReturn JSON only.`,
      },
    ];
    
    const response = await this.llm.complete({ messages, responseFormat: 'json' });
    this.totalTokens += response.usage.totalTokens;
    
    const parsed = JSON.parse(response.content);
    const subtasks = this.validateSubtasks(parsed.subtasks || parsed);
    
    return {
      taskId,
      originalTask: userTask,
      subtasks,
      estimatedTotalSteps: subtasks.reduce((sum, s) => sum + (s.estimatedSteps || 1), 0),
      createdAt: Date.now(),
    };
  }
  
  async verifyCompletion(
    subtask: SubTask,
    result: SubTaskResult,
    pageState: PageState
  ): Promise<VerificationResult> {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'Verify if subtask completed. Return JSON: { "completed": bool, "confidence": 0-1, "reason": "..." }' },
      {
        role: 'user',
        content: `Subtask: ${JSON.stringify(subtask)}\nResult: success=${result.success}, steps=${result.steps.length}\nPage: ${pageState.url}`,
      },
    ];
    
    const response = await this.llm.complete({ messages, responseFormat: 'json' });
    this.totalTokens += response.usage.totalTokens;
    
    try {
      return JSON.parse(response.content);
    } catch {
      return { completed: result.success, confidence: 0.5, reason: 'Parse failed' };
    }
  }
  
  async handleFailure(
    subtask: SubTask,
    error: Error,
    pageState: PageState
  ): Promise<RecoveryPlan> {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'Suggest recovery for failed subtask. Return JSON: { "recoverable": bool, "strategy": "retry"|"alternative"|"skip"|"abort", "reason": "..." }' },
      {
        role: 'user',
        content: `Failed: ${JSON.stringify(subtask)}\nError: ${error.message}\nPage: ${pageState.url}`,
      },
    ];
    
    const response = await this.llm.complete({ messages, responseFormat: 'json' });
    this.totalTokens += response.usage.totalTokens;
    
    try {
      return JSON.parse(response.content);
    } catch {
      return { recoverable: false, strategy: 'abort', reason: 'Parse failed' };
    }
  }
  
  private validateSubtasks(subtasks: unknown[]): SubTask[] {
    if (!Array.isArray(subtasks)) return [];
    
    return subtasks.slice(0, this.config.maxSubtasks).map((s, i) => ({
      id: String(s && typeof s === 'object' && 'id' in s ? s.id : i + 1),
      description: String(s && typeof s === 'object' && 'description' in s ? s.description : ''),
      action: String(s && typeof s === 'object' && 'action' in s ? s.action : 'click'),
      target: s && typeof s === 'object' && 'target' in s ? String(s.target) : undefined,
      value: s && typeof s === 'object' && 'value' in s ? String(s.value) : undefined,
      verification: String(s && typeof s === 'object' && 'verification' in s ? s.verification : ''),
      estimatedSteps: s && typeof s === 'object' && 'estimatedSteps' in s ? Number(s.estimatedSteps) : 1,
    }));
  }
  
  getTokensUsed(): number {
    return this.totalTokens;
  }
}
