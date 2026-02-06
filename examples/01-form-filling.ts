/**
 * Example 1: Basic Form Filling
 *
 * This example demonstrates how to use the Web Agent SDK
 * to fill out a simple login form.
 *
 * Usage:
 *   npx tsx examples/01-form-filling.ts
 */

import { chromium } from 'playwright';
import { WebAgent, PlaywrightAdapter } from '../src';

// Load .env vars (Node 24 supports --env-file but tsx may not forward it)
const { readFileSync } = await import('node:fs');
const { resolve } = await import('node:path');
try {
  const lines = readFileSync(resolve(process.cwd(), '.env'), 'utf-8').split('\n');
  for (const l of lines) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
} catch { /* .env not found */ }

async function main() {
  // Launch browser (Node.js example)
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // Initialize the agent
  const agent = new WebAgent({
    llm: {
      provider: 'openai',
      model: process.env.WEB_AGENT_OPENAI_MODEL || 'gpt-4-turbo',
      apiKey: process.env.WEB_AGENT_OPENAI_API_KEY || '',
      baseUrl: process.env.WEB_AGENT_OPENAI_BASE_URL,
    },
    debug: true,
  });

  // Use Playwright adapter instead of DOM adapter (no `document` in Node)
  agent.setBrowserAdapter(new PlaywrightAdapter(page));

  // Listen for events
  agent.on('task:start', ({ taskId, task }) => {
    console.log(`[${taskId}] Starting: ${task}`);
  });

  agent.on('subtask:start', ({ subtask }) => {
    console.log(`  → ${subtask.description}`);
  });

  agent.on('action:complete', ({ result }) => {
    console.log(`    ${result.success ? '✓' : '✗'} ${result.verbalFeedback}`);
  });

  agent.on('task:complete', ({ result }) => {
    console.log(`\nCompleted: ${result.summary}`);
    console.log(`Steps: ${result.totalSteps}, Tokens: ${result.totalTokens}`);
  });

  // Execute the task
  try {
    const result = await agent.execute(
      'Fill the login form with email "test@example.com" and password "mypassword123", then click the login button'
    );

    if (result.success) {
      console.log('\n✅ Login form filled successfully!');
    } else {
      console.log('\n❌ Failed to complete the task');
      console.log('Error:', result.error?.message ?? 'No error details (check subtaskResults)');
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

main();
