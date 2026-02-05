/**
 * Example 2: E-commerce Flow with Playwright
 * 
 * This example shows how to use the SDK with Playwright
 * for more complex automation scenarios.
 */

import { chromium } from 'playwright';
import { WebAgent, PlaywrightAdapter } from 'web-agent-sdk';

async function main() {
  // Launch browser
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Navigate to Amazon
  await page.goto('https://www.amazon.com');

  // Initialize agent with Playwright adapter
  const agent = new WebAgent({
    llm: {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: process.env.ANTHROPIC_API_KEY!,
    },
    maxStepsPerSubtask: 15,
    screenshots: true,
  });

  // Set up Playwright adapter
  agent.setBrowserAdapter(new PlaywrightAdapter(page));

  // Track progress
  let stepCount = 0;
  agent.on('action:complete', ({ result }) => {
    stepCount++;
    console.log(`[Step ${stepCount}] ${result.action}: ${result.verbalFeedback}`);
    
    // Save screenshot if available
    if (result.screenshot) {
      // Could save to file here
    }
  });

  try {
    // Execute complex e-commerce task
    const result = await agent.execute(`
      1. Search for "wireless bluetooth headphones"
      2. Filter by 4+ stars rating
      3. Sort by price low to high
      4. Click on the first product
      5. Add it to the cart
      6. Verify the cart shows 1 item
    `);

    console.log('\n=== Task Result ===');
    console.log(`Success: ${result.success}`);
    console.log(`Total Steps: ${result.totalSteps}`);
    console.log(`Duration: ${result.totalDuration}ms`);
    console.log(`Tokens Used: ${result.totalTokens}`);
    
    // Print subtask breakdown
    console.log('\n=== Subtask Breakdown ===');
    result.subtaskResults.forEach((sr, i) => {
      const status = sr.success ? '✓' : '✗';
      console.log(`${status} Subtask ${i + 1}: ${sr.steps.length} steps, ${sr.tokensUsed} tokens`);
    });

  } catch (error) {
    console.error('Task failed:', error);
  } finally {
    await browser.close();
  }
}

main();
