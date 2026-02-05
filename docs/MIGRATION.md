# Migration Guide: v1 → v2

This guide helps you migrate from Web Agent SDK v1 to v2.

## Overview of Changes

v2 introduces a complete architecture redesign:

| Feature | v1 | v2 |
|---------|----|----|
| Architecture | Single agent | Hierarchical (Planner + BrowserNav) |
| DOM Handling | Raw HTML | Distilled (80-95% token reduction) |
| Error Recovery | None | Automatic retry with backoff |
| Change Detection | None | MutationObserver + verbal feedback |
| Function Calling | Manual | Skill Registry |

## Breaking Changes

### 1. Configuration Changes

**v1:**
```typescript
const agent = new WebAgent({
  apiEndpoint: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-...',
  model: 'gpt-4',
  systemPrompt: '...',
  debug: true,
  onAction: (action, params, result) => {},
});
```

**v2:**
```typescript
const agent = new WebAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-4-turbo',
    apiKey: 'sk-...',
  },
  debug: true,
  maxStepsPerSubtask: 10,
  retry: {
    maxRetries: 3,
    backoffMs: 1000,
  },
  prompts: {
    planner: '...',
    browserNav: '...',
  },
});

// Events instead of callbacks
agent.on('action:complete', ({ result }) => {});
```

### 2. Method Signature Changes

**v1 - chat():**
```typescript
const response = await agent.chat("Click the login button");
// Returns: string
```

**v2 - execute():**
```typescript
const result = await agent.execute("Click the login button");
// Returns: TaskResult with detailed breakdown
```

**v1 - act():**
```typescript
await agent.act('click', { index: 5 });
// Returns: ActionResult
```

**v2 - act():**
```typescript
await agent.act('click', { index: 5 });
// Returns: ActionResult (same, but with more fields)
```

### 3. Context Retrieval Changes

**v1:**
```typescript
const context = agent.getContext();
// Returns: PageContext with all elements
```

**v2:**
```typescript
const context = await agent.getContext('input_fields');
// Returns: DistilledDOM with mode-specific elements
```

## Migration Steps

### Step 1: Update Dependencies

```bash
npm install web-agent-sdk@2.0.0
```

### Step 2: Update Configuration

```typescript
// Before
const agent = new WebAgent({
  apiEndpoint: '...',
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4',
});

// After
const agent = new WebAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-4-turbo',
    apiKey: process.env.OPENAI_API_KEY,
  },
});
```

### Step 3: Replace Callbacks with Events

```typescript
// Before
const agent = new WebAgent({
  onAction: (action, params, result) => {
    console.log(`${action}: ${result.success}`);
  },
});

// After
const agent = new WebAgent({ ... });
agent.on('action:complete', ({ result }) => {
  console.log(`${result.action}: ${result.success}`);
});
```

### Step 4: Update Task Execution

```typescript
// Before
const response = await agent.chat("Fill the form");
console.log(response); // Just a string

// After
const result = await agent.execute("Fill the form");
console.log(result.summary);
console.log(result.totalSteps);
console.log(result.success);
```

### Step 5: Use Distillation Modes

```typescript
// Before (got everything)
const context = agent.getContext();
const allElements = context.elements;

// After (choose what you need)
import { DOMDistillationMode } from 'web-agent-sdk';

// For form filling
const forms = await agent.getContext(DOMDistillationMode.INPUT_FIELDS);

// For reading content
const text = await agent.getContext(DOMDistillationMode.TEXT_ONLY);

// For navigation
const all = await agent.getContext(DOMDistillationMode.ALL_FIELDS);
```

## New Features to Explore

### 1. Event System

```typescript
agent.on('task:start', ({ taskId, task }) => {});
agent.on('task:plan', ({ taskId, plan }) => {});
agent.on('subtask:start', ({ subtask }) => {});
agent.on('subtask:complete', ({ result }) => {});
agent.on('task:complete', ({ result }) => {});
```

### 2. Custom Skills

```typescript
const skills = agent.getSkillRegistry();
skills.register({
  name: 'my_custom_skill',
  description: 'Does something special',
  parameters: { type: 'object', properties: {} },
  category: 'utility',
  execute: async (params) => { /* ... */ },
});
```

### 3. Playwright Integration

```typescript
import { PlaywrightAdapter } from 'web-agent-sdk';
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();

agent.setBrowserAdapter(new PlaywrightAdapter(page));
```

### 4. Detailed Results

```typescript
const result = await agent.execute(task);

// Breakdown by subtask
result.subtaskResults.forEach(sr => {
  console.log(`Subtask: ${sr.success ? '✓' : '✗'}`);
  console.log(`Steps: ${sr.steps.length}`);
  console.log(`Tokens: ${sr.tokensUsed}`);
});

// Overall metrics
console.log(`Total steps: ${result.totalSteps}`);
console.log(`Total tokens: ${result.totalTokens}`);
console.log(`Duration: ${result.totalDuration}ms`);
```

## FAQ

### Q: Why is my token usage lower?
A: v2 uses DOM distillation to reduce context size by 80-95%.

### Q: Why do I see "PlannerAgent" and "BrowserNavigationAgent"?
A: v2 uses a hierarchical architecture. The Planner breaks down tasks, and BrowserNav executes them.

### Q: Can I still use the simple chat() method?
A: No, use `execute()` instead. For simple responses, check `result.summary`.

### Q: Is v1 still supported?
A: v1 will receive security updates only. All new features are in v2.

## Need Help?

- GitHub Issues: https://github.com/Hert4/web-agent-sdk/issues
- Documentation: https://github.com/Hert4/web-agent-sdk/docs
