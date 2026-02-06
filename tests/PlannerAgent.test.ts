import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlannerAgent } from '../src/agents/PlannerAgent';

// Mock LLM Provider
const createMockLLM = (response: string) => ({
  complete: vi.fn().mockResolvedValue({
    content: response,
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    finishReason: 'stop',
  }),
  estimateTokens: vi.fn().mockReturnValue(100),
  getConfig: vi.fn().mockReturnValue({}),
});

describe('PlannerAgent', () => {
  describe('Task Planning', () => {
    it('should decompose a simple task into subtasks', async () => {
      const mockResponse = JSON.stringify({
        subtasks: [
          { id: '1', description: 'Click search box', action: 'click', target: 'search input', verification: 'Focus gained' },
          { id: '2', description: 'Type search term', action: 'type', target: 'search input', value: 'laptop', verification: 'Text entered' },
          { id: '3', description: 'Submit search', action: 'click', target: 'search button', verification: 'Results appear' },
        ],
      });
      
      const llm = createMockLLM(mockResponse);
      const planner = new PlannerAgent(llm as any);
      
      const plan = await planner.planTask('Search for laptop', {
        url: 'https://example.com',
        title: 'Example Store',
      });
      
      expect(plan.subtasks).toHaveLength(3);
      expect(plan.subtasks[0]?.action).toBe('click');
      expect(plan.subtasks[1]?.action).toBe('type');
      expect(plan.originalTask).toBe('Search for laptop');
    });

    it('should handle malformed LLM response gracefully', async () => {
      const llm = createMockLLM('not valid json');
      const planner = new PlannerAgent(llm as any);

      const plan = await planner.planTask('Test task', {
        url: 'https://example.com',
        title: 'Test',
      });

      // Should fall back to a single navigate subtask
      expect(plan.subtasks).toHaveLength(1);
      expect(plan.subtasks[0]?.action).toBe('navigate');
      expect(plan.subtasks[0]?.description).toBe('Test task');
      expect(plan.originalTask).toBe('Test task');
    });

    it('should limit subtasks to max configured', async () => {
      const manySubtasks = Array.from({ length: 30 }, (_, i) => ({
        id: String(i + 1),
        description: `Step ${i + 1}`,
        action: 'click',
        verification: 'Done',
      }));
      
      const llm = createMockLLM(JSON.stringify({ subtasks: manySubtasks }));
      const planner = new PlannerAgent(llm as any, { maxSubtasks: 10 });
      
      const plan = await planner.planTask('Many steps task', {
        url: 'https://example.com',
        title: 'Test',
      });
      
      expect(plan.subtasks.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Verification', () => {
    it('should verify successful subtask completion', async () => {
      const mockResponse = JSON.stringify({
        completed: true,
        confidence: 0.95,
        reason: 'Search results appeared on page',
      });
      
      const llm = createMockLLM(mockResponse);
      const planner = new PlannerAgent(llm as any);
      
      const result = await planner.verifyCompletion(
        { id: '1', description: 'Search', action: 'search', verification: 'Results appear' },
        { subtaskId: '1', success: true, steps: [], startTime: 0, endTime: 100, tokensUsed: 50, retryCount: 0 },
        { url: 'https://example.com/search?q=laptop', title: 'Search Results' }
      );
      
      expect(result.completed).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should handle failed verification', async () => {
      const mockResponse = JSON.stringify({
        completed: false,
        confidence: 0.8,
        reason: 'Error message appeared instead of results',
        suggestion: 'Retry the search',
      });
      
      const llm = createMockLLM(mockResponse);
      const planner = new PlannerAgent(llm as any);
      
      const result = await planner.verifyCompletion(
        { id: '1', description: 'Search', action: 'search', verification: 'Results appear' },
        { subtaskId: '1', success: false, steps: [], startTime: 0, endTime: 100, tokensUsed: 50, retryCount: 1 },
        { url: 'https://example.com/error', title: 'Error' }
      );
      
      expect(result.completed).toBe(false);
      expect(result.suggestion).toBeDefined();
    });
  });

  describe('Error Recovery', () => {
    it('should suggest retry for recoverable errors', async () => {
      const mockResponse = JSON.stringify({
        recoverable: true,
        strategy: 'retry',
        reason: 'Element may not have loaded yet',
      });
      
      const llm = createMockLLM(mockResponse);
      const planner = new PlannerAgent(llm as any);
      
      const recovery = await planner.handleFailure(
        { id: '1', description: 'Click button', action: 'click', verification: 'Dialog opens' },
        new Error('Element not found'),
        { url: 'https://example.com', title: 'Test' }
      );
      
      expect(recovery.recoverable).toBe(true);
      expect(recovery.strategy).toBe('retry');
    });

    it('should suggest abort for unrecoverable errors', async () => {
      const mockResponse = JSON.stringify({
        recoverable: false,
        strategy: 'abort',
        reason: 'Page requires authentication',
      });
      
      const llm = createMockLLM(mockResponse);
      const planner = new PlannerAgent(llm as any);
      
      const recovery = await planner.handleFailure(
        { id: '1', description: 'Access dashboard', action: 'navigate', verification: 'Dashboard loads' },
        new Error('401 Unauthorized'),
        { url: 'https://example.com/login', title: 'Login Required' }
      );
      
      expect(recovery.recoverable).toBe(false);
      expect(recovery.strategy).toBe('abort');
    });
  });
});
