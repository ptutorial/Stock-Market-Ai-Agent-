import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntime, ToolRegistry, createTool, createStockAgents, MultiProviderAgentLLM, DEFAULT_AGENT_MODEL_POLICIES } from '../dist/index.js';

test('agent LLM policy uses the primary provider and preserves request correlation', async () => {
  const calls = [];
  const llm = new MultiProviderAgentLLM({
    async generate(request) {
      calls.push(request);
      return { output: '{"recommendation":"BUY","confidence":0.8}', provider: request.provider, model: request.model };
    },
  });
  const result = await llm.generate({
    requestId: 'req-1',
    agentId: 'technical',
    role: 'technical',
    task: 'reasoning',
    systemPrompt: 'Analyze the supplied evidence.',
    input: { symbol: 'NIFTY' },
    policy: DEFAULT_AGENT_MODEL_POLICIES.technical,
  });
  assert.equal(result.provider, 'gemini');
  assert.equal(calls[0].requestId, 'req-1');
  assert.equal(calls[0].provider, 'gemini');
});

test('agent LLM falls back to the next provider after a primary failure', async () => {
  const calls = [];
  const llm = new MultiProviderAgentLLM({
    async generate(request) {
      calls.push(request.provider);
      if (request.provider === 'gemini') throw new Error('primary unavailable');
      return { output: 'fallback', provider: request.provider, model: request.model };
    },
  });
  const result = await llm.generate({
    requestId: 'req-2',
    agentId: 'news',
    role: 'news',
    task: 'general',
    systemPrompt: 'Analyze news.',
    input: { symbol: 'RELIANCE' },
    policy: DEFAULT_AGENT_MODEL_POLICIES.news,
  });
  assert.equal(result.fallback, true);
  assert.deepEqual(calls, ['gemini', 'groq']);
});

test('agent runtime invokes configured LLM and executes only declared tools', async () => {
  const tools = new ToolRegistry();
  tools.register(createTool({ name: 'market_price', inputSchema: { type: 'object' } }, async () => ({ price: 100 })));
  tools.register(createTool({ name: 'technical_indicators', inputSchema: { type: 'object' } }, async () => ({ trend: 'up' })));
  const agents = createStockAgents(tools);
  const calls = [];
  const agentLLM = {
    async generate(request) {
      calls.push(request);
      if (calls.length === 1) return { output: 'need data', provider: 'gemini', model: 'gemini-2.5-flash', toolCalls: [{ name: 'market_price', arguments: { symbol: 'NIFTY' } }] };
      return { output: '{"recommendation":"BUY","confidence":0.9}', provider: 'gemini', model: 'gemini-2.5-flash' };
    },
  };
  const runtime = new AgentRuntime({ tools, agentLLM, maxRounds: 2 });
  const result = await runtime.run(agents.get('technical'), {
    requestId: 'req-3', symbol: 'NIFTY', input: {}, evidence: {},
  });
  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0].tool, 'market_price');
  assert.equal(calls[0].requestId, 'req-3');
  assert.deepEqual(result.structured, { recommendation: 'BUY', confidence: 0.9 });
});
