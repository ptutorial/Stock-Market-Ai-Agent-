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
    const eligible = candidates.filter((candidate) => this.isEligible(candidate, request));
    if (eligible.length === 0) throw new Error('No eligible routing candidate');

    const ranked = eligible.map((candidate) => ({ ...candidate, score: this.score(candidate) }));
    if (this.strategy === 'round_robin') return ranked[this.roundRobinCursor++ % ranked.length];
    return ranked.sort((a, b) => b.score - a.score)[0];
  }

  rank(candidates: RoutingCandidate[], request: RoutingRequest = {}): RoutingCandidate[] {
    const eligible = candidates.filter((candidate) => this.isEligible(candidate, request));
    return eligible.map((candidate) => ({ ...candidate, score: this.score(candidate) }))
      .sort((a, b) => b.score - a.score);
  }

  private isEligible(candidate: RoutingCandidate, request: RoutingRequest): boolean {
    const { account, state, model } = candidate;
    if (account.enabled === false || state.health === 'disabled') return false;
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
    const utilizationPenalty = state.requests > 0 ? Math.min(state.requests, 1000) / 10 : 0;
    const latency = typeof candidate.score === 'number' ? candidate.score : 0;
    if (this.strategy === 'cheapest') return -(model.inputCostPerMillion ?? account.costPerMillionInput ?? 0) - (model.outputCostPerMillion ?? account.costPerMillionOutput ?? 0) + priority / 100;
    if (this.strategy === 'lowest_utilization') return priority - utilizationPenalty - failures;
    if (this.strategy === 'fastest') return priority - latency - failures;
    if (this.strategy === 'least_recently_used') return priority + (state.lastUsedAt ? -(state.lastUsedAt / 1_000_000_000) : 0) - failures;
    return priority - failures - utilizationPenalty;
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
