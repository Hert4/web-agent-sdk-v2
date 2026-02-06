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

/**
 * Extract JSON from an LLM response that may wrap it in markdown code fences.
 */
function extractJSON(text: string): string {
  const trimmed = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) return fenceMatch[1]!.trim();
  // Try to find a JSON object/array within the text
  const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) return jsonMatch[1]!;
  return trimmed;
}

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

const PLANNER_SYSTEM_PROMPT = `You are a task planning agent for web automation. Break down user tasks into COMPLETE, DETAILED atomic subtasks.

## CRITICAL: Never Skip Steps!
Each subtask must be a single, atomic action. NEVER combine multiple actions.

### Common Workflow Patterns (MUST FOLLOW):

**Search Flow:**
1. Find and click search field
2. Type search query
3. Press Enter OR click search button (REQUIRED!)
4. Wait for results
5. Click on correct result

**Messaging/Chat Flow:**
1. Search/find the recipient
2. Click to open conversation with recipient
3. Verify correct conversation is open
4. Type message in input field
5. Click send button

**Login Flow:**
1. Enter username/email
2. Enter password
3. Click login button
4. Verify login success

**Form Fill Flow:**
1. For each field: locate → clear if needed → type value
2. Select dropdowns
3. Check/uncheck checkboxes
4. Click submit

## SubTask Format:
{
  "id": "1",
  "description": "Clear description of SINGLE action",
  "action": "search|click|type|select|scroll|wait|navigate|verify|press",
  "target": "Specific element to interact with (e.g., 'search input field', 'send button')",
  "value": "Value to input or select (optional)",
  "verification": "How to verify this subtask succeeded",
  "estimatedSteps": 1-3,
  "dependencies": ["list of subtask IDs that must complete first"],
  "priority": "high|medium|low"
}

## Output Format (JSON only):
{
  "subtasks": [
    { "id": "1", "description": "...", "action": "type", "target": "search field", "value": "search query", "verification": "Search field shows the query", "estimatedSteps": 1, "priority": "high" },
    { "id": "2", "description": "Press Enter to execute search", "action": "press", "target": "keyboard", "value": "Enter", "verification": "Search results appear", "estimatedSteps": 1, "dependencies": ["1"], "priority": "high" }
  ]
}

## Rules:
1. ALWAYS include search execution step (press Enter or click search button) after typing in search
2. ALWAYS verify you're in correct context before acting (e.g., correct conversation before messaging)
3. Break down into smallest atomic actions - 1 action per subtask
4. Use dependencies to enforce order
5. First subtask should have priority: "high"
6. Subtasks that verify context should have priority: "high"`;

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

    // Some OpenAI-compatible gateways may reject `response_format`.
    // We rely on the prompt instruction "Return JSON only" instead.
    const response = await this.llm.complete({ messages });
    this.totalTokens += response.usage.totalTokens;

    let subtasks: SubTask[];
    try {
      const parsed = JSON.parse(extractJSON(response.content));
      subtasks = this.validateSubtasks(parsed.subtasks || parsed);
    } catch {
      subtasks = [];
    }

    if (subtasks.length === 0) {
      subtasks = [{
        id: '1',
        description: userTask,
        action: 'navigate',
        verification: 'Page loaded',
        estimatedSteps: 1,
      }];
    }

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

    const response = await this.llm.complete({ messages });
    this.totalTokens += response.usage.totalTokens;

    const fallback: VerificationResult = { completed: result.success, confidence: 0.5, reason: 'Parse failed' };
    try {
      const parsed = JSON.parse(extractJSON(response.content));
      return {
        completed: typeof parsed.completed === 'boolean' ? parsed.completed : fallback.completed,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : fallback.confidence,
        reason: typeof parsed.reason === 'string' ? parsed.reason : fallback.reason,
        suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : undefined,
      };
    } catch {
      return fallback;
    }
  }
  
  async handleFailure(
    subtask: SubTask,
    error: Error,
    pageState: PageState
  ): Promise<RecoveryPlan> {
    const validStrategies = ['retry', 'alternative', 'skip', 'abort'] as const;
    const messages: LLMMessage[] = [
      { role: 'system', content: 'Suggest recovery for failed subtask. Return JSON: { "recoverable": bool, "strategy": "retry"|"alternative"|"skip"|"abort", "reason": "..." }' },
      {
        role: 'user',
        content: `Failed: ${JSON.stringify(subtask)}\nError: ${error.message}\nPage: ${pageState.url}`,
      },
    ];

    const response = await this.llm.complete({ messages });
    this.totalTokens += response.usage.totalTokens;

    const fallback: RecoveryPlan = { recoverable: false, strategy: 'abort', reason: 'Parse failed' };
    try {
      const parsed = JSON.parse(extractJSON(response.content));
      const strategy = validStrategies.includes(parsed.strategy) ? parsed.strategy : 'abort';
      return {
        recoverable: typeof parsed.recoverable === 'boolean' ? parsed.recoverable : strategy !== 'abort',
        strategy,
        alternativeSubtasks: Array.isArray(parsed.alternativeSubtasks) ? parsed.alternativeSubtasks : undefined,
        retryModifications: parsed.retryModifications && typeof parsed.retryModifications === 'object' ? parsed.retryModifications : undefined,
        reason: typeof parsed.reason === 'string' ? parsed.reason : 'Unknown',
      };
    } catch {
      return fallback;
    }
  }
  
  private validateSubtasks(subtasks: unknown): SubTask[] {
    if (!Array.isArray(subtasks)) return [];

    const isObj = (s: unknown): s is Record<string, unknown> =>
      s != null && typeof s === 'object';

    return subtasks
      .slice(0, this.config.maxSubtasks)
      .filter((s): s is Record<string, unknown> =>
        isObj(s) &&
        typeof s['description'] === 'string' && (s['description'] as string).length > 0 &&
        typeof s['action'] === 'string' && (s['action'] as string).length > 0
      )
      .map((s, i) => {
        const id = typeof s['id'] === 'string' || typeof s['id'] === 'number' ? String(s['id']) : String(i + 1);
        const rawDeps = s['dependencies'];
        const deps = Array.isArray(rawDeps)
          ? rawDeps.filter((d): d is string => typeof d === 'string')
          : undefined;
        const rawPriority = s['priority'];
        const priority = typeof rawPriority === 'string' && ['high', 'medium', 'low'].includes(rawPriority)
          ? (rawPriority as 'high' | 'medium' | 'low')
          : undefined;
        const rawSteps = s['estimatedSteps'];
        const estimatedSteps = typeof rawSteps === 'number' && !Number.isNaN(rawSteps) ? rawSteps : 1;

        const subtask: SubTask = {
          id,
          description: s['description'] as string,
          action: s['action'] as string,
          verification: typeof s['verification'] === 'string' ? s['verification'] as string : '',
          estimatedSteps,
          ...(typeof s['target'] === 'string' ? { target: s['target'] as string } : {}),
          ...(typeof s['value'] === 'string' ? { value: s['value'] as string } : {}),
          ...(deps && deps.length > 0 ? { dependencies: deps } : {}),
          ...(priority ? { priority } : {}),
        };
        return subtask;
      });
  }
  
  getTokensUsed(): number {
    return this.totalTokens;
  }
}
