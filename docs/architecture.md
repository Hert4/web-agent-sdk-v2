# Web Agent SDK v2.0 - Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER APPLICATION                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  const agent = new WebAgent(config);                                        │
│  await agent.execute("Search for laptops on Amazon and add cheapest to cart");│
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR LAYER                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         WebAgent (Facade)                            │   │
│  │  - Simple API for end users                                          │   │
│  │  - Coordinates Planner + BrowserNav                                  │   │
│  │  - Handles lifecycle (start, stop, pause)                            │   │
│  │  - Event emission for monitoring                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
┌───────────────────────────────────┐  ┌───────────────────────────────────┐
│         PLANNER AGENT             │  │     BROWSER NAVIGATION AGENT      │
│  ┌─────────────────────────────┐  │  │  ┌─────────────────────────────┐  │
│  │ Responsibilities:           │  │  │  │ Responsibilities:           │  │
│  │ • Task decomposition        │  │  │  │ • Execute single subtask    │  │
│  │ • High-level planning       │  │  │  │ • Choose DOM distill mode   │  │
│  │ • Progress tracking         │  │  │  │ • Observe DOM changes       │  │
│  │ • Failure handling          │  │  │  │ • Report results            │  │
│  │ • Success verification      │  │  │  │ • Error recovery            │  │
│  └─────────────────────────────┘  │  │  └─────────────────────────────┘  │
│                                   │  │                                   │
│  Input: User task (natural lang)  │  │  Input: SubTask + PageContext     │
│  Output: List<SubTask>            │  │  Output: SubTaskResult            │
│                                   │  │                                   │
│  LLM: GPT-4 / Claude (reasoning)  │  │  LLM: GPT-4 / Claude (execution)  │
│  Context: ~2K tokens (no DOM)     │  │  Context: ~20K tokens (distilled) │
└───────────────────────────────────┘  └───────────────────────────────────┘
                    │                                   │
                    │                                   │
                    │         ┌─────────────────────────┤
                    │         │                         │
                    ▼         ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CORE SERVICES LAYER                               │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │  DOM Distiller   │  │ Action Executor  │  │ Change Observer  │          │
│  │  ─────────────   │  │ ───────────────  │  │ ───────────────  │          │
│  │  • text_only     │  │ • click          │  │ • MutationObs    │          │
│  │  • input_fields  │  │ • type           │  │ • Verbal feedback│          │
│  │  • all_fields    │  │ • scroll         │  │ • Diff detection │          │
│  │  • smart_hybrid  │  │ • navigate       │  │ • Screenshot     │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │  Skill Registry  │  │  Error Handler   │  │  State Manager   │          │
│  │  ─────────────   │  │  ─────────────   │  │  ─────────────   │          │
│  │  • Primitive     │  │  • Classify      │  │  • Checkpoints   │          │
│  │  • Composite     │  │  • Retry logic   │  │  • Restore       │          │
│  │  • Function call │  │  • Recovery      │  │  • History       │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           INFRASTRUCTURE LAYER                               │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │   LLM Provider   │  │ Browser Adapter  │  │   DOM Analyzer   │          │
│  │   ────────────   │  │ ───────────────  │  │   ────────────   │          │
│  │   • OpenAI       │  │ • Playwright     │  │   • A11y Tree    │          │
│  │   • Anthropic    │  │ • Puppeteer      │  │   • Shadow DOM   │          │
│  │   • Google       │  │ • Browser API    │  │   • iFrames      │          │
│  │   • Local LLM    │  │ • WebDriver      │  │   • Canvas       │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │  Token Tracker   │  │   DOM Cache      │  │  Event Emitter   │          │
│  │  ─────────────   │  │   ─────────────  │  │  ─────────────   │          │
│  │  • Usage stats   │  │   • Page cache   │  │  • Logging       │          │
│  │  • Cost calc     │  │   • Invalidation │  │  • Monitoring    │          │
│  │  • Optimization  │  │   • TTL          │  │  • Debug         │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
User Task: "Add a laptop under $500 to cart on Amazon"
│
▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: WebAgent receives task                                               │
│ • Validates input                                                            │
│ • Initializes session                                                        │
│ • Emits 'task:start' event                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: PlannerAgent decomposes task                                         │
│                                                                              │
│ Input to LLM:                                                                │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ System: You are a task planning agent. Break down user tasks into       │ │
│ │ atomic subtasks that a browser automation agent can execute.            │ │
│ │                                                                         │ │
│ │ Current URL: https://www.amazon.com                                     │ │
│ │ Page Title: Amazon.com. Spend less. Smile more.                         │ │
│ │                                                                         │ │
│ │ User Task: "Add a laptop under $500 to cart on Amazon"                  │ │
│ │                                                                         │ │
│ │ Output format: JSON array of subtasks                                   │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ Output from LLM:                                                             │
│ [                                                                            │
│   { "id": 1, "action": "search", "target": "search box",                    │
│     "value": "laptop", "verification": "search results appear" },           │
│   { "id": 2, "action": "filter", "target": "price filter",                  │
│     "value": "under $500", "verification": "filtered results" },            │
│   { "id": 3, "action": "select", "target": "first laptop result",           │
│     "verification": "product page opens" },                                  │
│   { "id": 4, "action": "click", "target": "add to cart button",             │
│     "verification": "cart count increases" }                                 │
│ ]                                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: BrowserNavigationAgent executes subtask 1                            │
│                                                                              │
│ 3a. Choose distillation mode based on subtask:                               │
│     "search" action → INPUT_FIELDS mode (focus on search box)                │
│                                                                              │
│ 3b. Get distilled DOM:                                                       │
│     ┌─────────────────────────────────────────────────────────────────────┐ │
│     │ {                                                                   │ │
│     │   "mode": "input_fields",                                           │ │
│     │   "url": "https://www.amazon.com",                                  │ │
│     │   "elements": [                                                     │ │
│     │     { "index": 0, "tag": "input", "type": "search",                 │ │
│     │       "placeholder": "Search Amazon", "selector": "#twotabsearchtextbox" }, │
│     │     { "index": 1, "tag": "button", "text": "Go",                    │ │
│     │       "selector": "#nav-search-submit-button" }                     │ │
│     │   ],                                                                │ │
│     │   "tokenCount": 150                                                 │ │
│     │ }                                                                   │ │
│     └─────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│ 3c. Send to LLM for action decision:                                         │
│     Input: SubTask + Distilled DOM                                           │
│     Output: { "skill": "type_and_submit", "index": 0, "text": "laptop" }     │
│                                                                              │
│ 3d. Execute action via ActionExecutor                                        │
│                                                                              │
│ 3e. Observe changes via ChangeObserver:                                      │
│     { "urlChanged": true, "newUrl": "amazon.com/s?k=laptop",                │
│       "verbalFeedback": "Search results page loaded with laptop listings" } │
│                                                                              │
│ 3f. Return SubTaskResult to PlannerAgent                                     │
└─────────────────────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 4: PlannerAgent verifies and continues                                  │
│                                                                              │
│ • Verify subtask 1 completed: ✓ (URL contains search results)                │
│ • Update progress: 1/4 subtasks done                                         │
│ • Continue to subtask 2...                                                   │
│                                                                              │
│ [Loop until all subtasks complete or max steps reached]                      │
└─────────────────────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 5: WebAgent finalizes                                                   │
│                                                                              │
│ • Collect all results                                                        │
│ • Generate summary                                                           │
│ • Emit 'task:complete' event                                                 │
│ • Return TaskResult to user                                                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Module Dependency Graph

```
                    ┌─────────────┐
                    │  WebAgent   │
                    │  (Facade)   │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │  Planner    │ │ BrowserNav  │ │   State     │
    │   Agent     │ │   Agent     │ │  Manager    │
    └──────┬──────┘ └──────┬──────┘ └─────────────┘
           │               │
           │               │
           ▼               ▼
    ┌─────────────┐ ┌─────────────┐
    │    LLM      │ │    Skill    │
    │  Provider   │ │  Registry   │
    └─────────────┘ └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
  │    DOM      │   │   Action    │   │   Change    │
  │  Distiller  │   │  Executor   │   │  Observer   │
  └──────┬──────┘   └──────┬──────┘   └─────────────┘
         │                 │
         ▼                 ▼
  ┌─────────────┐   ┌─────────────┐
  │    DOM      │   │  Browser    │
  │  Analyzer   │   │  Adapter    │
  └─────────────┘   └─────────────┘
```

## Key Design Decisions

### 1. Hierarchical Agents (Planner + BrowserNav)

**Why**: Separation of concerns
- Planner: Thinks at task level, no DOM details → small context
- BrowserNav: Thinks at action level, gets distilled DOM → focused context

**Alternative considered**: Single agent with all capabilities
**Rejected because**: Context overflow, mixed responsibilities, harder to debug

### 2. DOM Distillation with Multiple Modes

**Why**: Different tasks need different information
- Reading content: text_only (minimal tokens)
- Filling forms: input_fields (focused)
- Complex navigation: all_fields (comprehensive)

**Token savings**: 50K → 5K for typical page (10x reduction)

### 3. Skill-based Architecture with Function Calling

**Why**: 
- Clear contracts between LLM and executor
- Easy to extend with new skills
- Works with OpenAI function calling and Anthropic tool use
- Self-documenting

### 4. Event-driven Communication

**Why**:
- Loose coupling between components
- Easy monitoring and logging
- Supports plugins and extensions

### 5. Adapter Pattern for Browser and LLM

**Why**:
- Framework agnostic (Playwright, Puppeteer, browser API)
- LLM provider agnostic (OpenAI, Anthropic, Google, local)
- Easy to test with mocks
