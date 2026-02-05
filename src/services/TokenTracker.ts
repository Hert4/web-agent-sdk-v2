/**
 * @fileoverview TokenTracker - Tracks token usage and costs
 */

// ============================================================================
// TYPES
// ============================================================================

export interface TokenUsageRecord {
  timestamp: number;
  agent: 'planner' | 'browserNav';
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

export interface TokenMetrics {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCost: number;
  averageTokensPerRequest: number;
  requestCount: number;
  byAgent: {
    planner: { tokens: number; cost: number; requests: number };
    browserNav: { tokens: number; cost: number; requests: number };
  };
  byModel: Record<string, { tokens: number; cost: number; requests: number }>;
}

// ============================================================================
// PRICING (per 1K tokens, approximate)
// ============================================================================

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4-turbo-preview': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  
  // Anthropic
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-opus': { input: 0.015, output: 0.075 },
  'claude-3-sonnet': { input: 0.003, output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  
  // Default for unknown models
  'default': { input: 0.01, output: 0.03 },
};

// ============================================================================
// TOKEN TRACKER CLASS
// ============================================================================

export class TokenTracker {
  private records: TokenUsageRecord[] = [];
  private maxRecords: number;
  private defaultModel: string;

  constructor(options: { maxRecords?: number; defaultModel?: string } = {}) {
    this.maxRecords = options.maxRecords ?? 1000;
    this.defaultModel = options.defaultModel ?? 'default';
  }

  /**
   * Track a new usage record
   */
  track(
    agent: 'planner' | 'browserNav',
    model: string,
    promptTokens: number,
    completionTokens: number
  ): TokenUsageRecord {
    const cost = this.calculateCost(model, promptTokens, completionTokens);

    const record: TokenUsageRecord = {
      timestamp: Date.now(),
      agent,
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cost,
    };

    this.records.push(record);

    // Trim records if needed
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    return record;
  }

  /**
   * Get aggregated metrics
   */
  getMetrics(): TokenMetrics {
    const metrics: TokenMetrics = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      averageTokensPerRequest: 0,
      requestCount: this.records.length,
      byAgent: {
        planner: { tokens: 0, cost: 0, requests: 0 },
        browserNav: { tokens: 0, cost: 0, requests: 0 },
      },
      byModel: {},
    };

    for (const record of this.records) {
      metrics.totalPromptTokens += record.promptTokens;
      metrics.totalCompletionTokens += record.completionTokens;
      metrics.totalTokens += record.totalTokens;
      metrics.totalCost += record.cost;

      // By agent
      metrics.byAgent[record.agent].tokens += record.totalTokens;
      metrics.byAgent[record.agent].cost += record.cost;
      metrics.byAgent[record.agent].requests += 1;

      // By model
      if (!metrics.byModel[record.model]) {
        metrics.byModel[record.model] = { tokens: 0, cost: 0, requests: 0 };
      }
      metrics.byModel[record.model].tokens += record.totalTokens;
      metrics.byModel[record.model].cost += record.cost;
      metrics.byModel[record.model].requests += 1;
    }

    if (this.records.length > 0) {
      metrics.averageTokensPerRequest = metrics.totalTokens / this.records.length;
    }

    return metrics;
  }

  /**
   * Get recent records
   */
  getRecords(count?: number): TokenUsageRecord[] {
    const n = count ?? this.records.length;
    return this.records.slice(-n);
  }

  /**
   * Get records for a specific time range
   */
  getRecordsByTimeRange(startTime: number, endTime: number): TokenUsageRecord[] {
    return this.records.filter(
      r => r.timestamp >= startTime && r.timestamp <= endTime
    );
  }

  /**
   * Calculate estimated cost for tokens
   */
  estimateCost(model: string, promptTokens: number, completionTokens: number): number {
    return this.calculateCost(model, promptTokens, completionTokens);
  }

  /**
   * Get budget status
   */
  getBudgetStatus(budget: number): {
    spent: number;
    remaining: number;
    percentUsed: number;
    projectedTotal: number;
  } {
    const metrics = this.getMetrics();
    const spent = metrics.totalCost;
    const remaining = Math.max(0, budget - spent);
    const percentUsed = budget > 0 ? (spent / budget) * 100 : 0;

    // Project total based on average cost per request
    const averageCostPerRequest = metrics.requestCount > 0 
      ? spent / metrics.requestCount 
      : 0;
    
    return {
      spent,
      remaining,
      percentUsed,
      projectedTotal: spent, // Could be enhanced with trend analysis
    };
  }

  /**
   * Clear all records
   */
  clear(): void {
    this.records = [];
  }

  /**
   * Export records for analysis
   */
  export(): TokenUsageRecord[] {
    return [...this.records];
  }

  /**
   * Import records (for restoring state)
   */
  import(records: TokenUsageRecord[]): void {
    this.records = [...records].slice(-this.maxRecords);
  }

  /**
   * Calculate cost for a request
   */
  private calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number
  ): number {
    const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['default']!;
    
    const inputCost = (promptTokens / 1000) * pricing.input;
    const outputCost = (completionTokens / 1000) * pricing.output;
    
    return inputCost + outputCost;
  }
}

/**
 * Create a token tracker instance
 */
export function createTokenTracker(
  options?: { maxRecords?: number; defaultModel?: string }
): TokenTracker {
  return new TokenTracker(options);
}
