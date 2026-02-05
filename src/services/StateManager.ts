/**
 * @fileoverview StateManager - Manages checkpoints and state restoration
 */

// ============================================================================
// TYPES
// ============================================================================

export interface Checkpoint {
  id: string;
  label: string;
  timestamp: number;
  url: string;
  scrollPosition: { x: number; y: number };
  formData: Map<string, string>;
  cookies?: string;
}

export interface StateSnapshot {
  url: string;
  title: string;
  scrollX: number;
  scrollY: number;
  formValues: Record<string, string>;
}

// ============================================================================
// STATE MANAGER CLASS
// ============================================================================

export class StateManager {
  private checkpoints: Map<string, Checkpoint> = new Map();
  private history: StateSnapshot[] = [];
  private maxHistory: number;
  private document: Document;
  private window: Window;

  constructor(options: { maxHistory?: number; doc?: Document; win?: Window } = {}) {
    this.maxHistory = options.maxHistory ?? 50;
    this.document = options.doc || document;
    this.window = options.win || window;
  }

  /**
   * Save a checkpoint of the current state
   */
  saveCheckpoint(label: string): Checkpoint {
    const id = `checkpoint_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const checkpoint: Checkpoint = {
      id,
      label,
      timestamp: Date.now(),
      url: this.window.location.href,
      scrollPosition: {
        x: this.window.scrollX,
        y: this.window.scrollY,
      },
      formData: this.captureFormData(),
    };

    this.checkpoints.set(id, checkpoint);
    return checkpoint;
  }

  /**
   * Restore state from a checkpoint
   */
  async restoreCheckpoint(checkpointId: string): Promise<boolean> {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      return false;
    }

    // Navigate to the URL if different
    if (this.window.location.href !== checkpoint.url) {
      this.window.location.href = checkpoint.url;
      // Wait for navigation
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Restore scroll position
    this.window.scrollTo(checkpoint.scrollPosition.x, checkpoint.scrollPosition.y);

    // Restore form data
    this.restoreFormData(checkpoint.formData);

    return true;
  }

  /**
   * Get a checkpoint by ID
   */
  getCheckpoint(id: string): Checkpoint | undefined {
    return this.checkpoints.get(id);
  }

  /**
   * Get all checkpoints
   */
  getAllCheckpoints(): Checkpoint[] {
    return Array.from(this.checkpoints.values());
  }

  /**
   * Delete a checkpoint
   */
  deleteCheckpoint(id: string): boolean {
    return this.checkpoints.delete(id);
  }

  /**
   * Clear all checkpoints
   */
  clearCheckpoints(): void {
    this.checkpoints.clear();
  }

  /**
   * Take a snapshot of current state (for history)
   */
  takeSnapshot(): StateSnapshot {
    const snapshot: StateSnapshot = {
      url: this.window.location.href,
      title: this.document.title,
      scrollX: this.window.scrollX,
      scrollY: this.window.scrollY,
      formValues: Object.fromEntries(this.captureFormData()),
    };

    this.history.push(snapshot);

    // Trim history if needed
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    return snapshot;
  }

  /**
   * Get recent history
   */
  getHistory(count?: number): StateSnapshot[] {
    const n = count ?? this.history.length;
    return this.history.slice(-n);
  }

  /**
   * Check if we can go back in history
   */
  canGoBack(): boolean {
    return this.history.length > 1;
  }

  /**
   * Get the previous snapshot
   */
  getPreviousSnapshot(): StateSnapshot | undefined {
    if (this.history.length < 2) return undefined;
    return this.history[this.history.length - 2];
  }

  /**
   * Capture all form data on the page
   */
  private captureFormData(): Map<string, string> {
    const data = new Map<string, string>();
    
    // Capture inputs
    const inputs = this.document.querySelectorAll('input, textarea, select');
    inputs.forEach((element) => {
      const el = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const key = el.id || el.name;
      
      if (!key) return;

      if (el instanceof HTMLInputElement) {
        if (el.type === 'checkbox' || el.type === 'radio') {
          if (el.checked) {
            data.set(key, el.value || 'on');
          }
        } else if (el.type !== 'password') {
          data.set(key, el.value);
        }
      } else {
        data.set(key, el.value);
      }
    });

    return data;
  }

  /**
   * Restore form data from captured state
   */
  private restoreFormData(formData: Map<string, string>): void {
    formData.forEach((value, key) => {
      const element = this.document.getElementById(key) || 
                      this.document.querySelector(`[name="${key}"]`);
      
      if (!element) return;

      if (element instanceof HTMLInputElement) {
        if (element.type === 'checkbox' || element.type === 'radio') {
          element.checked = value === element.value || value === 'on';
        } else {
          element.value = value;
        }
      } else if (element instanceof HTMLTextAreaElement || 
                 element instanceof HTMLSelectElement) {
        element.value = value;
      }

      // Trigger change event
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
}

/**
 * Create a state manager instance
 */
export function createStateManager(
  options?: { maxHistory?: number }
): StateManager {
  return new StateManager(options);
}
