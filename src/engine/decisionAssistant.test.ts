import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssistantWorkspaceContext,
  classifyDecisionIntent,
  DECISION_STARTER_PROMPTS,
  runDeterministicDecisionQuery,
} from './decisionAssistant.ts';
import { FactoryStore, StorageBackend } from '../store/store.ts';

function memBackend(): StorageBackend {
  const map: Record<string, string> = {};
  return {
    persistent: false,
    get: (k) => (k in map ? map[k] : null),
    set: (k, v) => {
      map[k] = v;
    },
    del: (k) => {
      delete map[k];
    },
  };
}

function makeTestContext(focusedSku?: string | null) {
  const store = new FactoryStore(memBackend());
  const ctx = buildAssistantWorkspaceContext({
    products: store.products(),
    transactions: store.transactions(),
    settings: store.settings(),
    summary: store.summary(),
    metricsOf: (p) => store.metrics(p),
    lineBalance: store.getLineBalance(),
    factorySimConfig: store.getFactorySimConfig(),
    focusedSku,
  });
  return { store, ctx };
}

test('classifies all 7 canonical decision questions into exact intents', () => {
  assert.equal(classifyDecisionIntent('Why is this SKU considered high risk?'), 'sku_risk');
  assert.equal(classifyDecisionIntent('Which materials are likely to cause production delays?'), 'material_delay');
  assert.equal(
    classifyDecisionIntent('How can I reduce inventory investment without sacrificing service level?'),
    'reduce_inventory'
  );
  assert.equal(classifyDecisionIntent('Which workstation is the production bottleneck?'), 'bottleneck');
  assert.equal(
    classifyDecisionIntent('What would happen if supplier lead time increased by 20%?'),
    'what_if_scenario'
  );
  assert.equal(classifyDecisionIntent('Compare alternative inventory policies.'), 'compare_policies');
  assert.equal(classifyDecisionIntent('Explain the results of my latest production simulation.'), 'explain_simulation');
});

test('starter prompts cover all 7 required operational questions', () => {
  assert.equal(DECISION_STARTER_PROMPTS.length, 7);
  const { ctx } = makeTestContext('NUT-M8');
  for (const starter of DECISION_STARTER_PROMPTS) {
    const res = runDeterministicDecisionQuery(starter.question, ctx);
    assert.equal(res.intent, starter.intent);
    assert.ok(res.headline.length > 10);
    assert.ok(res.facts.length >= 3, `${starter.id} should cite >=3 authoritative facts`);
    assert.ok(res.navLinks.length >= 2, `${starter.id} should include supporting module links`);
    assert.equal(res.insufficientDataWarnings.length, 0);
  }
});

test('high-risk SKU diagnosis targets NUT-M8 / explicit SKU with exact ROP & BOM exposure', () => {
  const { ctx } = makeTestContext();
  const res = runDeterministicDecisionQuery('Why is SKU NUT-M8 considered high risk?', ctx);
  assert.equal(res.intent, 'sku_risk');
  assert.equal(res.focusedSku, 'NUT-M8');
  assert.ok(res.facts.some((f) => f.label === 'On-Hand Stock' && f.value === '600'));
  assert.ok(res.tables.length === 1 && res.tables[0].rows.length >= 3, 'NUT-M8 feeds multiple parent assemblies');
  assert.ok(
    res.proposedActions.some((a) => a.kind === 'receive-stock' && a.requiresApproval === true),
    'should propose approval-gated stock replenishment'
  );
  assert.ok(res.provenanceBadges.includes('DETERMINISTIC_ENGINE'));
});

test('what-if supplier lead time +20% executes non-mutating counterfactual simulation', () => {
  const { store, ctx } = makeTestContext();
  const beforeProductsSnapshot = JSON.stringify(store.products());
  const beforeSimSnapshot = JSON.stringify(store.getFactorySimConfig());

  const res = runDeterministicDecisionQuery(
    'What would happen if supplier lead time increased by 20%?',
    ctx
  );
  assert.equal(res.intent, 'what_if_scenario');
  assert.ok(res.proposedScenario !== null, 'should compute before-vs-after ScenarioEvaluation');
  assert.ok(
    Math.abs((res.proposedScenario?.definition.params.supplierLeadTimeMult ?? 1) - 1.2) < 1e-3,
    'lead-time multiplier must be exactly 1.20'
  );
  assert.ok((res.proposedScenario?.deltas.length ?? 0) >= 8);
  assert.ok(
    res.proposedActions.every((a) => a.requiresApproval === true),
    'proposed scenario save/apply must require explicit user approval'
  );

  // Strict non-mutation check
  assert.equal(JSON.stringify(store.products()), beforeProductsSnapshot);
  assert.equal(JSON.stringify(store.getFactorySimConfig()), beforeSimSnapshot);
});

test('compare policies runs all 4 policies cleanly with tabular matrix', () => {
  const { ctx } = makeTestContext();
  const res = runDeterministicDecisionQuery('Compare alternative inventory policies.', ctx);
  assert.equal(res.intent, 'compare_policies');
  assert.equal(res.tables.length, 1);
  assert.equal(res.tables[0].rows.length, 4, 'must evaluate EOQ-ROP, Service-Target, POQ, and L4L');
  assert.ok(res.provenanceBadges.includes('SCENARIO_SIMULATION_MODEL'));
});

test('bottleneck & explain_simulation decompose DES OEE and match DES station bottleneck', () => {
  const { ctx } = makeTestContext();
  const bnRes = runDeterministicDecisionQuery('Which workstation is the production bottleneck?', ctx);
  assert.equal(bnRes.intent, 'bottleneck');
  assert.ok(bnRes.headline.includes(ctx.desResult.bottleneckName));
  assert.ok(bnRes.tables[0].rows.length === ctx.desResult.stations.length);

  const simRes = runDeterministicDecisionQuery('Explain the results of my latest production simulation.', ctx);
  assert.equal(simRes.intent, 'explain_simulation');
  assert.ok(
    simRes.facts.some((f) => f.label === 'OEE (A × P × Q)' && f.value.includes('%')),
    'should include decomposed OEE'
  );
  assert.ok(
    simRes.facts.some((f) => f.label === "Little's Law Verification"),
    'should include Little Law verification'
  );
});

test('insufficient data & unknown SKU cases refuse to invent numbers', () => {
  const { store, ctx } = makeTestContext();
  const unknownRes = runDeterministicDecisionQuery('Why is SKU ZZZ-999 considered high risk?', ctx);
  assert.equal(unknownRes.insufficientDataWarnings.length, 1);
  assert.ok(unknownRes.headline.includes('ZZZ-999'));
  assert.equal(unknownRes.proposedActions.length, 0);

  store.clearAll();
  const emptyCtx = buildAssistantWorkspaceContext({
    products: store.products(),
    transactions: store.transactions(),
    settings: store.settings(),
    summary: store.summary(),
    metricsOf: (p) => store.metrics(p),
    lineBalance: store.getLineBalance(),
    factorySimConfig: store.getFactorySimConfig(),
  });
  const emptyRes = runDeterministicDecisionQuery('Which materials are likely to cause production delays?', emptyCtx);
  assert.equal(emptyRes.insufficientDataWarnings.length, 1);
  assert.ok(emptyRes.headline.toLowerCase().includes('insufficient'));
  assert.equal(emptyRes.proposedScenario, null);
});

test('groundingDossier sanitizes authoritative facts without exposing raw functions or secrets', () => {
  const { ctx } = makeTestContext();
  const res = runDeterministicDecisionQuery(
    'How can I reduce inventory investment without sacrificing service level?',
    ctx
  );
  assert.equal(res.intent, 'reduce_inventory');
  assert.ok(res.groundingDossier.provenancePolicy.includes('STRICT_FACT_GROUNDING'));
  assert.equal(res.groundingDossier.facts.length, res.facts.length);
  const serialized = JSON.stringify(res.groundingDossier);
  assert.equal(serialized.includes('GEMINI_API_KEY'), false);
});
