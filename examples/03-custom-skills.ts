/**
 * Example 3: Custom Skills and Error Recovery
 * 
 * This example demonstrates how to add custom skills
 * and handle errors gracefully.
 */

import { WebAgent, SkillRegistry } from 'web-agent-sdk';

async function main() {
  const agent = new WebAgent({
    llm: {
      provider: 'openai',
      model: 'gpt-4-turbo',
      apiKey: process.env.OPENAI_API_KEY!,
    },
    retry: {
      maxRetries: 5,
      backoffMs: 2000,
      backoffMultiplier: 1.5,
    },
  });

  // Get the skill registry
  const skills = agent.getSkillRegistry();

  // Add a custom skill for handling CAPTCHAs
  skills.register({
    name: 'handle_captcha',
    description: 'Wait for user to solve CAPTCHA manually',
    parameters: {
      type: 'object',
      properties: {
        timeout: {
          type: 'number',
          description: 'Max seconds to wait for CAPTCHA solution',
        },
      },
    },
    category: 'utility',
    execute: async (params: { timeout?: number }) => {
      const timeout = params.timeout ?? 60;
      console.log(`\n⚠️  CAPTCHA detected! Please solve it within ${timeout} seconds...`);
      
      // In a real scenario, you'd wait for the CAPTCHA element to disappear
      await new Promise(resolve => setTimeout(resolve, timeout * 1000));
      
      return { success: true, message: 'CAPTCHA solved' };
    },
  });

  // Add a custom skill for screenshot comparison
  skills.register({
    name: 'compare_screenshots',
    description: 'Compare current page with a reference screenshot',
    parameters: {
      type: 'object',
      properties: {
        reference: {
          type: 'string',
          description: 'Path to reference screenshot',
        },
      },
      required: ['reference'],
    },
    category: 'observation',
    execute: async (params: { reference: string }) => {
      // Placeholder - would actually compare screenshots
      console.log(`Comparing with reference: ${params.reference}`);
      return { match: true, similarity: 0.95 };
    },
  });

  // Track errors for analysis
  const errors: Array<{ subtask: string; error: string; recovered: boolean }> = [];

  agent.on('subtask:error', ({ subtask, error }) => {
    errors.push({
      subtask: subtask.description,
      error: error.message,
      recovered: false,
    });
  });

  agent.on('error:recovery', ({ error, strategy }) => {
    console.log(`🔄 Recovery: ${strategy} for error: ${error}`);
    const lastError = errors[errors.length - 1];
    if (lastError) {
      lastError.recovered = strategy !== 'abort';
    }
  });

  // Execute task with potential errors
  try {
    const result = await agent.execute(`
      Navigate to the admin panel at /admin.
      If there's a CAPTCHA, wait for the user to solve it.
      Then log in with the test credentials.
      Take a screenshot and compare with the expected dashboard.
    `);

    console.log('\n=== Execution Report ===');
    console.log(`Overall Success: ${result.success}`);
    
    if (errors.length > 0) {
      console.log('\n=== Error Report ===');
      errors.forEach((e, i) => {
        const status = e.recovered ? '✓ Recovered' : '✗ Failed';
        console.log(`${i + 1}. ${e.subtask}`);
        console.log(`   Error: ${e.error}`);
        console.log(`   Status: ${status}`);
      });
    }

  } catch (error) {
    console.error('Fatal error:', error);
  }
}

main();
