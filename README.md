# Web Agent SDK v2.0

> 🤖 Production-grade AI agent SDK for web automation with hierarchical multi-agent architecture

[![npm version](https://badge.fury.io/js/web-agent-sdk.svg)](https://badge.fury.io/js/web-agent-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🏗️ **Hierarchical Multi-Agent Architecture** - Planner + Browser Navigation agents
- 📉 **DOM Distillation** - 80-95% token reduction with 3 distillation modes
- 👁️ **Change Observation** - Real-time DOM mutation tracking with verbal feedback
- 🔄 **Error Recovery** - Automatic retry with exponential backoff
- 🔌 **LLM Agnostic** - OpenAI, Anthropic, Google, or local models
- 🌐 **Framework Agnostic** - Works with Playwright, Puppeteer, or browser APIs

## Installation

```bash
npm install web-agent-sdk
```

## Quick Start

```typescript
import { WebAgent } from 'web-agent-sdk';

const agent = new WebAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-4-turbo',
    apiKey: process.env.OPENAI_API_KEY
  }
});

// Execute a complex task
const result = await agent.execute('Search for laptop on Amazon and add cheapest to cart');

console.log(result.summary);
// "Successfully completed task in 12 steps"
```

## Architecture

```
User Task
    │
    ▼
┌─────────────────┐
│   WebAgent      │  ← Facade / Orchestrator
│   (Facade)      │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌─────────┐ ┌─────────────┐
│ Planner │ │ BrowserNav  │
│  Agent  │ │    Agent    │
└────┬────┘ └──────┬──────┘
     │             │
     │        ┌────┴────┐
     │        ▼         ▼
     │   ┌─────────┐ ┌─────────┐
     │   │   DOM   │ │ Action  │
     │   │Distiller│ │Executor │
     │   └─────────┘ └─────────┘
     │
     ▼
  TaskPlan
```

## DOM Distillation Modes

### TEXT_ONLY (~95% token reduction)
Best for reading/understanding page content.

```typescript
const context = await agent.getContext('text_only');
// Returns only text content, no interactive elements
```

### INPUT_FIELDS (~90% token reduction)
Best for form filling and data entry.

```typescript
const context = await agent.getContext('input_fields');
// Returns inputs, buttons, selects only
```

### ALL_FIELDS (~80% token reduction)
Best for complex navigation.

```typescript
const context = await agent.getContext('all_fields');
// Returns all interactive elements with hierarchy
```

## Configuration

```typescript
const agent = new WebAgent({
  // LLM Configuration (required)
  llm: {
    provider: 'openai' | 'anthropic' | 'google',
    model: 'gpt-4-turbo',
    apiKey: 'sk-...',
    maxTokens: 4096,
    temperature: 0.7,
  },
  
  // Execution limits
  maxStepsPerSubtask: 10,
  maxSubtasksPerTask: 20,
  maxTotalSteps: 100,
  actionTimeout: 5000,
  
  // Features
  debug: false,
  screenshots: false,
  
  // Retry configuration
  retry: {
    maxRetries: 3,
    backoffMs: 1000,
    backoffMultiplier: 2,
  },
  
  // Custom prompts
  prompts: {
    planner: 'Custom planner system prompt...',
    browserNav: 'Custom browser nav system prompt...',
  },
});
```

## API Reference

### WebAgent

#### `execute(task: string): Promise<TaskResult>`
Execute a natural language task.

#### `act(action, params): Promise<ActionResult>`
Execute a single action directly.

#### `getContext(mode?): Promise<DistilledDOM>`
Get the current page context with distillation.

#### `stop(): void`
Stop the current task execution.

### Events

```typescript
agent.on('task:start', ({ taskId, task }) => {});
agent.on('task:plan', ({ taskId, plan }) => {});
agent.on('task:complete', ({ taskId, result }) => {});
agent.on('subtask:start', ({ taskId, subtask }) => {});
agent.on('subtask:complete', ({ taskId, result }) => {});
agent.on('action:start', ({ taskId, action, params }) => {});
agent.on('action:complete', ({ taskId, result }) => {});
```

## Examples

### Form Filling

```typescript
const result = await agent.execute(
  'Fill the contact form with name "John Doe", email "john@example.com"'
);
```

### E-commerce Flow

```typescript
const result = await agent.execute(
  'Search for "wireless headphones" on Amazon, sort by price, and add the first result to cart'
);
```

### Data Extraction

```typescript
const context = await agent.getContext('text_only');
const response = await agent.chat('What products are on sale on this page?');
```

## Browser Support

- Chrome/Chromium 90+
- Firefox 90+
- Safari 14+
- Edge 90+

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT © [Hert4](https://github.com/Hert4)
