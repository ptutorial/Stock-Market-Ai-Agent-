import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentRuntime,
  AgentRegistry,
  ToolRegistry,
  createTool,
  createStockAgents,
  RecommendationEngine,
} from '../dist/index.js';

function createTestRuntime() {
  const tools = new ToolRegistry();
  for (const name of [
    'market_price',
    'technical_indicators',
    'fundamentals',
    'market_news',
    'sector_strength',
    'risk_metrics',
  ]) {
    tools.register(createTool({ name, inputSchema: { type: 'object' } }, async () => ({
      data: { ok: true },
      metadata: {
        source: 'local_db',
        freshness: 'fresh',
        observedAt: '2026-08-23T09:30:00Z',
        fetchedAt: '2026-08-23T09:30:01Z',
        fallback: false,
      },
    })));
  }

  const agents = createStockAgents(tools);
  const calls = [];
  const outputs = new Map([
    ['recommendation', 'Draft: BUY based on supplied evidence.'],
    ['critic', 'Critique: evidence is consistent; monitor downside risk.'],
  ]);

  const gateway = {
    async generate(_task, prompt) {
      const role = prompt.includes('Analyze price trend') ? 'technical'
        : prompt.includes('Analyze financial quality') ? 'fundamental'
        : prompt.includes('Analyze supplied recent news') ? 'news'
        : prompt.includes('Analyze sector-relative') ? 'sector'
        : prompt.includes('Assess downside risk') ? 'risk'
        : prompt.includes('Challenge the draft') ? 'critic'
        : prompt.includes('Synthesize agent evidence') ? 'recommendation'
        : 'final-decision';

      calls.push({ role, prompt });
      const toolByRole = {
        technical: 'market_price',
        fundamental: 'fundamentals',
        news: 'market_news',
        sector: 'sector_strength',
        risk: 'risk_metrics',
      };
      if (toolByRole[role]) {
        return {
          model: 'test-model',
          text: `${role} conclusion`,
          toolCalls: [{ id: `${role}-1`, name: toolByRole[role], arguments: { symbol: 'RELIANCE' } }],
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      }
      if (outputs.has(role)) {
        return {
          model: 'test-model',
          text: outputs.get(role),
          toolCalls: [],
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        };
      }
      return {
        model: 'test-model',
        text: JSON.stringify({
          recommendation: 'BUY',
          confidence: 0.82,
          scores: { technical: 0.8, fundamental: 0.85, news: 0.7, sector: 0.75, risk: 0.72 },
          evidence: ['Technical and fundamental evidence support the decision.'],
          risks: ['Market regime can invalidate the setup.'],
          invalidationConditions: ['Material deterioration in fundamentals or trend.'],
        }),
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      };
    },
  };

  return { tools, agents, runtime: new AgentRuntime({ gateway, tools }), calls };
}

test('end-to-end recommendation runs all specialists and final decision', async () => {
  const { agents, runtime, calls } = createTestRuntime();
  const engine = new RecommendationEngine({ agents, runtime });

  const result = await engine.recommend({
    symbol: 'RELIANCE',
    exchange: 'NSE',
    horizon: '1-3_months',
    data: { objective: 'investment recommendation' },
  });

  assert.equal(result.symbol, 'RELIANCE');
  assert.equal(result.exchange, 'NSE');
  assert.equal(result.recommendation, 'BUY');
  assert.equal(result.confidence, 0.82);
  assert.equal(result.sourceProvenance.length, 5);
  assert.deepEqual(
    result.sourceProvenance.map((item) => item.role),
    ['technical', 'fundamental', 'news', 'sector', 'risk'],
  );
  assert.ok(result.sourceProvenance.every((item) => item.source === 'local_db'));
  assert.ok(result.requestId);
  assert.equal(result.draft.startsWith('Draft:'), true);
  assert.equal(result.critique.startsWith('Critique:'), true);
  assert.deepEqual(Object.keys(result.agentConclusions).sort(), [
    'fundamental', 'news', 'risk', 'sector', 'technical',
  ]);
  assert.deepEqual(calls.map((item) => item.role), [
    'technical', 'fundamental', 'news', 'sector', 'risk',
    'recommendation', 'critic', 'final-decision',
  ]);
});

test('recommendation pipeline preserves a single request context', async () => {
  const { agents, runtime, calls } = createTestRuntime();
  const engine = new RecommendationEngine({ agents, runtime });
  const result = await engine.recommend({ symbol: 'TCS', exchange: 'NSE' });

  assert.ok(result.requestId);
  for (const call of calls) {
    assert.match(call.prompt, /SYMBOL: TCS/);
    assert.match(call.prompt, /EXCHANGE: NSE/);
  }
});

test('invalid final recommendation fails closed', async () => {
  const { tools, agents } = createTestRuntime();
  const gateway = {
    async generate(_task, prompt) {
      const isSpecialist = /Analyze price trend|Analyze financial quality|Analyze supplied recent news|Analyze sector-relative|Assess downside risk/.test(prompt);
      if (isSpecialist) {
        const name = prompt.includes('price trend') ? 'market_price'
          : prompt.includes('financial quality') ? 'fundamentals'
          : prompt.includes('recent news') ? 'market_news'
          : prompt.includes('sector-relative') ? 'sector_strength'
          : 'risk_metrics';
        return { model: 'test', text: 'ok', toolCalls: [{ name, arguments: { symbol: 'TCS' } }], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      }
      if (prompt.includes('Challenge the draft') || prompt.includes('Synthesize agent evidence')) {
        return { model: 'test', text: 'ok', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
      }
      return { model: 'test', text: JSON.stringify({ recommendation: 'MAYBE', confidence: 2 }), toolCalls: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    },
  };
  const runtime = new AgentRuntime({ gateway, tools });
  const engine = new RecommendationEngine({ agents, runtime });

  await assert.rejects(() => engine.recommend({ symbol: 'TCS' }), /recommendation|confidence|BUY|HOLD|AVOID/i);
});
