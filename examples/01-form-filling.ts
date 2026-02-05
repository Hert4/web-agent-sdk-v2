/**
 * Example 1: Basic Form Filling
 * 
 * This example demonstrates how to use the Web Agent SDK
 * to fill out a simple login form.
 */

import { WebAgent } from 'web-agent-sdk';

async function main() {
  // Initialize the agent
  const agent = new WebAgent({
    llm: {
      provider: 'openai',
      model: 'gpt-4-turbo',
      apiKey: process.env.OPENAI_API_KEY!,
    },
    debug: true,
  });

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
      console.log('Error:', result.error?.message);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
