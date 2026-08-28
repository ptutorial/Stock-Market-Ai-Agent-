import type { TaskType, ToolCall } from '../../domain.js';
import type { GenerateOptions } from '../../domain.js';
import type { AgentModelPolicy, AgentLLMGateway, AgentLLMRequest, AgentLLMResponse } from '../llm/agent/index.js';
import { MultiProviderAgentLLM, DEFAULT_AGENT_MODEL_POLICIES } from '../llm/agent/index.js';
import { ToolRegistry } from '../tools/registry.js';

// Simple adapter that wraps any gateway with a generate(task, prompt, options) method
interface SimpleGateway {
  generate(task: TaskType, prompt: string, options?: GenerateOptions & { provider?: string; model?: string; requestId?: string }): Promise<{ text: string; provider: string; model: string; toolCalls?: ToolCall[] }>;
}

class SimpleGatewayAgentAdapter implements AgentLLMGateway {
  constructor(private readonly gateway: SimpleGateway) {}
  async generate(request: AgentLLMRequest): Promise<AgentLLMResponse> {
    const input = typeof request.input === 'string' ? request.input : JSON.stringify(request.input);
    const provider = request.provider ?? request.policy.primary.provider;
    const model = request.model ?? request.policy.primary.model;
    console.log('[PlannerAdapter] Calling gateway.generate with provider:', provider, 'model:', model, 'capabilities:', request.capabilities);
    const result = await this.gateway.generate(request.task, `SYSTEM: ${request.systemPrompt}\nUSER: ${input}`,
      { provider, model, task: request.task, capabilities: request.capabilities, tools: request.tools as any, maxTokens: request.maxOutputTokens ?? request.policy.maxOutputTokens, requestId: request.requestId });
    return { output: result.text, provider: result.provider as any, model: result.model, toolCalls: result.toolCalls };
  }
}

// ── Intent Classification ─────────────────────────────────────────────

export type MarketIntent =
  | 'market_overview'       // General market outlook, indices, breadth
  | 'stock_analysis'        // Specific stock deep-dive
  | 'sector_analysis'       // Sector relative strength
  | 'news_summary'          // News-driven analysis
  | 'risk_assessment'       // Risk metrics, volatility, drawdown
  | 'recommendation'        // Buy/Hold/Avoid decision
  | 'general_question';     // Anything else

export interface ClassifiedIntent {
  intent: MarketIntent;
  symbol?: string;
  exchange?: string;
  horizon?: string;
  reasoning: string;
}

// ── Planner Response ──────────────────────────────────────────────────

export interface PlannerPlan {
  intent: MarketIntent;
  symbol?: string;
  exchange?: string;
  horizon?: string;
  toolCalls: Array<{ tool: string; input: Record<string, unknown> }>;
  reasoning: string;
}

export interface PlannerResult {
  intent: MarketIntent;
  answer: string;
  toolCalls: ToolCall[];
  toolResults: Array<{ tool: string; input: Record<string, unknown>; output: unknown }>;
  symbol?: string;
  requestId: string;
}

// ── Intent Classifier (LLM-based) ────────────────────────────────────

const CLASSIFIER_SYSTEM_PROMPT = `You are a market intent classifier. Given a user prompt, classify it into one of these intents and extract any stock symbol mentioned.

Intents:
- market_overview: General market outlook, indices summary, market breadth, today's market summary
- stock_analysis: Specific stock deep-dive, price analysis, technical/fundamental for a named stock
- sector_analysis: Sector comparison, relative strength between sectors
- news_summary: News-driven analysis, recent events affecting markets or stocks
- risk_assessment: Risk metrics, volatility analysis, drawdown, stop-loss levels
- recommendation: Explicit buy/hold/sell decision request for a stock
- general_question: Anything else (educational, definitions, methodology, etc.)

Respond with JSON only:
{
  "intent": "<intent_name>",
  "symbol": "<stock ticker if mentioned, else null>",
  "exchange": "<exchange if mentioned, else null>",
  "horizon": "<investment horizon if mentioned, else null>",
  "reasoning": "<brief explanation of classification>"
}`;

function parseClassifierOutput(text: string): ClassifiedIntent {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return {
      intent: (parsed.intent as MarketIntent) ?? 'general_question',
      symbol: (parsed.symbol as string) ?? undefined,
      exchange: (parsed.exchange as string) ?? undefined,
      horizon: (parsed.horizon as string) ?? undefined,
      reasoning: (parsed.reasoning as string) ?? 'Classified by LLM',
    };
  } catch {
    // Fallback: try to extract symbol from prompt text
    return { intent: 'general_question', reasoning: 'Classifier output unparseable, defaulting to general_question' };
  }
}

// ── Tool Route Planner (LLM-based) ───────────────────────────────────

const PLANNER_SYSTEM_PROMPT = `You are a market data planning agent. Given a classified intent and available tools, decide which tools to call and in what order.

Available tools:
- market_price: Get latest quote for a symbol (input: {symbol, exchange?})
- market_history: Get OHLCV bars (input: {symbol, timeframe?, limit?, exchange?})
- technical_indicators: Get technical indicators (input: {symbol, timeframe?, exchange?})
- fundamentals: Get fundamental data (input: {symbol, exchange?})
- market_news: Get recent news (input: {symbol, limit?})
- sector_strength: Get sector relative strength (input: {symbol, exchange?})
- risk_metrics: Get risk metrics (input: {symbol, exchange?})
- stock_snapshot: Build full evidence snapshot (input: {symbol, exchange?, timeframe?, historyLimit?, newsLimit?})

Planning rules:
- market_overview: Call market_news with limit 15. No symbol needed for general overview.
- stock_analysis: Call stock_snapshot with the symbol. If no symbol provided, ask user.
- sector_analysis: Call sector_strength and market_price for the symbol.
- news_summary: Call market_news with limit 15.
- risk_assessment: Call risk_metrics and technical_indicators.
- recommendation: Call stock_snapshot (covers all data needed).
- general_question: No tools needed, answer directly.

Respond with JSON only:
{
  "toolCalls": [
    { "tool": "<tool_name>", "input": { ... } }
  ],
  "reasoning": "<brief plan explanation>"
}`;

function parsePlannerOutput(text: string, intent: MarketIntent, symbol?: string, exchange?: string): PlannerPlan {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const toolCalls = Array.isArray(parsed.toolCalls)
      ? (parsed.toolCalls as Array<{ tool: string; input: Record<string, unknown> }>)
      : [];
    return {
      intent,
      symbol,
      exchange,
      toolCalls: toolCalls.map((tc) => ({
        tool: tc.tool,
        input: { ...tc.input, symbol: tc.input.symbol ?? symbol, exchange: tc.input.exchange ?? exchange },
      })),
      reasoning: (parsed.reasoning as string) ?? 'Planned by LLM',
    };
  } catch {
    // Fallback plan based on intent
    return getDefaultPlan(intent, symbol, exchange);
  }
}

function getDefaultPlan(intent: MarketIntent, symbol?: string, exchange?: string): PlannerPlan {
  const base = { intent, symbol, exchange, reasoning: 'Using default plan (classifier parse failed)' };
  switch (intent) {
    case 'market_overview':
      return { ...base, toolCalls: [{ tool: 'market_news', input: { limit: 15 } }] };
    case 'stock_analysis':
      return symbol
        ? { ...base, toolCalls: [{ tool: 'stock_snapshot', input: { symbol, exchange: exchange ?? 'NSE' } }] }
        : { ...base, toolCalls: [{ tool: 'market_news', input: { limit: 10 } }] };
    case 'sector_analysis':
      return symbol
        ? { ...base, toolCalls: [{ tool: 'sector_strength', input: { symbol, exchange } }, { tool: 'market_price', input: { symbol, exchange } }] }
        : { ...base, toolCalls: [{ tool: 'market_news', input: { limit: 10 } }] };
    case 'news_summary':
      return { ...base, toolCalls: [{ tool: 'market_news', input: { limit: 15 } }] };
    case 'risk_assessment':
      return symbol
        ? { ...base, toolCalls: [{ tool: 'risk_metrics', input: { symbol, exchange } }, { tool: 'technical_indicators', input: { symbol, exchange } }] }
        : { ...base, toolCalls: [] };
    case 'recommendation':
      return symbol
        ? { ...base, toolCalls: [{ tool: 'stock_snapshot', input: { symbol, exchange: exchange ?? 'NSE' } }] }
        : { ...base, toolCalls: [] };
    default:
      return { ...base, toolCalls: [] };
  }
}

// ── Synthesizer (LLM-based) ──────────────────────────────────────────

function buildSynthesizerPrompt(intent: MarketIntent, originalPrompt: string, toolResults: Array<{ tool: string; output: unknown }>): string {
  const dataSummary = toolResults.map((r) => `[${r.tool}]: ${JSON.stringify(r.output)}`).join('\n\n');
  return `You are a market analyst. The user asked: "${originalPrompt}"

The intent was classified as: ${intent}

Data collected:
${dataSummary || '(no data collected)'}

Provide a clear, concise, and helpful response to the user's question. Use the data above. If no data was collected, explain what information would be needed. Do not fabricate market data.`;
}

// ── MarketPlannerEngine ───────────────────────────────────────────────

export interface MarketPlannerEngineOptions {
  tools: ToolRegistry;
  gateway: SimpleGateway;
  policies?: Partial<Record<string, AgentModelPolicy>>;
}

export class MarketPlannerEngine {
  private readonly tools: ToolRegistry;
  private readonly llm: MultiProviderAgentLLM;
  private readonly plannerPolicy: AgentModelPolicy;

  constructor(private readonly options: MarketPlannerEngineOptions) {
    this.tools = options.tools;
    this.llm = new MultiProviderAgentLLM(new SimpleGatewayAgentAdapter(options.gateway));
    this.plannerPolicy = options.policies?.planner ?? DEFAULT_AGENT_MODEL_POLICIES.planner;
  }

  async chat(prompt: string, requestId?: string): Promise<PlannerResult> {
    const rid = requestId ?? crypto.randomUUID();
    console.log(`[Planner] Processing: "${prompt.slice(0, 80)}" (requestId: ${rid})`);

    // Step 1: Classify intent
    const classified = await this.classifyIntent(prompt, rid);
    console.log(`[Planner] Intent: ${classified.intent}, symbol: ${classified.symbol ?? 'none'}`);

    // Step 2: Plan tool calls
    const plan = await this.planTools(prompt, classified, rid);

    // Step 3: Execute tools
    const toolResults: PlannerResult['toolResults'] = [];
    const allToolCalls: ToolCall[] = [];
    for (const tc of plan.toolCalls) {
      if (!this.tools.has(tc.tool)) continue;
      try {
        const output = await this.tools.execute(tc.tool, tc.input, { requestId: rid, agentId: 'planner' });
        toolResults.push({ tool: tc.tool, input: tc.input, output });
        allToolCalls.push({ name: tc.tool, arguments: tc.input });
      } catch (error) {
        toolResults.push({ tool: tc.tool, input: tc.input, output: { error: error instanceof Error ? error.message : String(error) } });
      }
    }

    // Step 4: Synthesize answer
    const answer = await this.synthesize(prompt, classified.intent, toolResults, rid);

    return {
      intent: classified.intent,
      answer,
      toolCalls: allToolCalls,
      toolResults,
      symbol: classified.symbol,
      requestId: rid,
    };
  }

  private async classifyIntent(prompt: string, requestId: string): Promise<ClassifiedIntent> {
    try {
      const response = await this.llm.generate({
        requestId,
        agentId: 'planner-classifier',
        role: 'planner',
        task: 'general',
        systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
        input: prompt,
        policy: this.plannerPolicy,
        capabilities: ['chat'],
      });
      console.log('[Planner] Classifier output:', response.output?.slice(0, 200));
      return parseClassifierOutput(response.output);
    } catch (error) {
      console.error('[Planner] Classifier failed:', error instanceof Error ? error.message : String(error));
      return { intent: 'general_question', reasoning: 'Classifier failed, defaulting to general_question' };
    }
  }

  private async planTools(prompt: string, classified: ClassifiedIntent, requestId: string): Promise<PlannerPlan> {
    // If general question with no symbol, skip tool planning
    if (classified.intent === 'general_question' && !classified.symbol) {
      return { intent: classified.intent, symbol: classified.symbol, exchange: classified.exchange, toolCalls: [], reasoning: 'General question, no tools needed' };
    }

    try {
      const plannerInput = `Intent: ${classified.intent}\nSymbol: ${classified.symbol ?? 'none'}\nExchange: ${classified.exchange ?? 'none'}\nHorizon: ${classified.horizon ?? 'none'}\nUser prompt: ${prompt}`;
      const response = await this.llm.generate({
        requestId,
        agentId: 'planner-planner',
        role: 'planner',
        task: 'general',
        systemPrompt: PLANNER_SYSTEM_PROMPT,
        input: plannerInput,
        policy: this.plannerPolicy,
        capabilities: ['chat'],
      });
      return parsePlannerOutput(response.output, classified.intent, classified.symbol, classified.exchange);
    } catch {
      return getDefaultPlan(classified.intent, classified.symbol, classified.exchange);
    }
  }

  private async synthesize(prompt: string, intent: MarketIntent, toolResults: Array<{ tool: string; output: unknown }>, requestId: string): Promise<string> {
    try {
      const synthPrompt = buildSynthesizerPrompt(intent, prompt, toolResults);
      const response = await this.llm.generate({
        requestId,
        agentId: 'planner-synthesizer',
        role: 'planner',
        task: 'general',
        systemPrompt: 'You are a helpful market analyst assistant. Respond clearly and concisely.',
        input: synthPrompt,
        policy: this.plannerPolicy,
        capabilities: ['chat'],
      });
      console.log('[Planner] Synthesizer output length:', response.output?.length);
      return response.output;
    } catch (error) {
      console.error('[Planner] Synthesizer failed:', error instanceof Error ? error.message : String(error));
      return `I encountered an error while generating the response: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}
