/**
 * Pure dashboard summary calculations for Total Inventory Value,
 * Low Stock Alerts, and Recent Production Throughput.
 * Zero DOM dependencies.
 */

import { StockStatus } from './ipe.ts';
import { computeMetrics, Product, ProductMetrics, Transaction, WorkspaceSettings } from '../store/store.ts';

export interface DashboardSummaryMetrics {
  windowDays: number;
  inventory: {
    totalValue: number;
    annualUsageValue: number;
    turnoverRatio: number | null;
    skuCount: number;
    assemblyCount: number;
    healthyCount: number;
  };
  alerts: {
    totalAlerts: number;
    outCount: number;
    criticalCount: number;
    reorderCount: number;
    estimatedPoSpend: number;
    mostUrgent: {
      product: Product;
      metrics: ProductMetrics;
    } | null;
  };
  throughput: {
    outboundUnits: number;
    outboundValue: number;
    inboundUnits: number;
    inboundValue: number;
    dailyUnitRate: number;
    workOrderCount: number;
    txCount: number;
    priorOutboundUnits: number;
    deltaPct: number | null;
  };
}

const MS_PER_DAY = 86_400_000;

export function computeDashboardSummary(
  products: Product[],
  transactions: Transaction[],
  _settings: WorkspaceSettings,
  options: { nowTs?: number; windowDays?: number } = {}
): DashboardSummaryMetrics {
  const windowDays = Math.max(1, Math.round(options.windowDays ?? 30));
  const nowTs = options.nowTs ?? Date.now();
  const windowStart = nowTs - windowDays * MS_PER_DAY;
  const priorStart = nowTs - windowDays * 2 * MS_PER_DAY;

  const byId: Record<string, Product> = {};
  products.forEach((p) => {
    byId[p.id] = p;
  });

  let totalValue = 0;
  let annualUsageValue = 0;
  let assemblyCount = 0;
  let healthyCount = 0;
  let outCount = 0;
  let criticalCount = 0;
  let reorderCount = 0;
  let estimatedPoSpend = 0;

  const statusRank: Record<StockStatus, number> = { out: 0, critical: 1, reorder: 2, ok: 3 };
  let mostUrgent: { product: Product; metrics: ProductMetrics } | null = null;

  for (const p of products) {
    const m = computeMetrics(p);
    totalValue += m.stockValue;
    annualUsageValue += m.usageValue;
    if (Array.isArray(p.bom) && p.bom.length > 0) assemblyCount++;

    if (m.status === 'ok') {
      healthyCount++;
    } else {
      if (m.status === 'out') outCount++;
      else if (m.status === 'critical') criticalCount++;
      else reorderCount++;

      estimatedPoSpend += m.suggestedOrderQty * p.unitCost;

      if (
        !mostUrgent ||
        statusRank[m.status] < statusRank[mostUrgent.metrics.status] ||
        (statusRank[m.status] === statusRank[mostUrgent.metrics.status] &&
          m.usageValue > mostUrgent.metrics.usageValue)
      ) {
        mostUrgent = { product: p, metrics: m };
      }
    }
  }

  let outboundUnits = 0;
  let outboundValue = 0;
  let inboundUnits = 0;
  let inboundValue = 0;
  let workOrderCount = 0;
  let txCount = 0;
  let priorOutboundUnits = 0;

  for (const tx of transactions) {
    if (tx.ts > nowTs) continue;
    const prod = byId[tx.productId];
    const unitCost = prod ? prod.unitCost : 0;

    if (tx.ts >= windowStart) {
      txCount++;
      if (tx.type === 'out') {
        outboundUnits += tx.qty;
        outboundValue += tx.qty * unitCost;
        if (/wo|production|line|shipment|assembly/i.test(tx.note || '')) {
          workOrderCount++;
        }
      } else {
        inboundUnits += tx.qty;
        inboundValue += tx.qty * unitCost;
      }
    } else if (tx.ts >= priorStart && tx.type === 'out') {
      priorOutboundUnits += tx.qty;
    }
  }

  const dailyUnitRate = outboundUnits / windowDays;
  const deltaPct =
    priorOutboundUnits > 0
      ? ((outboundUnits - priorOutboundUnits) / priorOutboundUnits) * 100
      : null;

  return {
    windowDays,
    inventory: {
      totalValue,
      annualUsageValue,
      turnoverRatio: totalValue > 0 ? annualUsageValue / totalValue : null,
      skuCount: products.length,
      assemblyCount,
      healthyCount,
    },
    alerts: {
      totalAlerts: outCount + criticalCount + reorderCount,
      outCount,
      criticalCount,
      reorderCount,
      estimatedPoSpend,
      mostUrgent,
    },
    throughput: {
      outboundUnits,
      outboundValue,
      inboundUnits,
      inboundValue,
      dailyUnitRate,
      workOrderCount,
      txCount,
      priorOutboundUnits,
      deltaPct,
    },
  };
}
