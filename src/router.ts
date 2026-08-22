import type { AccountConfig, AccountState, Capability, ModelInfo, ProviderAdapter, RoutingCandidate, RoutingStrategy, TaskType } from './domain.js';

export interface RoutingRequest {
  task?: TaskType;
  capabilities?: Capability[];
  model?: string;
}

export interface RouterOptions {
  strategy?: RoutingStrategy;
  clock?: () => number;
}

export class ModelRouter {
  private readonly strategy: RoutingStrategy;
  private readonly clock: () => number;
  private roundRobinCursor = 0;

  constructor(options: RouterOptions = {}) {
    this.strategy = options.strategy ?? 'priority';
    this.clock = options.clock ?? Date.now;
  }

  select(candidates: RoutingCandidate[], request: RoutingRequest = {}): RoutingCandidate {
    const ranked = this.rank(candidates, request);
    if (!ranked.length) throw new Error('No eligible routing candidate');
    return ranked[0];
  }

  rank(candidates: RoutingCandidate[], request: RoutingRequest = {}): RoutingCandidate[] {
    const eligible = candidates.filter((candidate) => this.isEligible(candidate, request));
    if (this.strategy === 'round_robin') {
      if (!eligible.length) return [];
      const offset = this.roundRobinCursor++ % eligible.length;
      const rotated = [...eligible.slice(offset), ...eligible.slice(0, offset)];
      return rotated.map((candidate, index) => ({ ...candidate, score: -index }));
    }
    return eligible
      .map((candidate) => ({ ...candidate, score: this.score(candidate) }))
      .sort((a, b) => b.score - a.score);
  }

  private isEligible(candidate: RoutingCandidate, request: RoutingRequest): boolean {
    const { account, state, model } = candidate;
    if (account.enabled === false || state.health === 'disabled' || state.health === 'authentication_failure') return false;
    if (state.cooldownUntil && state.cooldownUntil > this.clock()) return false;
    if (model.available === false) return false;
    if (request.model && model.id !== request.model) return false;
    const required = request.capabilities ?? this.capabilitiesForTask(request.task);
    return required.every((capability) => model.capabilities.includes(capability) && account.capabilities.includes(capability));
  }

  private capabilitiesForTask(task?: TaskType): Capability[] {
    switch (task) {
      case 'vision': return ['vision'];
      case 'structured_output': return ['structured_output'];
      default: return ['chat'];
    }
  }

  private score(candidate: RoutingCandidate): number {
    const { account, state, model } = candidate;
    const priority = account.priority ?? 0;
    const failures = state.failures * 25;
    const rpm = account.limits?.rpm;
    const tpm = account.limits?.tpm;
    const requestUtil = rpm ? Math.min(1, state.requests / rpm) : 0;
    const tokenUtil = tpm ? Math.min(1, state.tokens / tpm) : 0;
    const utilizationPenalty = (requestUtil * 0.4 + tokenUtil * 0.6) * 100;
    const latency = Number(state.metadata?.latencyMs ?? Number.MAX_SAFE_INTEGER);
    const inputCost = model.inputCostPerMillion ?? account.costPerMillionInput ?? 0;
    const outputCost = model.outputCostPerMillion ?? account.costPerMillionOutput ?? 0;
    switch (this.strategy) {
      case 'cheapest': return -(inputCost + outputCost) + priority / 100;
      case 'lowest_utilization': return priority - utilizationPenalty - failures;
      case 'fastest': return priority - latency - failures;
      case 'least_recently_used': return priority - (state.lastUsedAt ?? 0) / 1_000_000 - failures;
      default: return priority - failures;
    }
  }
}

export function createRoutingCandidates(
  accounts: AccountConfig[],
  states: Map<string, AccountState>,
  adapters: Map<string, ProviderAdapter>,
  models: Map<string, ModelInfo[]>,
): RoutingCandidate[] {
  const result: RoutingCandidate[] = [];
  for (const account of accounts) {
    const adapter = adapters.get(account.provider);
    const state = states.get(account.id);
    if (!adapter || !state) continue;
    for (const model of models.get(account.id) ?? []) result.push({ account, state, adapter, model, score: 0 });
  }
  return result;
}
