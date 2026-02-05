/**
 * @fileoverview ErrorHandler - Classifies errors and suggests recovery strategies
 */

import type { ActionErrorCode } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export enum ErrorCategory {
  ELEMENT = 'element',
  NETWORK = 'network',
  TIMEOUT = 'timeout',
  LLM = 'llm',
  VALIDATION = 'validation',
  UNKNOWN = 'unknown',
}

export interface ClassifiedError {
  originalError: Error;
  code: ActionErrorCode;
  category: ErrorCategory;
  recoverable: boolean;
  suggestion: string;
  retryable: boolean;
  backoffMs: number;
}

export interface RecoveryStrategy {
  strategy: 'retry' | 'wait' | 'refresh' | 'scroll' | 'skip' | 'abort';
  params?: Record<string, unknown>;
  reason: string;
}

// ============================================================================
// ERROR PATTERNS
// ============================================================================

const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  code: ActionErrorCode;
  category: ErrorCategory;
  recoverable: boolean;
  suggestion: string;
}> = [
  {
    pattern: /element.*not found|no element|cannot find/i,
    code: 'ELEMENT_NOT_FOUND' as ActionErrorCode,
    category: ErrorCategory.ELEMENT,
    recoverable: true,
    suggestion: 'Wait for the element to appear or scroll to find it',
  },
  {
    pattern: /not visible|hidden|display.*none/i,
    code: 'ELEMENT_NOT_VISIBLE' as ActionErrorCode,
    category: ErrorCategory.ELEMENT,
    recoverable: true,
    suggestion: 'Scroll to make the element visible',
  },
  {
    pattern: /not interactable|disabled|readonly/i,
    code: 'ELEMENT_NOT_INTERACTABLE' as ActionErrorCode,
    category: ErrorCategory.ELEMENT,
    recoverable: true,
    suggestion: 'Wait for the element to become enabled',
  },
  {
    pattern: /timeout|timed out|deadline/i,
    code: 'TIMEOUT' as ActionErrorCode,
    category: ErrorCategory.TIMEOUT,
    recoverable: true,
    suggestion: 'Increase timeout or wait for page to load',
  },
  {
    pattern: /network|fetch|connection|ECONNREFUSED/i,
    code: 'NETWORK_ERROR' as ActionErrorCode,
    category: ErrorCategory.NETWORK,
    recoverable: false,
    suggestion: 'Check network connection',
  },
  {
    pattern: /navigation|navigate|url|redirect/i,
    code: 'NAVIGATION_FAILED' as ActionErrorCode,
    category: ErrorCategory.NETWORK,
    recoverable: true,
    suggestion: 'Retry navigation or check URL',
  },
  {
    pattern: /invalid.*param|parameter|argument/i,
    code: 'INVALID_PARAMS' as ActionErrorCode,
    category: ErrorCategory.VALIDATION,
    recoverable: false,
    suggestion: 'Check action parameters',
  },
  {
    pattern: /rate limit|429|too many requests/i,
    code: 'NETWORK_ERROR' as ActionErrorCode,
    category: ErrorCategory.LLM,
    recoverable: true,
    suggestion: 'Wait and retry with backoff',
  },
  {
    pattern: /context.*length|token.*limit|too long/i,
    code: 'UNKNOWN' as ActionErrorCode,
    category: ErrorCategory.LLM,
    recoverable: true,
    suggestion: 'Use more aggressive DOM distillation',
  },
];

// ============================================================================
// ERROR HANDLER CLASS
// ============================================================================

export class ErrorHandler {
  private retryCount: Map<string, number> = new Map();
  private maxRetries: number;
  private baseBackoffMs: number;

  constructor(options: { maxRetries?: number; baseBackoffMs?: number } = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.baseBackoffMs = options.baseBackoffMs ?? 1000;
  }

  /**
   * Classify an error and determine its characteristics
   */
  classify(error: Error, context?: string): ClassifiedError {
    const message = error.message.toLowerCase();

    for (const pattern of ERROR_PATTERNS) {
      if (pattern.pattern.test(message)) {
        const retryKey = context || message;
        const retries = this.retryCount.get(retryKey) ?? 0;

        return {
          originalError: error,
          code: pattern.code,
          category: pattern.category,
          recoverable: pattern.recoverable && retries < this.maxRetries,
          suggestion: pattern.suggestion,
          retryable: retries < this.maxRetries,
          backoffMs: this.calculateBackoff(retries),
        };
      }
    }

    // Unknown error
    return {
      originalError: error,
      code: 'UNKNOWN' as ActionErrorCode,
      category: ErrorCategory.UNKNOWN,
      recoverable: false,
      suggestion: 'Check error details and try again',
      retryable: false,
      backoffMs: this.baseBackoffMs,
    };
  }

  /**
   * Suggest a recovery strategy based on the classified error
   */
  suggestRecovery(classified: ClassifiedError): RecoveryStrategy {
    if (!classified.recoverable) {
      return {
        strategy: 'abort',
        reason: `Unrecoverable error: ${classified.suggestion}`,
      };
    }

    switch (classified.category) {
      case ErrorCategory.ELEMENT:
        if (classified.code === ('ELEMENT_NOT_FOUND' as ActionErrorCode)) {
          return {
            strategy: 'scroll',
            params: { direction: 'down', amount: 300 },
            reason: 'Element may be below the viewport',
          };
        }
        if (classified.code === ('ELEMENT_NOT_VISIBLE' as ActionErrorCode)) {
          return {
            strategy: 'scroll',
            params: { toElement: true },
            reason: 'Scrolling to element',
          };
        }
        return {
          strategy: 'wait',
          params: { duration: 1000 },
          reason: 'Waiting for element state to change',
        };

      case ErrorCategory.TIMEOUT:
        return {
          strategy: 'refresh',
          reason: 'Page may be stuck, refreshing',
        };

      case ErrorCategory.NETWORK:
        return {
          strategy: 'retry',
          params: { backoff: classified.backoffMs },
          reason: 'Network issue, retrying with backoff',
        };

      case ErrorCategory.LLM:
        return {
          strategy: 'retry',
          params: { backoff: classified.backoffMs * 2 },
          reason: 'LLM service issue, retrying with longer backoff',
        };

      default:
        return {
          strategy: 'skip',
          reason: 'Unknown error, skipping this step',
        };
    }
  }

  /**
   * Record a retry attempt
   */
  recordRetry(context: string): void {
    const current = this.retryCount.get(context) ?? 0;
    this.retryCount.set(context, current + 1);
  }

  /**
   * Reset retry count for a context
   */
  resetRetries(context: string): void {
    this.retryCount.delete(context);
  }

  /**
   * Reset all retry counts
   */
  resetAll(): void {
    this.retryCount.clear();
  }

  /**
   * Calculate backoff time with exponential increase
   */
  private calculateBackoff(retryCount: number): number {
    return this.baseBackoffMs * Math.pow(2, retryCount);
  }
}

/**
 * Create a pre-configured error handler
 */
export function createErrorHandler(
  options?: { maxRetries?: number; baseBackoffMs?: number }
): ErrorHandler {
  return new ErrorHandler(options);
}
