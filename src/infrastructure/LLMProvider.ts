/**
 * @fileoverview LLMProvider - Unified interface for multiple LLM providers
 */

import type {
  LLMConfig,
  LLMRequest,
  LLMResponse,
  OpenAIFunction,
  AnthropicTool,
  ToolCall,
} from '../types';

// ============================================================================
// ABSTRACT BASE CLASS
// ============================================================================

export abstract class LLMProvider {
  protected config: LLMConfig;
  
  constructor(config: LLMConfig) {
    this.config = config;
  }
  
  abstract complete(request: LLMRequest): Promise<LLMResponse>;
  
  abstract estimateTokens(text: string): number;
  
  getConfig(): LLMConfig {
    return { ...this.config };
  }
}

// ============================================================================
// OPENAI PROVIDER
// ============================================================================

export class OpenAIProvider extends LLMProvider {
  private client: OpenAIClient | null = null;
  
  constructor(config: Omit<LLMConfig, 'provider'>) {
    super({ ...config, provider: 'openai' });
  }
  
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const client = await this.getClient();
    
    const messages = request.messages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
      ...(m.name && { name: m.name }),
    }));
    
    const options: OpenAICompletionOptions = {
      model: this.config.model,
      messages,
      max_tokens: this.config.maxTokens ?? 4096,
      temperature: this.config.temperature ?? 0.7,
    };
    
    if (request.tools && request.tools.length > 0) {
      options.tools = (request.tools as OpenAIFunction[]).map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }
    
    if (request.responseFormat === 'json') {
      options.response_format = { type: 'json_object' };
    }
    
    const response = await client.chat.completions.create(options);
    
    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No response from OpenAI');
    }
    
    const toolCalls: ToolCall[] | undefined = choice.message.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));
    
    return {
      content: choice.message.content || '',
      ...(toolCalls && toolCalls.length > 0 && { toolCalls }),
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }
  
  estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token for English
    return Math.ceil(text.length / 4);
  }
  
  private async getClient(): Promise<OpenAIClient> {
    if (this.client) return this.client;
    
    // Dynamic import to avoid bundling if not used
    const { default: OpenAI } = await import('openai');

    const client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout ?? 60000,
    }) as unknown as OpenAIClient;

    this.client = client;
    return client;
  }
  
  private mapFinishReason(reason: string | null): LLMResponse['finishReason'] {
    switch (reason) {
      case 'stop': return 'stop';
      case 'tool_calls': return 'tool_calls';
      case 'length': return 'length';
      case 'content_filter': return 'content_filter';
      default: return 'stop';
    }
  }
}

// ============================================================================
// ANTHROPIC PROVIDER
// ============================================================================

export class AnthropicProvider extends LLMProvider {
  private client: AnthropicClient | null = null;
  
  constructor(config: Omit<LLMConfig, 'provider'>) {
    super({ ...config, provider: 'anthropic' });
  }
  
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const client = await this.getClient();
    
    // Extract system message
    const systemMessage = request.messages.find(m => m.role === 'system');
    const otherMessages = request.messages.filter(m => m.role !== 'system');
    
    const messages = otherMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    
    const options: AnthropicCompletionOptions = {
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 4096,
      messages,
    };
    
    if (systemMessage) {
      options.system = systemMessage.content;
    }
    
    if (request.tools && request.tools.length > 0) {
      options.tools = (request.tools as AnthropicTool[]).map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }
    
    const response = await client.messages.create(options);
    
    // Extract content
    let content = '';
    const toolCalls: ToolCall[] = [];
    
    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }
    
    return {
      content,
      ...(toolCalls.length > 0 && { toolCalls }),
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: this.mapStopReason(response.stop_reason),
    };
  }
  
  estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
  
  private async getClient(): Promise<AnthropicClient> {
    if (this.client) return this.client;
    
    const { default: Anthropic } = await import('@anthropic-ai/sdk');

    const client = new Anthropic({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout ?? 60000,
    }) as unknown as AnthropicClient;

    this.client = client;
    return client;
  }
  
  private mapStopReason(reason: string | null): LLMResponse['finishReason'] {
    switch (reason) {
      case 'end_turn': return 'stop';
      case 'tool_use': return 'tool_calls';
      case 'max_tokens': return 'length';
      default: return 'stop';
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
}

// ============================================================================
// TYPE DECLARATIONS (for dynamic imports)
// ============================================================================

type OpenAIClient = {
  chat: {
    completions: {
      create: (options: OpenAICompletionOptions) => Promise<OpenAICompletionResponse>;
    };
  };
};

interface OpenAICompletionOptions {
  model: string;
  messages: Array<{ role: string; content: string; name?: string }>;
  max_tokens?: number;
  temperature?: number;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: unknown;
    };
  }>;
  response_format?: { type: 'json_object' };
}

interface OpenAICompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

type AnthropicClient = {
  messages: {
    create: (options: AnthropicCompletionOptions) => Promise<AnthropicCompletionResponse>;
  };
};

interface AnthropicCompletionOptions {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: string }>;
  system?: string;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: unknown;
  }>;
}

interface AnthropicCompletionResponse {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
  >;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason: string | null;
}
