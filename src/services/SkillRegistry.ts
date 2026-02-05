/**
 * @fileoverview SkillRegistry - Manages skills for function calling
 */

import type {
  Skill,
  JSONSchema,
  OpenAIFunction,
  AnthropicTool,
  ActionResult,
} from '../types';

// ============================================================================
// SKILL REGISTRY
// ============================================================================

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  
  /**
   * Register a skill
   */
  register<TParams, TResult>(skill: Skill<TParams, TResult>): void {
    this.skills.set(skill.name, skill as Skill);
  }
  
  /**
   * Unregister a skill
   */
  unregister(name: string): boolean {
    return this.skills.delete(name);
  }
  
  /**
   * Get a skill by name
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }
  
  /**
   * Get all skills
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }
  
  /**
   * Get skills by category
   */
  getByCategory(category: Skill['category']): Skill[] {
    return this.getAll().filter(s => s.category === category);
  }
  
  /**
   * Execute a skill by name
   */
  async execute(name: string, params: unknown): Promise<unknown> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }
    return skill.execute(params);
  }
  
  /**
   * Convert to OpenAI function calling format
   */
  toOpenAIFunctions(): OpenAIFunction[] {
    return this.getAll().map(skill => ({
      name: skill.name,
      description: skill.description,
      parameters: skill.parameters,
    }));
  }
  
  /**
   * Convert to Anthropic tool format
   */
  toAnthropicTools(): AnthropicTool[] {
    return this.getAll().map(skill => ({
      name: skill.name,
      description: skill.description,
      input_schema: skill.parameters,
    }));
  }
}

// ============================================================================
// PRIMITIVE SKILLS FACTORY
// ============================================================================

export interface PrimitiveSkillsConfig {
  distiller: { distill: (mode: string) => Promise<unknown>; getElement: (index: number) => Element | null };
  executor: { execute: (action: string, params: unknown) => Promise<ActionResult> };
  browser: { getUrl: () => string; getTitle: () => string };
}

export function createPrimitiveSkills(config: PrimitiveSkillsConfig): Skill[] {
  const { distiller, executor, browser } = config;
  
  const skills: Skill[] = [
    // Navigation skills
    {
      name: 'get_page_info',
      description: 'Get current page URL, title, and DOM elements',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            description: 'Distillation mode: text_only, input_fields, or all_fields',
            enum: ['text_only', 'input_fields', 'all_fields'],
          },
        },
      },
      category: 'observation',
      execute: async (params: { mode?: string }) => {
        const mode = params.mode || 'all_fields';
        const dom = await distiller.distill(mode);
        return {
          url: browser.getUrl(),
          title: browser.getTitle(),
          dom,
        };
      },
    },
    
    {
      name: 'navigate_to',
      description: 'Navigate to a URL',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
        },
        required: ['url'],
      },
      category: 'navigation',
      execute: async (params: { url: string }) => {
        return executor.execute('navigate', { url: params.url });
      },
    },
    
    {
      name: 'go_back',
      description: 'Go back in browser history',
      parameters: { type: 'object', properties: {} },
      category: 'navigation',
      execute: async () => {
        return executor.execute('goBack', {});
      },
    },
    
    {
      name: 'refresh_page',
      description: 'Refresh the current page',
      parameters: { type: 'object', properties: {} },
      category: 'navigation',
      execute: async () => {
        return executor.execute('refresh', {});
      },
    },
    
    // Interaction skills
    {
      name: 'click_element',
      description: 'Click on an element by its index',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Element index from DOM' },
        },
        required: ['index'],
      },
      category: 'interaction',
      execute: async (params: { index: number }) => {
        return executor.execute('click', { index: params.index });
      },
    },
    
    {
      name: 'type_text',
      description: 'Type text into an input field',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Element index' },
          text: { type: 'string', description: 'Text to type' },
          clear_first: { type: 'boolean', description: 'Clear field before typing' },
        },
        required: ['index', 'text'],
      },
      category: 'interaction',
      execute: async (params: { index: number; text: string; clear_first?: boolean }) => {
        return executor.execute('type', {
          index: params.index,
          text: params.text,
          clearFirst: params.clear_first,
        });
      },
    },
    
    {
      name: 'select_option',
      description: 'Select an option from a dropdown',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Select element index' },
          value: { type: 'string', description: 'Option value to select' },
        },
        required: ['index', 'value'],
      },
      category: 'interaction',
      execute: async (params: { index: number; value: string }) => {
        return executor.execute('select', { index: params.index, value: params.value });
      },
    },
    
    {
      name: 'check_checkbox',
      description: 'Check a checkbox or radio button',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Checkbox element index' },
        },
        required: ['index'],
      },
      category: 'interaction',
      execute: async (params: { index: number }) => {
        return executor.execute('check', { index: params.index });
      },
    },
    
    {
      name: 'scroll_page',
      description: 'Scroll the page',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            description: 'Scroll direction',
            enum: ['up', 'down', 'left', 'right'],
          },
          amount: { type: 'number', description: 'Pixels to scroll (default: 300)' },
        },
        required: ['direction'],
      },
      category: 'interaction',
      execute: async (params: { direction: 'up' | 'down' | 'left' | 'right'; amount?: number }) => {
        return executor.execute('scroll', { direction: params.direction, amount: params.amount });
      },
    },
    
    {
      name: 'scroll_to_element',
      description: 'Scroll an element into view',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Element index to scroll to' },
        },
        required: ['index'],
      },
      category: 'interaction',
      execute: async (params: { index: number }) => {
        return executor.execute('scrollToElement', { index: params.index });
      },
    },
    
    {
      name: 'hover_element',
      description: 'Hover over an element',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'Element index' },
        },
        required: ['index'],
      },
      category: 'interaction',
      execute: async (params: { index: number }) => {
        return executor.execute('hover', { index: params.index });
      },
    },
    
    {
      name: 'press_key',
      description: 'Press a keyboard key',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key to press (e.g., Enter, Tab, Escape)' },
          modifiers: {
            type: 'array',
            description: 'Modifier keys',
            items: { type: 'string', enum: ['Control', 'Shift', 'Alt', 'Meta'] },
          },
        },
        required: ['key'],
      },
      category: 'interaction',
      execute: async (params: { key: string; modifiers?: string[] }) => {
        return executor.execute('press', { key: params.key, modifiers: params.modifiers });
      },
    },
    
    // Utility skills
    {
      name: 'wait',
      description: 'Wait for a specified duration',
      parameters: {
        type: 'object',
        properties: {
          duration: { type: 'number', description: 'Milliseconds to wait' },
        },
        required: ['duration'],
      },
      category: 'utility',
      execute: async (params: { duration: number }) => {
        return executor.execute('wait', { duration: params.duration });
      },
    },
    
    {
      name: 'wait_for_element',
      description: 'Wait for an element to appear',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector' },
          timeout: { type: 'number', description: 'Max wait time in ms' },
        },
        required: ['selector'],
      },
      category: 'utility',
      execute: async (params: { selector: string; timeout?: number }) => {
        return executor.execute('waitForElement', {
          selector: params.selector,
          timeout: params.timeout,
        });
      },
    },
  ];
  
  return skills;
}

// ============================================================================
// DEFAULT REGISTRY
// ============================================================================

export function createDefaultRegistry(config: PrimitiveSkillsConfig): SkillRegistry {
  const registry = new SkillRegistry();
  
  const primitiveSkills = createPrimitiveSkills(config);
  primitiveSkills.forEach(skill => registry.register(skill));
  
  return registry;
}
