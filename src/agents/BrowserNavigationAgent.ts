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
  ContentPart,
} from '../types';
import { DOMDistillationMode as Mode } from '../types';
import type { LLMProvider } from '../infrastructure/LLMProvider';
import type { DOMDistiller } from '../services/DOMDistiller';
import type { ActionExecutor } from '../services/ActionExecutor';
import type { ChangeObserver } from '../services/ChangeObserver';

/**
 * Extract JSON from an LLM response that may wrap it in markdown code fences.
 */
function extractJSON(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) return fenceMatch[1]!.trim();
  const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) return jsonMatch[1]!;
  return trimmed;
}

// ============================================================================
// TYPES
// ============================================================================

export interface BrowserNavConfig {
  maxStepsPerSubtask?: number;
  customSystemPrompt?: string;
  screenshotOnAction?: boolean;
}

interface ActionDecision {
  action: ActionType | 'done' | 'fail';
  params: Record<string, unknown>;
  reasoning?: string;
  assumption?: string;
  verificationCriteria?: string;
  failReason?: string;
  // New fields from browser-use learnings
  evaluationPreviousAction?: string; // Self-eval: Success/Failure/Uncertain
  memory?: string; // 1-3 sentences tracking progress
  nextGoal?: string; // Clear statement of immediate goal
}

interface ActionAttempt {
  action: ActionType;
  params: Record<string, unknown>;
  success: boolean;
  feedback: string;
}

// ============================================================================
// PROMPTS
// ============================================================================

const BROWSER_NAV_SYSTEM_PROMPT = `You are a browser automation agent executing subtasks step-by-step.

Browser tasks often require persistence. When a task feels complex, work through it systematically until complete.

## Available Actions:
- click: { index: number } - Click element by index. VERIFY the element exists before clicking.
- type: { index: number, text: string, clearFirst?: boolean } - Type into input field. 
  IMPORTANT: Use clearFirst: true when field may have existing text!
- clear: { index: number } - Clear all text from input field
- select: { index: number, value: string } - Select option from dropdown
- scroll: { direction: "up"|"down", amount?: number } - Scroll the page to reveal more elements
- wait: { duration: number } - Wait milliseconds (max 5000)
- navigate: { url: string } - Go to URL
- press: { key: string } - Press keyboard key (Enter, Escape, Tab, Backspace, etc.)

## Response Format (JSON only):
{
  "evaluationPreviousAction": "Success: [what happened]" OR "Failure: [what went wrong]" OR "Uncertain: [what might have happened]",
  "memory": "1-3 sentences: what's done, current state, what remains",
  "nextGoal": "Clear statement of immediate goal",
  "action": "click",
  "params": { "index": 5 },
  "reasoning": "Why this action achieves the goal"
}

## CRITICAL RULES:

### 1. UNDERSTAND THE WORKFLOW (MOST IMPORTANT)
Before acting, understand the FULL workflow. Common examples:
- Search → Type query → Press Enter OR click search button → WAIT for results → Click on result
- Chat/Message → FIRST navigate to the correct conversation → THEN type message → Click send
- Login → Enter username → Enter password → Click login button
- Form → Fill ALL required fields → Submit

⚠️ NEVER skip steps! If you need to message someone, you MUST:
1. First verify you're in the correct conversation/chat
2. Check the URL and page title to confirm context
3. Only then type your message

### 2. Before EVERY Action:
1. ASK: "Am I in the right context?" (correct page, correct conversation, correct form?)
2. READ the current page elements carefully
3. FIND the correct element by matching text/attributes
4. VERIFY the element index exists in the list
5. Only then execute the action

### 3. SEARCH WORKFLOW (CRITICAL):
After typing in a search field, you MUST:
1. Press Enter OR click the search button to execute the search
2. WAIT for search results to load
3. Verify results are relevant to your query
4. Then click on the correct result

⚠️ Just typing in a search box does NOTHING! You must trigger the search!

### 4. MESSAGING/CHAT WORKFLOW:
Before typing a message:
1. VERIFY you are in the correct conversation (check URL, title, recipient name)
2. If not in correct conversation → navigate there first
3. Only then type your message
4. Click send or press Enter

⚠️ Don't just type into any text field! Make sure you're in the right place!

### 5. Self-Verification (MANDATORY):
- evaluationPreviousAction: ALWAYS evaluate what actually happened
- Check the page state - did elements change? Did new content appear?
- If you typed text, verify the input field now shows that text
- If you clicked a button, verify something changed (new page, modal, updated content)

### 6. Input Field Rules:
- ALWAYS inspect input field BEFORE typing to see if it has existing text
- If field shows ANY existing text → use { "clearFirst": true }
- After typing, verify the input shows ONLY your intended text

### 7. Error Recovery:
- NEVER retry same action with same params if it failed
- Analyze WHY it failed, then try DIFFERENT approach
- If element not found → scroll to reveal it, or check if page changed

### When to Return DONE:
- Subtask objective is clearly achieved AND verifiable from page state
- You have VERIFIED the result, not just assumed success

### When to Return FAIL:
- Element not found after scrolling entire page
- Same approach failed 2+ times despite variations
- Page state makes subtask impossible
- You're in the wrong context and can't navigate to correct one
`;

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
   * Execute a single subtask with improved failure detection
   */
  async executeSubTask(subtask: SubTask): Promise<SubTaskResult> {
    const startTime = Date.now();
    const steps: ActionResult[] = [];
    let retryCount = 0;
    let consecutiveFailures = 0;
    let sameStateCount = 0; // Count steps with same state (URL + no DOM changes)
    let lastStateHash = ''; // Hash of URL + key DOM content
    const actionHistory: ActionAttempt[] = [];
    const tokensAtStart = this.totalTokens;

    try {
      // Choose distillation mode based on subtask
      const mode = this.chooseDOMMode(subtask);
      
      // Pre-check: Maybe subtask is already complete?
      // This handles cases where a previous subtask's action (e.g., pressing Enter after password)
      // already completed this subtask (e.g., click login button)
      const initialDom = await this.distiller.distill(mode);
      const isAlreadyComplete = await this.verifySubtaskCompletion(subtask, initialDom, []);
      if (isAlreadyComplete) {
        console.log(`[BrowserNav] ✅ Subtask appears already complete (possibly from previous action)`);
        return this.createResult(subtask.id, true, steps, startTime, retryCount, undefined, tokensAtStart);
      }
      
      for (let step = 0; step < this.config.maxStepsPerSubtask; step++) {
        // Get current page state
        const dom = await this.distiller.distill(mode);
        
        // Create a simple state hash for comparison
        // Include URL + first few elements to detect DOM changes even on same URL
        const elements = 'elements' in dom ? dom.elements : ('content' in dom ? dom.content : []);
        const domSummary = elements.slice(0, 10).map(e => {
          const text = 'text' in e ? e.text : 'content' in e ? e.content : '';
          return `${e.tag}:${(text || '').slice(0, 20)}`;
        }).join('|');
        const currentStateHash = `${dom.url}::${domSummary}`;
        
        // Detect no-progress: same state hash means nothing changed
        if (currentStateHash === lastStateHash && step > 0) {
          sameStateCount++;
          console.log(`[BrowserNav] Same state detected (${sameStateCount} times)`);
        } else {
          // State changed - reset counter
          if (lastStateHash && currentStateHash !== lastStateHash) {
            console.log(`[BrowserNav] State changed - progress detected`);
          }
          sameStateCount = 0;
          lastStateHash = currentStateHash;
        }
        
        // If same state for 4+ consecutive steps, force failure
        if (sameStateCount >= 4) {
          console.error(`[BrowserNav] No progress detected for ${sameStateCount} steps with same state`);
          return this.createResult(subtask.id, false, steps, startTime, retryCount, {
            code: 'NO_PROGRESS' as SubTaskErrorCode,
            message: `No progress after ${sameStateCount} consecutive steps. The subtask may be impossible or the approach is wrong.`,
            step: steps.length,
          }, tokensAtStart);
        }
        
        // Decide next action - pass action history for better context
        const decision = await this.decideAction(subtask, dom, steps, actionHistory);
        
        // Check for completion signal
        if (decision.action === 'done') {
          // VERIFY completion before accepting it
          const isVerified = await this.verifySubtaskCompletion(subtask, dom, steps);
          if (isVerified) {
            console.log(`[BrowserNav] ✅ Subtask verified as complete`);
            return this.createResult(subtask.id, true, steps, startTime, retryCount, undefined, tokensAtStart);
          } else {
            // Model claims done but verification failed - don't trust it
            console.warn(`[BrowserNav] ⚠️ Model claimed done but verification failed - continuing`);
            // Inject feedback that verification failed
            actionHistory.push({
              action: 'wait' as ActionType,
              params: {},
              success: false,
              feedback: 'VERIFICATION FAILED: You claimed the subtask is done but it is NOT verified. Check the page state carefully and either complete the subtask or report failure.',
            });
            sameStateCount++; // Count this as no progress
            continue;
          }
        }
        
        // Check if model explicitly failed
        if (decision.action === 'fail') {
          const reason = decision.failReason || decision.reasoning || 'Model determined subtask is not achievable';
          console.error(`[BrowserNav] Model reported failure: ${reason}`);
          return this.createResult(subtask.id, false, steps, startTime, retryCount, {
            code: 'MODEL_REPORTED_FAILURE' as SubTaskErrorCode,
            message: reason,
            step: steps.length,
          }, tokensAtStart);
        }
        
        // Detect repeated action (same action + same params)
        const isDuplicateAction = this.isDuplicateAction(decision, actionHistory);
        if (isDuplicateAction) {
          console.warn(`[BrowserNav] Detected duplicate action, model may be stuck`);
          sameStateCount++;
        }
        
        // Capture pre-action state for page change detection
        const preActionUrl = dom.url;
        
        // Start observing changes
        this.observer.startObserving();
        
        // Execute action
        const result = await this.executor.execute(
          decision.action as ActionType,
          decision.params as never
        );
        
        // Stop observing and get changes
        const changes = this.observer.stopObserving();
        
        // Page change detection - get current URL after action
        let postActionUrl = preActionUrl;
        let pageChanged = false;
        try {
          const postDom = await this.distiller.distill(mode);
          postActionUrl = postDom.url;
          pageChanged = preActionUrl !== postActionUrl;
          
          if (pageChanged) {
            console.log(`[BrowserNav] 🔄 Page changed: ${preActionUrl} → ${postActionUrl}`);
            
            // Reset state counter on page change - this IS progress!
            sameStateCount = 0;
            
            // For submit/login/navigate actions, page change often means SUCCESS
            const isNavigationAction = this.isNavigationRelatedAction(subtask, decision.action as ActionType);
            if (isNavigationAction) {
              console.log(`[BrowserNav] ✅ Page navigation detected for submit/login action - marking as SUCCESS`);
              // Page changed after a navigation-related action = subtask complete!
              return this.createResult(subtask.id, true, steps, startTime, retryCount, undefined, tokensAtStart);
            }
            
            // Update last state hash to new page
            lastStateHash = '';
          }
        } catch {
          // Ignore if we can't get post-action state
        }
        
        // Enrich result with observations
        const enrichedResult: ActionResult = {
          ...result,
          mutations: changes.mutations,
          verbalFeedback: changes.verbalFeedback || result.verbalFeedback,
        };
        
        steps.push(enrichedResult);
        
        // Track action attempt for history
        actionHistory.push({
          action: decision.action as ActionType,
          params: decision.params,
          success: result.success,
          feedback: result.verbalFeedback,
        });
        
        // Check if action succeeded
        if (!result.success) {
          retryCount++;
          consecutiveFailures++;
          
          // If 3 consecutive failures, abort
          if (consecutiveFailures >= 3) {
            console.error(`[BrowserNav] ${consecutiveFailures} consecutive action failures`);
            return this.createResult(subtask.id, false, steps, startTime, retryCount, {
              code: 'CONSECUTIVE_FAILURES' as SubTaskErrorCode,
              message: `${consecutiveFailures} consecutive action failures. Last error: ${result.error?.message || 'unknown'}`,
              step,
              lastAction: enrichedResult,
            }, tokensAtStart);
          }
        } else {
          consecutiveFailures = 0; // Reset on success
        }
        
        // Check if subtask is complete
        const isComplete = await this.checkCompletion(subtask, dom, steps);
        if (isComplete) {
          return this.createResult(subtask.id, true, steps, startTime, retryCount, undefined, tokensAtStart);
        }
      }
      
      // Max steps exceeded
      return this.createResult(subtask.id, false, steps, startTime, retryCount, {
        code: 'MAX_STEPS_EXCEEDED' as SubTaskErrorCode,
        message: `Exceeded max steps (${this.config.maxStepsPerSubtask})`,
        step: steps.length,
      }, tokensAtStart);
      
    } catch (error) {
      const errorMessage = error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
      console.error(`[BrowserNav] Subtask "${subtask.description}" failed at step ${steps.length}: ${errorMessage}`);
      return this.createResult(subtask.id, false, steps, startTime, retryCount, {
        code: 'ACTION_FAILED' as SubTaskErrorCode,
        message: errorMessage,
        step: steps.length,
      }, tokensAtStart);
    }
  }
  
  /**
   * Check if this is a navigation-related action where page change = success
   */
  private isNavigationRelatedAction(subtask: SubTask, actionType: ActionType): boolean {
    const description = subtask.description.toLowerCase();
    const action = subtask.action.toLowerCase();
    
    // Keywords that indicate navigation actions
    const navKeywords = ['submit', 'login', 'signin', 'sign in', 'log in', 'signup', 'register', 
                         'checkout', 'proceed', 'continue', 'next', 'confirm', 'go to'];
    
    // Check if subtask description contains navigation keywords
    if (navKeywords.some(kw => description.includes(kw) || action.includes(kw))) {
      return true;
    }
    
    // Click actions on forms are often navigation
    if (actionType === 'click' && (description.includes('button') || description.includes('form'))) {
      return true;
    }
    
    // Navigate action is always navigation-related
    if (actionType === 'navigate') {
      return true;
    }
    
    return false;
  }
  
  /**
   * Check if decision is a duplicate of a recent action
   */
  private isDuplicateAction(decision: ActionDecision, history: ActionAttempt[]): boolean {
    if (history.length === 0) return false;
    
    // Check last 3 actions for duplicates
    const recentActions = history.slice(-3);
    for (const attempt of recentActions) {
      if (attempt.action === decision.action &&
          JSON.stringify(attempt.params) === JSON.stringify(decision.params)) {
        return true;
      }
    }
    return false;
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
   * Decide the next action based on subtask and current DOM (with optional screenshot)
   */
  private async decideAction(
    subtask: SubTask,
    dom: DistilledDOM,
    previousSteps: ActionResult[],
    actionHistory: ActionAttempt[] = []
  ): Promise<ActionDecision> {
    const textPrompt = this.buildActionPrompt(subtask, dom, previousSteps, actionHistory);
    
    // Build message content - with or without screenshot
    let userContent: string | ContentPart[];
    
    if (this.config.screenshotOnAction) {
      try {
        // Capture screenshot and include it
        const screenshotBase64 = await this.executor.captureScreenshot();
        if (screenshotBase64) {
          userContent = [
            {
              type: 'text' as const,
              text: textPrompt + '\n\n## Screenshot\nA screenshot of the current browser state is attached. Use it to verify the visual state and identify elements.',
            },
            {
              type: 'image_url' as const,
              image_url: {
                url: `data:image/png;base64,${screenshotBase64}`,
                detail: 'low' as const, // Use low detail to save tokens
              },
            },
          ];
          console.log('[BrowserNav] 📸 Screenshot captured and sent to model');
        } else {
          userContent = textPrompt;
        }
      } catch (err) {
        // If screenshot fails, continue without it
        console.warn('[BrowserNav] Screenshot capture failed, continuing without:', err);
        userContent = textPrompt;
      }
    } else {
      userContent = textPrompt;
    }
    
    const messages: LLMMessage[] = [
      { role: 'system', content: this.config.customSystemPrompt },
      { role: 'user', content: userContent },
    ];
    
    // Some OpenAI-compatible gateways may reject `response_format`.
    // We therefore rely on prompt instruction for JSON, and only request
    // `responseFormat` when explicitly enabled in the future.
    const response = await this.llm.complete({ messages });
    this.totalTokens += response.usage.totalTokens;
    
    try {
      return JSON.parse(extractJSON(response.content)) as ActionDecision;
    } catch {
      // Default to waiting if parse fails
      return { action: 'wait', params: { duration: 1000 } };
    }
  }
  
  /**
   * Build prompt for action decision with detailed action history
   */
  private buildActionPrompt(
    subtask: SubTask,
    dom: DistilledDOM,
    previousSteps: ActionResult[],
    actionHistory: ActionAttempt[] = []
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
    elements.slice(0, maxElements).forEach((el: any) => {
      // Build a descriptive line for each element
      let desc = `[${el.index}] ${el.tag}`;
      
      // Add type info for better identification
      if (el.type && el.type !== el.tag) {
        desc += ` (${el.type})`;
      }
      
      // Add placeholder - critical for identifying input purpose
      if (el.placeholder) {
        desc += ` placeholder="${el.placeholder}"`;
      }
      
      // Add current value if any
      if (el.currentValue) {
        desc += ` [CURRENT VALUE: "${el.currentValue}"]`;
      }
      
      // Add accessible name or text
      const displayText = el.accessibleName || el.text || el.content || '';
      if (displayText && displayText !== el.placeholder) {
        desc += `: ${displayText.slice(0, 60)}`;
      }
      
      // Add context hint if available
      if (el.contextHint) {
        desc += ` {${el.contextHint}}`;
      }
      
      prompt += `${desc}\n`;
    });
    
    if (elements.length > maxElements) {
      prompt += `... and ${elements.length - maxElements} more elements\n`;
    }
    
    // Add detailed action history (more context than previousSteps)
    if (actionHistory.length > 0) {
      prompt += `\n## Action History (${actionHistory.length} total)\n`;
      prompt += `⚠️ IMPORTANT: Review these actions to avoid repeating failed approaches!\n\n`;
      
      // Show all history for analysis
      actionHistory.forEach((attempt, i) => {
        const status = attempt.success ? '✓' : '✗';
        const paramsStr = JSON.stringify(attempt.params);
        prompt += `${i + 1}. [${status}] ${attempt.action}(${paramsStr})\n`;
        prompt += `   Feedback: ${attempt.feedback}\n`;
        if (!attempt.success) {
          prompt += `   ⚠️ THIS ACTION FAILED - DO NOT REPEAT THE SAME APPROACH\n`;
        }
        prompt += `\n`;
      });
      
      // Count failures
      const failureCount = actionHistory.filter(a => !a.success).length;
      if (failureCount > 0) {
        prompt += `\n⚠️ WARNING: ${failureCount} actions have failed. `;
        prompt += `If you're making no progress, return { "action": "fail", "failReason": "..." }\n`;
      }
    } else if (previousSteps.length > 0) {
      // Fallback to previousSteps if no actionHistory
      prompt += `\n## Previous Actions (${previousSteps.length})\n`;
      previousSteps.slice(-3).forEach(step => {
        prompt += `- ${step.action}: ${step.success ? 'Success' : 'Failed'} - ${step.verbalFeedback}\n`;
      });
    }
    
    // Budget warning - inject when approaching step limit
    const currentStep = actionHistory.length;
    const maxSteps = this.config.maxStepsPerSubtask;
    const budgetUsed = currentStep / maxSteps;
    
    if (budgetUsed >= 0.75) {
      const stepsRemaining = maxSteps - currentStep;
      prompt += `\n## ⚠️ BUDGET WARNING
You have used ${currentStep}/${maxSteps} steps (${Math.round(budgetUsed * 100)}%).
Only ${stepsRemaining} step(s) remaining!
- If the subtask cannot be completed in remaining steps, return { "action": "fail", "failReason": "..." }
- Prioritize the most critical action to make progress
`;
    }
    
    prompt += `\n## Your Decision
REMEMBER: 
1. First, evaluate your previous action (Success/Failure/Uncertain)
2. Update your memory with progress
3. State your next goal clearly
4. Then choose your action

- If subtask is COMPLETE, return { "action": "done" }
- If subtask is IMPOSSIBLE or you cannot make progress, return { "action": "fail", "failReason": "..." }
- Otherwise, choose a DIFFERENT approach than what failed before.`;
    
    return prompt;
  }
  
  /**
   * Verify subtask completion using LLM with screenshot
   */
  private async verifySubtaskCompletion(
    subtask: SubTask,
    dom: DistilledDOM,
    steps: ActionResult[]
  ): Promise<boolean> {
    try {
      const elements = 'elements' in dom ? dom.elements : ('content' in dom ? dom.content : []);
      
      // Build verification prompt
      let verifyPrompt = `## Verification Task
You are verifying if a subtask has been completed. Answer ONLY "yes" or "no".

## Subtask that was supposed to be completed:
"${subtask.description}"
Target: ${subtask.target || 'Not specified'}
Value: ${subtask.value || 'Not specified'}

## Current Page State:
URL: ${dom.url}
Title: ${dom.title}

## Current Page Elements (first 30):
`;
      
      elements.slice(0, 30).forEach((el: any) => {
        let desc = `[${el.index}] ${el.tag}`;
        if (el.currentValue) desc += ` value="${el.currentValue}"`;
        const text = el.accessibleName || el.text || el.content || '';
        if (text) desc += `: ${text.slice(0, 50)}`;
        verifyPrompt += `${desc}\n`;
      });
      
      verifyPrompt += `
## Actions that were taken:
`;
      steps.slice(-5).forEach((step, i) => {
        verifyPrompt += `${i + 1}. ${step.action}: ${step.success ? 'Success' : 'Failed'} - ${step.verbalFeedback}\n`;
      });
      
      verifyPrompt += `
## Question:
Is the subtask "${subtask.description}" ACTUALLY COMPLETED based on the current page state?
Consider:
- Can you see evidence that the subtask was successful?
- Did the page change to indicate completion?
- Are there any error messages visible?

Answer with ONLY "yes" or "no":`;
      
      // Build message with optional screenshot
      let userContent: string | ContentPart[];
      
      if (this.config.screenshotOnAction) {
        try {
          const screenshot = await this.executor.captureScreenshot();
          if (screenshot) {
            userContent = [
              { type: 'text' as const, text: verifyPrompt },
              { type: 'image_url' as const, image_url: { url: `data:image/png;base64,${screenshot}`, detail: 'low' as const } },
            ];
          } else {
            userContent = verifyPrompt;
          }
        } catch {
          userContent = verifyPrompt;
        }
      } else {
        userContent = verifyPrompt;
      }
      
      const response = await this.llm.complete({
        messages: [
          { role: 'system', content: 'You are a verification agent. Answer only "yes" or "no".' },
          { role: 'user', content: userContent },
        ],
      });
      this.totalTokens += response.usage.totalTokens;
      
      const answer = response.content.toLowerCase().trim();
      return answer.includes('yes');
      
    } catch (err) {
      console.warn('[BrowserNav] Verification failed, defaulting to false:', err);
      return false;
    }
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
    error?: SubTaskResult['error'],
    tokensAtStart = 0,
  ): SubTaskResult {
    return {
      subtaskId,
      success,
      steps,
      ...(error !== undefined && { error }),
      startTime,
      endTime: Date.now(),
      tokensUsed: this.totalTokens - tokensAtStart,
      retryCount,
    };
  }
  
  getTokensUsed(): number {
    return this.totalTokens;
  }
}
