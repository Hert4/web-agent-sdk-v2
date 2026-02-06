/**
 * Example 4: Browser-Only Usage
 * 
 * This example shows how to use the SDK directly in the browser
 * without any server-side code.
 */

// HTML file that includes this script
/*
<!DOCTYPE html>
<html>
<head>
  <title>Web Agent Demo</title>
  <script type="module" src="./browser-agent.js"></script>
</head>
<body>
  <div id="app">
    <h1>Web Agent Demo</h1>
    <input type="text" id="task-input" placeholder="Enter a task...">
    <button id="execute-btn">Execute</button>
    <div id="output"></div>
  </div>
</body>
</html>
*/

// When built: import from 'web-agent-sdk/browser'
// For development (without dist/): import from source
import { WebAgent, DOMDistillationMode } from '../src/browser';

// Initialize agent when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const agent = new WebAgent({
    llm: {
      provider: 'openai',
      model: 'gpt-4-turbo',
      // API key would typically come from user input or secure storage
      apiKey: localStorage.getItem('openai_key') || '',
    },
  });

  const taskInput = document.getElementById('task-input') as HTMLInputElement;
  const executeBtn = document.getElementById('execute-btn') as HTMLButtonElement;
  const output = document.getElementById('output') as HTMLDivElement;

  // Helper to log to output div
  function log(message: string, type: 'info' | 'success' | 'error' = 'info') {
    const colors = {
      info: '#333',
      success: '#28a745',
      error: '#dc3545',
    };
    output.innerHTML += `<p style="color: ${colors[type]}">${message}</p>`;
    output.scrollTop = output.scrollHeight;
  }

  // Set up event listeners
  agent.on('task:start', ({ task }) => {
    log(`🚀 Starting: ${task}`);
  });

  agent.on('subtask:start', ({ subtask }) => {
    log(`  → ${subtask.description}`);
  });

  agent.on('action:complete', ({ result }) => {
    const icon = result.success ? '✓' : '✗';
    log(`    ${icon} ${result.verbalFeedback}`, result.success ? 'success' : 'error');
  });

  agent.on('task:complete', ({ result }) => {
    log(`\n${result.success ? '✅' : '❌'} ${result.summary}`, result.success ? 'success' : 'error');
    log(`Stats: ${result.totalSteps} steps, ${result.totalTokens} tokens, ${result.totalDuration}ms`);
    executeBtn.disabled = false;
  });

  // Execute button handler
  executeBtn.addEventListener('click', async () => {
    const task = taskInput.value.trim();
    if (!task) {
      alert('Please enter a task');
      return;
    }

    output.innerHTML = '';
    executeBtn.disabled = true;

    try {
      await agent.execute(task);
    } catch (error) {
      log(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      executeBtn.disabled = false;
    }
  });

  // Quick action buttons
  const quickActions = [
    { label: 'Get Page Context', action: async () => {
      const context = await agent.getContext(DOMDistillationMode.ALL_FIELDS);
      log(`Found ${context.elements?.length || 0} interactive elements`);
      log(`Token count: ${context.tokenCount}`);
    }},
    { label: 'Get Text Content', action: async () => {
      const context = await agent.getContext(DOMDistillationMode.TEXT_ONLY);
      log(`Extracted ${context.content?.length || 0} text blocks`);
    }},
    { label: 'Get Form Fields', action: async () => {
      const context = await agent.getContext(DOMDistillationMode.INPUT_FIELDS);
      log(`Found ${context.elements?.length || 0} form fields`);
    }},
  ];

  const actionsDiv = document.createElement('div');
  actionsDiv.style.marginTop = '10px';
  
  quickActions.forEach(({ label, action }) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.marginRight = '5px';
    btn.addEventListener('click', async () => {
      try {
        await action();
      } catch (error) {
        log(`Error: ${error instanceof Error ? error.message : 'Unknown'}`, 'error');
      }
    });
    actionsDiv.appendChild(btn);
  });

  document.getElementById('app')?.appendChild(actionsDiv);
});
