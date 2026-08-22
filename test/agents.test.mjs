import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolRegistry, createTool, AgentRegistry, createStockAgents, parseStructuredOutput } from '../dist/index.js';

test('tool registry registers, exposes and executes tools', async () => {
  const tools = new ToolRegistry();
  tools.register(createTool({ name: 'echo', description: 'Echo input', inputSchema: { type: 'object' } }, async (input) => ({ ok: true, input })));
  assert.equal(tools.has('echo'), true);
  assert.deepEqual(tools.definitions(), [{ name: 'echo', description: 'Echo input', inputSchema: { type: 'object' } }]);
  assert.deepEqual(await tools.execute('echo', { symbol: 'NIFTY' }, { requestId: 'r1', agentId: 'technical' }), { ok: true, input: { symbol: 'NIFTY' } });
});

test('agent registry rejects unknown tools', () => {
  const tools = new ToolRegistry();
  const agents = new AgentRegistry({ tools });
  assert.throws(() => agents.register({ id: 'bad', role: 'technical', task: 'reasoning', systemPrompt: 'x', toolNames: ['missing'] }), /unknown tool/);
});

test('stock agent factory creates the expected specialist and decision agents', () => {
  const tools = new ToolRegistry();
  for (const name of ['market_price', 'technical_indicators', 'fundamentals', 'market_news', 'sector_strength', 'risk_metrics']) {
    tools.register(createTool({ name, inputSchema: { type: 'object' } }, async () => ({})));
  }
  const agents = createStockAgents(tools);
  assert.deepEqual(agents.list().map((agent) => agent.id), ['technical', 'fundamental', 'news', 'sector', 'risk', 'recommendation', 'critic', 'final-decision']);
});

test('structured output parser accepts JSON and fenced JSON', () => {
  assert.deepEqual(parseStructuredOutput('{"recommendation":"BUY"}'), { recommendation: 'BUY' });
  assert.deepEqual(parseStructuredOutput('```json\n{"confidence":0.8}\n```'), { confidence: 0.8 });
  assert.equal(parseStructuredOutput('not json'), undefined);
});
