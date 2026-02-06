/**
 * @fileoverview Core type definitions for Web Agent SDK v2.0
 * 
 * These types define the contracts between all components of the system.
 * Following a strict TypeScript approach with no implicit any.
 */

// ============================================================================
// DOM DISTILLATION TYPES
// ============================================================================

/**
 * DOM distillation modes - determines what information to extract from the page
 */
export enum DOMDistillationMode {
  /** Extract only readable text content - minimal tokens */
  TEXT_ONLY = 'text_only',
  
  /** Extract only interactive form elements - for form filling */
  INPUT_FIELDS = 'input_fields',
  
  /** Extract all interactive elements with hierarchy - comprehensive */
  ALL_FIELDS = 'all_fields',
  
  /** Smart hybrid mode - automatically choose based on context */
  SMART = 'smart'
}

/**
 * Represents a bounding box for element positioning
 */
export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Base interface for all distilled elements
 */
export interface DistilledElementBase {
  /** Unique index for this session - used by LLM to reference elements */
  readonly index: number;
  
  /** HTML tag name (lowercase) */
  readonly tag: string;
  
  /** CSS selector for locating the element */
  readonly selector: string;
  
  /** XPath selector as backup */
  readonly xpath: string;
  
  /** Whether element is currently visible */
  readonly visible: boolean;
  
  /** Whether element is interactable (enabled, not hidden) */
  readonly interactable: boolean;
  
  /** Element's bounding box if visible */
  readonly boundingBox?: BoundingBox;
  
  /** ARIA role if present */
  readonly role?: string;
  
  /** Accessible name (aria-label, title, or computed) */
  readonly accessibleName?: string;
}

/**
 * Text content element (for TEXT_ONLY mode)
 */
export interface TextElement {
  readonly type: 'text';
  readonly content: string;
  readonly tag: string;
  readonly index: number;
}

/**
 * Input field element (for INPUT_FIELDS mode)
 */
export interface InputFieldElement extends DistilledElementBase {
  readonly type: 'input' | 'textarea' | 'select' | 'button' | 'checkbox' | 'radio';
  
  /** Input type attribute */
  readonly inputType?: string;
  
  /** Current value */
  readonly value?: string;
  
  /** Placeholder text */
  readonly placeholder?: string;
  
  /** Associated label text */
  readonly label?: string;
  
  /** Whether the field is required */
  readonly required?: boolean;
  
  /** Whether the field is disabled */
  readonly disabled?: boolean;
  
  /** Validation pattern if any */
  readonly pattern?: string;
  
  /** For select elements - available options */
  readonly options?: ReadonlyArray<{ value: string; text: string; selected: boolean }>;
  
  /** Button/submit text */
  readonly buttonText?: string;
}

/**
 * Interactive element (for ALL_FIELDS mode)
 */
export interface InteractiveElement extends DistilledElementBase {
  readonly type: 'link' | 'button' | 'input' | 'select' | 'checkbox' | 'radio' | 
                 'textarea' | 'menu' | 'tab' | 'dialog' | 'other';
  
  /** Visible text content */
  readonly text?: string;
  
  /** href for links */
  readonly href?: string;
  
  /** All relevant attributes */
  readonly attributes?: Readonly<Record<string, string>>;
  
  /** Parent context (for nested elements) */
  readonly context?: string;
  
  /** Children indices if container */
  readonly children?: readonly number[];
}

/**
 * Distilled DOM for TEXT_ONLY mode
 */
export interface TextOnlyDOM {
  readonly mode: DOMDistillationMode.TEXT_ONLY;
  readonly url: string;
  readonly title: string;
  readonly content: readonly TextElement[];
  readonly tokenCount: number;
  readonly extractedAt: number;
}

/**
 * Distilled DOM for INPUT_FIELDS mode
 */
export interface InputFieldsDOM {
  readonly mode: DOMDistillationMode.INPUT_FIELDS;
  readonly url: string;
  readonly title: string;
  readonly elements: readonly InputFieldElement[];
  readonly forms: readonly FormInfo[];
  readonly tokenCount: number;
  readonly extractedAt: number;
}

/**
 * Distilled DOM for ALL_FIELDS mode
 */
export interface AllFieldsDOM {
  readonly mode: DOMDistillationMode.ALL_FIELDS;
  readonly url: string;
  readonly title: string;
  readonly elements: readonly InteractiveElement[];
  readonly landmarks: readonly LandmarkInfo[];
  readonly tokenCount: number;
  readonly extractedAt: number;
}

/**
 * Union type for all distilled DOM types
 */
export type DistilledDOM = TextOnlyDOM | InputFieldsDOM | AllFieldsDOM;

/**
 * Form information
 */
export interface FormInfo {
  readonly index: number;
  readonly name?: string;
  readonly action?: string;
  readonly method?: string;
  readonly fieldIndices: readonly number[];
}

/**
 * ARIA landmark information
 */
export interface LandmarkInfo {
  readonly role: string;
  readonly label?: string;
  readonly elementIndex: number;
}

/**
 * Distillation metrics for monitoring
 */
export interface DistillationMetrics {
  readonly rawTokens: number;
  readonly distilledTokens: number;
  readonly reductionRatio: number;
  readonly elementsTotal: number;
  readonly elementsKept: number;
  readonly processingTimeMs: number;
}

// ============================================================================
// ACTION TYPES
// ============================================================================

/**
 * All supported action types
 */
export type ActionType = 
  | 'click'
  | 'doubleClick'
  | 'rightClick'
  | 'type'
  | 'clear'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'scroll'
  | 'scrollToElement'
  | 'hover'
  | 'focus'
  | 'blur'
  | 'press'
  | 'wait'
  | 'waitForElement'
  | 'waitForNavigation'
  | 'navigate'
  | 'goBack'
  | 'goForward'
  | 'refresh'
  | 'screenshot';

/**
 * Parameters for each action type
 */
export interface ActionParams {
  click: { index: number; button?: 'left' | 'right' | 'middle' };
  doubleClick: { index: number };
  rightClick: { index: number };
  type: { index: number; text: string; delay?: number; clearFirst?: boolean };
  clear: { index: number };
  select: { index: number; value: string | string[] };
  check: { index: number };
  uncheck: { index: number };
  scroll: { direction: 'up' | 'down' | 'left' | 'right'; amount?: number };
  scrollToElement: { index: number };
  hover: { index: number };
  focus: { index: number };
  blur: { index: number };
  press: { key: string; modifiers?: Array<'Control' | 'Shift' | 'Alt' | 'Meta'> };
  wait: { duration: number };
  waitForElement: { selector: string; timeout?: number; state?: 'visible' | 'hidden' | 'attached' | 'detached' };
  waitForNavigation: { timeout?: number };
  navigate: { url: string };
  goBack: Record<string, never>;
  goForward: Record<string, never>;
  refresh: Record<string, never>;
  screenshot: { fullPage?: boolean; path?: string };
}

/**
 * Result of executing an action
 */
export interface ActionResult {
  readonly success: boolean;
  readonly action: ActionType;
  readonly params: ActionParams[ActionType];
  readonly error?: ActionError;
  readonly duration: number;
  
  /** DOM state before action */
  readonly before?: ElementSnapshot;
  
  /** DOM state after action */
  readonly after?: ElementSnapshot;
  
  /** Detected DOM mutations */
  readonly mutations?: readonly DOMChange[];
  
  /** Human-readable description of what happened */
  readonly verbalFeedback: string;
  
  /** Screenshot taken after action (base64) */
  readonly screenshot?: string;
}

/**
 * Snapshot of an element's state
 */
export interface ElementSnapshot {
  readonly index: number;
  readonly selector: string;
  readonly exists: boolean;
  readonly visible: boolean;
  readonly value?: string;
  readonly text?: string;
  readonly boundingBox?: BoundingBox;
  readonly attributes?: Readonly<Record<string, string>>;
}

/**
 * Represents a DOM change detected by MutationObserver
 */
export interface DOMChange {
  readonly type: 'added' | 'removed' | 'modified' | 'text';
  readonly target: string;
  readonly description: string;
}

/**
 * Action execution error
 */
export interface ActionError {
  readonly code: ActionErrorCode;
  readonly message: string;
  readonly recoverable: boolean;
  readonly suggestion?: string;
}

export enum ActionErrorCode {
  ELEMENT_NOT_FOUND = 'ELEMENT_NOT_FOUND',
  ELEMENT_NOT_VISIBLE = 'ELEMENT_NOT_VISIBLE',
  ELEMENT_NOT_INTERACTABLE = 'ELEMENT_NOT_INTERACTABLE',
  TIMEOUT = 'TIMEOUT',
  NAVIGATION_FAILED = 'NAVIGATION_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  INVALID_PARAMS = 'INVALID_PARAMS',
  UNKNOWN = 'UNKNOWN'
}

// ============================================================================
// AGENT TYPES
// ============================================================================

/**
 * SubTask generated by PlannerAgent
 */
export interface SubTask {
  readonly id: string;
  readonly description: string;
  readonly action: string;
  readonly target?: string;
  readonly value?: string;
  readonly verification: string;
  readonly dependencies?: readonly string[];
  readonly estimatedSteps?: number;
  readonly priority?: 'high' | 'medium' | 'low';
}

/**
 * Result of executing a SubTask
 */
export interface SubTaskResult {
  readonly subtaskId: string;
  readonly success: boolean;
  readonly steps: readonly ActionResult[];
  readonly error?: SubTaskError;
  readonly startTime: number;
  readonly endTime: number;
  readonly tokensUsed: number;
  readonly retryCount: number;
}

export interface SubTaskError {
  readonly code: SubTaskErrorCode;
  readonly message: string;
  readonly step?: number;
  readonly lastAction?: ActionResult;
}

export enum SubTaskErrorCode {
  MAX_STEPS_EXCEEDED = 'MAX_STEPS_EXCEEDED',
  VERIFICATION_FAILED = 'VERIFICATION_FAILED',
  ACTION_FAILED = 'ACTION_FAILED',
  CONTEXT_OVERFLOW = 'CONTEXT_OVERFLOW',
  LLM_ERROR = 'LLM_ERROR',
  TIMEOUT = 'TIMEOUT'
}

/**
 * Plan generated by PlannerAgent
 */
export interface TaskPlan {
  readonly taskId: string;
  readonly originalTask: string;
  readonly subtasks: readonly SubTask[];
  readonly estimatedTotalSteps: number;
  readonly createdAt: number;
}

/**
 * Final result of task execution
 */
export interface TaskResult {
  readonly taskId: string;
  readonly success: boolean;
  readonly plan: TaskPlan;
  readonly subtaskResults: readonly SubTaskResult[];
  readonly summary: string;
  readonly totalSteps: number;
  readonly totalTokens: number;
  readonly totalDuration: number;
  readonly error?: TaskError;
}

export interface TaskError {
  readonly code: string;
  readonly message: string;
  readonly failedSubtask?: SubTask;
  readonly recoveryAttempts: number;
}

// ============================================================================
// SKILL TYPES
// ============================================================================

/**
 * JSON Schema for skill parameters
 */
export interface JSONSchema {
  readonly type: 'object' | 'string' | 'number' | 'boolean' | 'array';
  readonly properties?: Readonly<Record<string, JSONSchemaProperty>>;
  readonly required?: readonly string[];
  readonly description?: string;
}

export interface JSONSchemaProperty {
  readonly type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly items?: JSONSchemaProperty;
  readonly default?: unknown;
}

/**
 * Skill definition
 */
export interface Skill<TParams = unknown, TResult = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters: JSONSchema;
  readonly category: 'navigation' | 'interaction' | 'observation' | 'utility';
  execute(params: TParams): Promise<TResult>;
}

/**
 * OpenAI function calling format
 */
export interface OpenAIFunction {
  readonly name: string;
  readonly description: string;
  readonly parameters: JSONSchema;
}

/**
 * Anthropic tool format
 */
export interface AnthropicTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: JSONSchema;
}

// ============================================================================
// LLM PROVIDER TYPES
// ============================================================================

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'local';

export interface LLMConfig {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly timeout?: number;
}

/**
 * Content part for multimodal messages
 */
export interface TextContentPart {
  readonly type: 'text';
  readonly text: string;
}

export interface ImageContentPart {
  readonly type: 'image_url';
  readonly image_url: {
    readonly url: string; // base64 data URL or http URL
    readonly detail?: 'low' | 'high' | 'auto';
  };
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  /** Content can be string or array of content parts (for multimodal) */
  readonly content: string | readonly ContentPart[];
  readonly name?: string;
  readonly tool_call_id?: string;
}

export interface LLMRequest {
  readonly messages: readonly LLMMessage[];
  readonly tools?: readonly OpenAIFunction[] | readonly AnthropicTool[];
  readonly toolChoice?: 'auto' | 'required' | 'none' | { name: string };
  readonly responseFormat?: 'text' | 'json';
}

export interface LLMResponse {
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly usage: TokenUsage;
  readonly finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string; // JSON string
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Main WebAgent configuration
 */
export interface WebAgentConfig {
  /** LLM configuration */
  readonly llm: LLMConfig;
  
  /** Maximum steps per subtask */
  readonly maxStepsPerSubtask?: number;
  
  /** Maximum subtasks per task */
  readonly maxSubtasksPerTask?: number;
  
  /** Maximum total steps */
  readonly maxTotalSteps?: number;
  
  /** Action timeout in milliseconds */
  readonly actionTimeout?: number;
  
  /** Enable debug mode */
  readonly debug?: boolean;
  
  /** Take screenshots after each action */
  readonly screenshots?: boolean;
  
  /** Custom system prompts */
  readonly prompts?: CustomPrompts;
  
  /** Retry configuration */
  readonly retry?: RetryConfig;
}

export interface CustomPrompts {
  readonly planner?: string;
  readonly browserNav?: string;
}

export interface RetryConfig {
  readonly maxRetries: number;
  readonly backoffMs: number;
  readonly backoffMultiplier: number;
}

// ============================================================================
// EVENT TYPES
// ============================================================================

/**
 * All events emitted by WebAgent
 */
export interface WebAgentEvents {
  'task:start': { taskId: string; task: string };
  'task:plan': { taskId: string; plan: TaskPlan };
  'task:complete': { taskId: string; result: TaskResult };
  'task:error': { taskId: string; error: TaskError };
  
  'subtask:start': { taskId: string; subtask: SubTask };
  'subtask:complete': { taskId: string; result: SubTaskResult };
  'subtask:error': { taskId: string; subtask: SubTask; error: SubTaskError };
  
  'action:start': { taskId: string; action: ActionType; params: unknown };
  'action:complete': { taskId: string; result: ActionResult };
  
  'dom:distill': { taskId: string; mode: DOMDistillationMode; metrics: DistillationMetrics };
  'dom:change': { taskId: string; changes: readonly DOMChange[] };
  
  'llm:request': { taskId: string; agent: 'planner' | 'browserNav'; tokens: number };
  'llm:response': { taskId: string; agent: 'planner' | 'browserNav'; usage: TokenUsage };
  
  'error:recovery': { taskId: string; error: unknown; strategy: string };
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Deep readonly type
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/**
 * Result type for operations that can fail
 */
export type Result<T, E = Error> = 
  | { success: true; value: T }
  | { success: false; error: E };

/**
 * Async result type
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

/**
 * Nullable type
 */
export type Nullable<T> = T | null;
