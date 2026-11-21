/**
 * FactoryMind Advisor & Executive Brief computation engine.
 * Audited pricing rules, health scoring, policy simulator, and board brief model.
 * Pure TypeScript, zero DOM dependencies.
 */

import { fmtCover, fmtInt, fmtMoney, fmtNum, num } from './formatters';
import { rop } from './ipe';
import { Product, ProductMetrics, Transaction, WorkspaceSettings, WorkspaceSummary } from '../store/store';

export interface AdvisorPolicyConfig {
  cover: number;
  band: [number, number];
  slowDays: number;
  minCash: number;
  minSaving: number;
  saved: boolean;
}

export const DEFAULT_ADVISOR_POLICY: AdvisorPolicyConfig = {
  cover: 2.5,
  band: [95, 98],
  slowDays: 90,
  minCash: 100,
  minSaving: 25,
  saved: false,
};

export interface AdvisorFinding {
  id: string;
  kind: 'cash' | 'stock' | 'policy' | 'data';
  severity: 'info' | 'warn' | 'bad';
  sku: string;
  product: Product;
  title: string;
  detail: string;
  money: number | null;
  moneyKind: 'parked' | 'order' | 'cost' | 'saving' | null;
  priority: number;
  impactLabel: string;
  action:
    | { type: 'open'; label: string }
    | { type: 'edit'; label: string }
    | { type: 'receive'; label: string; qty: number }
    | { type: 'set-sl'; label: string; value: number };
}

export interface AdvisorTotals {
  parkedCash: number;
  orderValue: number;
  annualSaving: number;
  problems: number;
  priced: number;
}

export interface AdvisorHealth {
  score: number;
  label: 'Healthy' | 'Watch' | 'At risk' | 'Critical';
  reasons: string[];
  parkedCash: number;
}

export interface ProductRow {
  p: Product;
  m: ProductMetrics;
}

export function advisorPolicyFromSettings(settings?: Partial<WorkspaceSettings> | null): AdvisorPolicyConfig {
  const s = settings || {};
  const cover = num(s.advCover);
  let lo = num(s.advSlLow, 0);
  let hi = num(s.advSlHigh, 0);
  if (!(hi > 0)) {
    hi = DEFAULT_ADVISOR_POLICY.band[1];
    lo = DEFAULT_ADVISOR_POLICY.band[0];
  }
  if (!(lo > 0)) lo = DEFAULT_ADVISOR_POLICY.band[0];
  if (hi < lo) {
    const t = lo;
    lo = hi;
    hi = t;
  }
  return {
    ...DEFAULT_ADVISOR_POLICY,
    cover: cover > 0 ? cover : DEFAULT_ADVISOR_POLICY.cover,
    band: [lo, hi],
    saved: num(s.advCover) > 0,
  };
}

function advisorHoldingPerUnit(p: Product): number {
  return (num(p.unitCost) * num(p.holdingRate)) / 100;
}

function advisorSafetyStockAt(p: Product, serviceLevel: number): number {
  const r = rop({
    annualDemand: num(p.annualDemand),
    leadTimeDays: num(p.leadTime),
    serviceLevel,
    history: Array.isArray(p.demandHistory) && p.demandHistory.length ? p.demandHistory : null,
  });
  return Number.isFinite(r.safetyStock) ? r.safetyStock : 0;
}

function advisorIdleDays(productId: string, txs: ReadonlyArray<Transaction>, nowTs: number): number | null {
  let last = 0;
  for (let i = 0; i < txs.length; i++) {
    if (txs[i].productId === productId && num(txs[i].ts) > last) {
      last = num(txs[i].ts);
    }
  }
  if (!last) return null;
  return Math.max(0, Math.floor((nowTs - last) / 86400000));
}

function moneyVal(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function advisorAnalyse(
  rows: ReadonlyArray<ProductRow>,
  txs: ReadonlyArray<Transaction>,
  policy: AdvisorPolicyConfig = DEFAULT_ADVISOR_POLICY,
  nowTs = Date.now()
): { findings: AdvisorFinding[]; totals: AdvisorTotals } {
  const findings: AdvisorFinding[] = [];
  const [slFloor, slCeiling] = policy.band;

  for (const r of rows) {
    const p = r.p;
    const m = r.m;
    const stock = num(p.stock);
    const unitCost = num(p.unitCost);
    const monthly = num(p.annualDemand) / 12;
    const H = advisorHoldingPerUnit(p);
    const sl = num(p.serviceLevel);
    const cover = m.monthsOfCover;

    const gaps: string[] = [];
    if (!(num(p.annualDemand) > 0)) gaps.push('annual demand');
    if (!(num(p.orderCost) > 0)) gaps.push('order cost');
    if (!(unitCost > 0)) gaps.push('unit cost');
    if (!(num(p.holdingRate) > 0)) gaps.push('holding rate');
    if (!(num(p.leadTime) > 0)) gaps.push('lead time');
    if (!(sl > 0)) gaps.push('service level');

    if (gaps.length) {
      findings.push({
        id: `data-${p.id}`,
        kind: 'data',
        severity: 'warn',
        sku: p.sku,
        product: p,
        title: `Missing inputs: ${p.name}`,
        detail: `EOQ and the reorder point fall back to defaults because ${gaps.join(', ')} ${gaps.length > 1 ? 'are' : 'is'} empty.`,
        money: null,
        moneyKind: null,
        priority: 75,
        impactLabel: `${gaps.length} gap${gaps.length > 1 ? 's' : ''}`,
        action: { type: 'edit', label: 'Fix inputs' },
      });
    }

    if (monthly > 0 && stock > 0 && cover > policy.cover) {
      const excessUnits = Math.max(0, stock - monthly * policy.cover);
      const excessCash = moneyVal(excessUnits * unitCost);
      if (excessCash && excessCash >= policy.minCash) {
        findings.push({
          id: `cash-excess-${p.id}`,
          kind: 'cash',
          severity: 'info',
          sku: p.sku,
          product: p,
          title: `Cash tied up in ${p.name}`,
          detail: `${fmtNum(cover, 1)} months of cover against a ${policy.cover}-month target — ${fmtInt(excessUnits)} units (${fmtMoney(excessCash)}) above plan.`,
          money: excessCash,
          moneyKind: 'parked',
          priority: excessCash,
          impactLabel: `${fmtMoney(excessCash)} cash`,
          action: { type: 'open', label: 'Review item' },
        });
      }
    }

    if (m.status === 'out' || m.status === 'critical' || m.status === 'reorder') {
      const qty = Math.max(1, Math.round(num(m.suggestedOrderQty) || num(m.eoq.Q) || 1));
      const orderValue = qty * unitCost;
      findings.push({
        id: `stock-${p.id}`,
        kind: 'stock',
        severity: m.status === 'out' || m.status === 'critical' ? 'bad' : 'warn',
        sku: p.sku,
        product: p,
        title: `${
          m.status === 'out'
            ? 'Out of stock: '
            : m.status === 'critical'
              ? 'Below safety stock: '
              : 'At reorder point: '
        }${p.name}`,
        detail: `${fmtInt(stock)} on hand · reorder point ${fmtInt(m.rop)} · safety stock ${fmtInt(m.safetyStock)} · ${fmtCover(cover)} of cover`,
        money: moneyVal(orderValue),
        moneyKind: 'order',
        priority: orderValue || 50,
        impactLabel: `${fmtInt(qty)} units · ${fmtMoney(orderValue)}`,
        action: { type: 'receive', label: `Receive ${fmtInt(qty)}`, qty },
      });
    }

    if (sl > 0 && sl < slFloor && monthly > 0 && H > 0) {
      const ssNow = advisorSafetyStockAt(p, sl);
      const ssFloor = advisorSafetyStockAt(p, slFloor);
      const extraUnits = Math.max(0, ssFloor - ssNow);
      const extraCost = extraUnits * H;
      findings.push({
        id: `policy-under-${p.id}`,
        kind: 'policy',
        severity: 'warn',
        sku: p.sku,
        product: p,
        title: `Service level below policy: ${p.name}`,
        detail: `Set to ${fmtNum(sl, 1)}%; catalogue standard is ${slFloor}%. Raising it adds about ${fmtInt(extraUnits)} units of safety stock.`,
        money: moneyVal(extraCost),
        moneyKind: 'cost',
        priority: extraCost,
        impactLabel: `+${fmtMoney(extraCost)} /yr holding`,
        action: { type: 'set-sl', label: `Set ${slFloor}%`, value: slFloor },
      });
    }

    if (sl > slCeiling && monthly > 0 && H > 0) {
      const ssHigh = advisorSafetyStockAt(p, sl);
      const ssCeil = advisorSafetyStockAt(p, slCeiling);
      const savedUnits = Math.max(0, ssHigh - ssCeil);
      const saved = savedUnits * H;
      if (saved >= policy.minSaving) {
        findings.push({
          id: `policy-over-${p.id}`,
          kind: 'policy',
          severity: 'info',
          sku: p.sku,
          product: p,
          title: `Over-specified service level: ${p.name}`,
          detail: `${fmtNum(sl, 1)}% holds ${fmtInt(savedUnits)} more safety stock units than ${slCeiling}% for a ${p.category || 'stock'} item.`,
          money: saved,
          moneyKind: 'saving',
          priority: saved,
          impactLabel: `save ${fmtMoney(saved)} /yr`,
          action: { type: 'set-sl', label: `Set ${slCeiling}%`, value: slCeiling },
        });
      }
    }

    const idle = advisorIdleDays(p.id, txs, nowTs);
    if (stock > 0 && monthly > 0 && cover > policy.cover && (idle === null || idle >= policy.slowDays)) {
      const parked = stock * unitCost;
      if (parked >= policy.minCash) {
        findings.push({
          id: `cash-slow-${p.id}`,
          kind: 'cash',
          severity: 'info',
          sku: p.sku,
          product: p,
          title: `Slow mover: ${p.name}`,
          detail: `${
            idle === null ? 'No movement since added' : `No movement for ${idle} days`
          } while holding ${fmtInt(stock)} units (${fmtNum(cover, 1)} months of cover).`,
          money: parked,
          moneyKind: 'parked',
          priority: parked,
          impactLabel: `${fmtMoney(parked)} parked`,
          action: { type: 'open', label: 'Review item' },
        });
      }
    }
  }

  findings.sort((a, b) => b.priority - a.priority);

  const parkedByProduct: Record<string, number> = {};
  let orderValueTotal = 0;
  let annualSaving = 0;

  findings.forEach((f) => {
    if (f.money == null) return;
    if (f.moneyKind === 'parked') {
      const id = f.product.id || f.sku;
      parkedByProduct[id] = Math.max(parkedByProduct[id] || 0, f.money);
    } else if (f.moneyKind === 'order') {
      orderValueTotal += f.money;
    } else if (f.moneyKind === 'saving') {
      annualSaving += f.money;
    }
  });

  const parkedCash = Object.values(parkedByProduct).reduce((a, b) => a + b, 0);

  return {
    findings,
    totals: {
      parkedCash,
      orderValue: orderValueTotal,
      annualSaving,
      problems: findings.length,
      priced: findings.filter((f) => f.money != null).length,
    },
  };
}

export function advisorHealth(
  rows: ReadonlyArray<ProductRow>,
  findings: ReadonlyArray<AdvisorFinding>,
  totals: AdvisorTotals,
  summary: WorkspaceSummary
): AdvisorHealth {
  let score = 100;
  const reasons: string[] = [];

  const outCount = rows.filter((r) => r.m.status === 'out').length;
  const critical = rows.filter((r) => r.m.status === 'critical').length;
  const reorder = rows.filter((r) => r.m.status === 'reorder').length;

  if (outCount) {
    score -= Math.min(30, outCount * 12);
    reasons.push(`${outCount} stocked out`);
  }
  if (critical) {
    score -= Math.min(24, critical * 8);
    reasons.push(`${critical} below safety stock`);
  }
  if (reorder) {
    score -= Math.min(16, reorder * 3);
    reasons.push(`${reorder} at reorder`);
  }

  const parked = totals ? totals.parkedCash : 0;
  if (summary.stockValue > 0 && parked > 0) {
    const share = parked / summary.stockValue;
    const penalty = Math.min(20, share * 40);
    if (penalty > 1) {
      score -= penalty;
      reasons.push(`${fmtMoney(parked)} parked`);
    }
  }

  const gaps = findings.filter((f) => f.kind === 'data').length;
  if (gaps) {
    score -= Math.min(20, gaps * 4);
    reasons.push(`${gaps} missing inputs`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label: AdvisorHealth['label'] =
    score >= 85 ? 'Healthy' : score >= 70 ? 'Watch' : score >= 50 ? 'At risk' : 'Critical';
  return { score, label, reasons, parkedCash: parked };
}

function advisorParkedAt(rows: ReadonlyArray<ProductRow>, cover: number, minCash = 100): number {
  const byProduct: Record<string, number> = {};
  rows.forEach((r) => {
    const p = r.p;
    const stock = num(p.stock);
    const monthly = num(p.annualDemand) / 12;
    const cost = num(p.unitCost);
    if (!(monthly > 0) || !(stock > 0) || !(cost > 0)) return;
    const excess = Math.max(0, stock - monthly * cover);
    const cash = excess * cost;
    if (cash >= minCash) byProduct[p.id || p.sku] = cash;
  });
  return Object.values(byProduct).reduce((a, b) => a + b, 0);
}

export function advisorScenario(
  rows: ReadonlyArray<ProductRow>,
  candidate: { cover: number; band: [number, number] },
  baselinePolicy: AdvisorPolicyConfig = DEFAULT_ADVISOR_POLICY
) {
  const cover = num(candidate.cover) || baselinePolicy.cover;
  const lo = Math.max(50, Math.min(num(candidate.band[0]) || 95, 99.9));
  const hi = Math.max(lo, Math.min(num(candidate.band[1]) || 98, 99.9));

  const baseline = advisorParkedAt(rows, baselinePolicy.cover, baselinePolicy.minCash);
  const parked = advisorParkedAt(rows, cover, baselinePolicy.minCash);

  let carrying = 0;
  let policyItems = 0;
  let demandSum = 0;
  let slNowSum = 0;
  let slAfterSum = 0;

  rows.forEach((r) => {
    const p = r.p;
    const H = advisorHoldingPerUnit(p);
    const annual = num(p.annualDemand);
    const sl = num(p.serviceLevel);
    if (!(H > 0) || !(annual > 0) || !(sl > 0)) return;
    const target = Math.min(Math.max(sl, lo), hi);
    if (Math.abs(target - sl) > 1e-9) {
      policyItems++;
      carrying += (advisorSafetyStockAt(p, target) - advisorSafetyStockAt(p, sl)) * H;
    }
    demandSum += annual;
    slNowSum += annual * sl;
    slAfterSum += annual * target;
  });

  let moving = 0;
  rows.forEach((r) => {
    const p = r.p;
    const stock = num(p.stock);
    const monthly = num(p.annualDemand) / 12;
    const cost = num(p.unitCost);
    if (!(monthly > 0) || !(stock > 0) || !(cost > 0)) return;
    const before = Math.max(0, stock - monthly * baselinePolicy.cover) * cost;
    const after = Math.max(0, stock - monthly * cover) * cost;
    if (Math.abs(before - after) >= baselinePolicy.minCash) moving++;
  });

  return {
    cover,
    band: [lo, hi] as [number, number],
    parked,
    baseline,
    deltaCash: parked - baseline,
    carryingDelta: carrying,
    coverItems: moving,
    policyItems,
    slNow: demandSum > 0 ? slNowSum / demandSum : 0,
    slAfter: demandSum > 0 ? slAfterSum / demandSum : 0,
  };
}

export interface BriefModel {
  rows: ProductRow[];
  summary: WorkspaceSummary;
  analysis: { findings: AdvisorFinding[]; totals: AdvisorTotals };
  totals: AdvisorTotals;
  health: AdvisorHealth;
  policy: AdvisorPolicyConfig;
  service: number;
  decisions: AdvisorFinding[];
  belowRop: number;
  remaining: number;
  generated: string;
}

export function briefService(rows: ReadonlyArray<ProductRow>): number {
  let demand = 0;
  let weighted = 0;
  rows.forEach((r) => {
    const d = num(r.p.annualDemand);
    const sl = num(r.p.serviceLevel);
    if (!(d > 0) || !(sl > 0)) return;
    demand += d;
    weighted += d * sl;
  });
  return demand > 0 ? weighted / demand : 0;
}

export function briefModel(
  rows: ReadonlyArray<ProductRow>,
  txs: ReadonlyArray<Transaction>,
  summary: WorkspaceSummary,
  settings?: Partial<WorkspaceSettings> | null
): BriefModel {
  const policy = advisorPolicyFromSettings(settings);
  const analysis = advisorAnalyse(rows, txs, policy);
  const totals = analysis.totals;
  const health = advisorHealth(rows, analysis.findings, totals, summary);
  const priced = analysis.findings.filter((f) => f.money != null);
  const decisions = (priced.length ? priced : analysis.findings).slice(0, 6);
  const belowRop = analysis.findings.filter(
    (f) => f.kind === 'stock' && (f.severity === 'bad' || f.severity === 'warn')
  ).length;
  return {
    rows: [...rows],
    summary,
    analysis,
    totals,
    health,
    policy,
    service: briefService(rows),
    decisions,
    belowRop,
    remaining: Math.max(0, analysis.findings.length - decisions.length),
    generated: new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
  };
}

export function briefIssue(f: AdvisorFinding): string {
  const i = f.title.indexOf(':');
  if (i > 0) return f.title.slice(0, i);
  if (f.kind === 'cash') return /slow mover/i.test(f.title) ? 'Slow mover' : 'Excess cover';
  if (f.kind === 'data') return 'Missing inputs';
  if (f.kind === 'policy') return 'Service policy';
  return 'Needs review';
}

export function briefHeadline(model: BriefModel): string {
  const h = model.health;
  if (!model.rows.length) return 'No catalogue yet.';
  if (h.score >= 85) return 'Inventory is inside policy.';
  if (h.score >= 70) return 'Inventory is broadly healthy, with cash above policy.';
  if (h.score >= 50) return 'Inventory needs attention this week.';
  return 'Inventory is critically exposed.';
}

export function briefParagraph(model: BriefModel): string {
  const parts: string[] = [];
  const s = model.summary;
  parts.push(`${fmtInt(s.skuCount)} items carried at ${fmtMoney(s.stockValue)} cost.`);
  if (model.belowRop) parts.push(`${model.belowRop} sit at or below their reorder point.`);
  if (model.totals.parkedCash > 0) {
    parts.push(`${fmtMoney(model.totals.parkedCash)} sits above the ${fmtNum(model.policy.cover, 1)}-month cover target.`);
  } else {
    parts.push('Nothing sits above the cover target.');
  }
  if (model.totals.orderValue > 0) {
    parts.push(`${fmtMoney(model.totals.orderValue)} of replenishment is due at current demand.`);
  }
  if (model.totals.annualSaving > 0) {
    parts.push(`${fmtMoney(model.totals.annualSaving)} a year is recoverable by right-sizing service levels.`);
  }
  return parts.join(' ');
}

export function briefText(model: BriefModel): string {
  const lines: string[] = [];
  lines.push('FactoryMind — Executive inventory brief');
  lines.push(`${model.generated} · Plant Operations`);
  lines.push('');
  lines.push(`INVENTORY HEALTH  ${model.health.score}/100 — ${model.health.label}`);
  lines.push(briefHeadline(model));
  lines.push(briefParagraph(model));
  lines.push('');
  lines.push('KEY FIGURES');
  lines.push(`  Inventory at cost        ${fmtMoney(model.summary.stockValue)}`);
  lines.push(`  Cash above target        ${fmtMoney(model.totals.parkedCash)}`);
  lines.push(`  Replenishment due        ${fmtMoney(model.totals.orderValue)}`);
  lines.push(`  Annual saving            ${fmtMoney(model.totals.annualSaving)}`);
  lines.push(`  Demand-weighted service  ${fmtNum(model.service, 1)}%`);
  lines.push(`  Items                    ${fmtInt(model.summary.skuCount)} (${fmtInt(model.belowRop)} need action)`);
  lines.push('');
  lines.push('PRIORITY DECISIONS');
  model.decisions.forEach((f, i) => {
    lines.push(`  ${i + 1}. ${f.product.name} (${f.sku}) — ${briefIssue(f)}`);
    lines.push(`     ${f.money != null ? fmtMoney(f.money) + ' · ' : ''}${f.action.label}`);
  });
  if (!model.decisions.length) lines.push('  None. Every item is inside policy.');
  if (model.remaining) lines.push(`  + ${model.remaining} more in the Advisor.`);
  lines.push('');
  lines.push('POLICY IN FORCE');
  lines.push(
    `  Cover target ${fmtNum(model.policy.cover, 1)} months · service band ${fmtNum(model.policy.band[0], 1)}–${fmtNum(model.policy.band[1], 1)}%`
  );
  return lines.join('\n');
}
