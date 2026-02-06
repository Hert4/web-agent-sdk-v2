/**
 * Example 2: E-commerce Flow with Playwright
 * 
 * This example shows how to use the SDK with Playwright
 * for more complex automation scenarios.
 */

import { chromium, Page } from 'playwright';
import { WebAgent, PlaywrightAdapter } from '../src';

// Screenshot helper using Playwright directly
async function saveScreenshot(page: Page, stepCount: number, action: string): Promise<string> {
  const timestamp = Date.now();
  const filename = `./screenshots/step_${stepCount.toString().padStart(3, '0')}_${action}_${timestamp}.png`;
  await page.screenshot({ path: filename, fullPage: false });
  console.log(`    📸 Screenshot saved: ${filename}`);
  return filename;
}

async function main() {
  // Launch browser
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  // Navigate to Amazon
  await page.goto('https://misajsc.amis.vn/chat');

  // Initialize agent with Playwright adapter
  const agent = new WebAgent({
    llm: {
      // OpenAI-compatible gateway
      provider: 'openai',
      model: "gpt-5.2", // claude-opus-4-1 fine for some reason; gemini-3-pro-preview best but slow; claude-opus-4-5 weak
      apiKey: "misa_misa_00t07fh7_ZFRMf6rOUaVHTv6CZH0uOzAx_LDP1IeWM",
      baseUrl: "http://test-k8s.misa.local/llm-gateway/v1",
    },
    maxStepsPerSubtask: 15,
    screenshots: true,
    debug: true,
  });

  // Set up Playwright adapter
  agent.setBrowserAdapter(new PlaywrightAdapter(page));

  // Track progress
  let stepCount = 0;
  agent.on('subtask:start', ({ subtask }) => {
    console.log(`  → ${subtask.description}`);
  });
  agent.on('subtask:error', ({ subtask, error }) => {
    console.log(`  ✗ Subtask failed: ${subtask.description} — ${error.message}`);
  });
  agent.on('action:complete', async ({ result }) => {
    stepCount++;
    const status = result.success ? '✓' : '✗';
    console.log(`[Step ${stepCount}] ${status} ${result.action}: ${result.verbalFeedback}`);

    // Save screenshot after every action for debugging
    try {
      await saveScreenshot(page, stepCount, result.action);
    } catch (e) {
      console.log(`    ⚠️ Screenshot failed: ${e}`);
    }
  });

  try {
    // Execute complex e-commerce task
    const result = await agent.execute(`
      1. Fine username Quang Dũng"
      2. Login the flatform with username "ductransa01@gmail.com" and password "Duc16122003@"
      3. send him a message "Chào bạn, mình là claude-opus-4-5, đang nói với bạn!"

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

    if (!result.success) {
      console.log('\n=== Error ===');
      if (result.error) {
        console.log(`${result.error.code}: ${result.error.message}`);
      } else {
        // Print first failed subtask error
        const failed = result.subtaskResults.find(sr => !sr.success && sr.error);
        if (failed?.error) console.log(`Subtask error: ${failed.error.message}`);
        else console.log('No error details available');
      }
    }

  } catch (error) {
    console.error('Task failed:', error);
  } finally {
    await browser.close();
  }
}

main();
