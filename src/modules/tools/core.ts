import type { ToolDefinition } from '../../domain.js';

export interface ToolContext {
  requestId: string;
  agentId: string;
  signal?: AbortSignal;
}

export interface ToolHandler<TInput = Record<string, unknown>, TOutput = unknown> {
  definition: ToolDefinition;
  execute(input: TInput, context: ToolContext): Promise<TOutput> | TOutput;
}

export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();
  register<TInput = Record<string, unknown>, TOutput = unknown>(handler: ToolHandler<TInput, TOutput>): this {
    const name = handler.definition.name.trim();
    if (!name) throw new Error('Tool name is required');
    if (this.handlers.has(name)) throw new Error(`Tool ${name} is already registered`);
    this.handlers.set(name, handler as ToolHandler);
    return this;
  }
  has(name: string): boolean { return this.handlers.has(name); }
  get(name: string): ToolHandler | undefined { return this.handlers.get(name); }
  definitions(names?: string[]): ToolDefinition[] {
    return (names ?? [...this.handlers.keys()]).map((name) => {
      const handler = this.handlers.get(name);
      if (!handler) throw new Error(`Tool ${name} is not registered`);
      return handler.definition;
    });
  }
  async execute(name: string, input: Record<string, unknown>, context: ToolContext): Promise<unknown> {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`Tool ${name} is not registered`);
    if (context.signal?.aborted) throw new Error('Tool execution aborted');
    return handler.execute(input, context);
  }
}

export function createTool<TInput extends Record<string, unknown>, TOutput>(definition: ToolDefinition, execute: (input: TInput, context: ToolContext) => Promise<TOutput> | TOutput): ToolHandler<TInput, TOutput> {
  return { definition, execute };
}
