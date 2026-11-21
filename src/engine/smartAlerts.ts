/**
 * Smart Alerts predictive stockout engine.
 * Combines rolling-origin demand forecasting (SMA, WMA, SES, Holt linear, Linear Trend)
 * with supplier lead times and live inventory levels to warn before stockouts occur.
 * Pure TypeScript, zero DOM dependencies.
 */

import {
  classifyDemand,
  compareMethods,
  ForecastOutput,
  holtLinear,
  linregMethod,
  MethodSpec,
  smaMethod,
  wmaMethod,
  emaMethod,
} from './forecast.ts';
import { Product, ProductMetrics } from '../store/store.ts';

export type SmartAlertSeverity = 'imminent' | 'critical' | 'warning' | 'watch';

export interface SmartStockAlert {
  id: string;
  product: Product;
  metrics: ProductMetrics;
  severity: SmartAlertSeverity;
  daysUntilStockout: number;
  staticDaysOfCover: number;
  leadTimeDays: number;
  runsOutBeforeLeadTime: boolean;
  orderDeadlineDays: number;
  predictedStockoutTs: number;
  forecastModel: string;
  forecastDailyDemand: number;
  staticDailyDemand: number;
  demandShiftPct: number;
  next3MonthsForecast: number[];
  recommendedOrderQty: number;
  estimatedOrderValue: number;
  confidencePct: number;
  reason: string;
}

export interface SmartAlertsSummary {
  total: number;
  imminentCount: number;
  criticalCount: number;
  warningCount: number;
  watchCount: number;
  beforeLeadTimeCount: number;
  atRiskOrderValue: number;
  horizonDays: number;
  mostUrgent: SmartStockAlert | null;
}

export interface SmartAlertsResult {
  alerts: SmartStockAlert[];
  summary: SmartAlertsSummary;
}

const FORECAST_CANDIDATES: MethodSpec[] = [
  { name: 'SMA (3)', shortKey: 'sma', method: smaMethod, params: { w: 3 } },
  { name: 'WMA (3)', shortKey: 'wma', method: wmaMethod, params: { w: 3 } },
  { name: 'SES', shortKey: 'ema', method: emaMethod, params: { alpha: 0.3 } },
  { name: 'Holt linear', shortKey: 'holt', method: holtLinear, params: { alpha: 0.35, beta: 0.15 } },
  { name: 'Linear trend', shortKey: 'lin', method: linregMethod, params: {} },
];

const SEVERITY_RANK: Record<SmartAlertSeverity, number> = {
  imminent: 0,
  critical: 1,
  warning: 2,
  watch: 3,
};

function forecastMonthly3(product: Product): {
  monthly: number[];
  modelName: string;
  confidencePct: number;
} {
  const history = Array.isArray(product.demandHistory)
    ? product.demandHistory.map(Number).filter((v) => Number.isFinite(v) && v >= 0)
    : [];
  const fallbackMonthly = Math.max(0, product.annualDemand) / 12;

  if (history.length >= 6) {
    const minTrain = Math.min(6, Math.max(3, history.length - 3));
    const cmp = compareMethods(history, FORECAST_CANDIDATES, {
      minTrainSize: minTrain,
      horizon: 3,
    });
    const best = cmp.best;
    if (best) {
      const out: ForecastOutput = best.method(history, { ...best.params, horizon: 3 });
      const monthly = [0, 1, 2].map((i) => Math.max(0, out.forecast[i] ?? fallbackMonthly));
      const errPct = best.metrics.wape ?? best.metrics.mape ?? 18;
      const confidencePct = Math.round(Math.max(40, Math.min(98, 100 - Math.min(60, errPct))));
      return {
        monthly,
        modelName: best.name,
        confidencePct,
      };
    }
  }

  if (history.length >= 2) {
    const out = holtLinear(history, { alpha: 0.35, beta: 0.15, horizon: 3 });
    return {
      monthly: [0, 1, 2].map((i) => Math.max(0, out.forecast[i] ?? fallbackMonthly)),
      modelName: 'Holt linear',
      confidencePct: 72,
    };
  }

  return {
    monthly: [fallbackMonthly, fallbackMonthly, fallbackMonthly],
    modelName: 'Annual run-rate',
    confidencePct: 60,
  };
}

const DAYS_PER_MONTH = 30.4375;

function estimateDaysToStockout(stock: number, monthlyForecast: number[], staticDaily: number): number {
  if (stock <= 0) return 0;
  const r1 = Math.max(monthlyForecast[0] / DAYS_PER_MONTH, staticDaily * 0.25, 0.01);
  const r2 = Math.max(monthlyForecast[1] / DAYS_PER_MONTH, staticDaily * 0.25, 0.01);
  const r3 = Math.max(monthlyForecast[2] / DAYS_PER_MONTH, staticDaily * 0.25, 0.01);

  let rem = stock;
  const m1Cap = r1 * DAYS_PER_MONTH;
  if (rem <= m1Cap) return rem / r1;
  rem -= m1Cap;

  const m2Cap = r2 * DAYS_PER_MONTH;
  if (rem <= m2Cap) return DAYS_PER_MONTH + rem / r2;
  rem -= m2Cap;

  const m3Cap = r3 * DAYS_PER_MONTH;
  if (rem <= m3Cap) return DAYS_PER_MONTH * 2 + rem / r3;
  rem -= m3Cap;

  return DAYS_PER_MONTH * 3 + rem / r3;
}

export function predictSmartAlerts(
  products: ReadonlyArray<Product>,
  metricsOf: (p: Product) => ProductMetrics,
  opts: { horizonDays?: number; nowTs?: number } = {}
): SmartAlertsResult {
  const horizonDays = Math.max(7, Math.min(180, opts.horizonDays ?? 45));
  const nowTs = opts.nowTs ?? Date.now();
  const alerts: SmartStockAlert[] = [];

  for (const product of products) {
    if (product.annualDemand <= 0 && product.stock > 0) continue;

    const metrics = metricsOf(product);
    const { monthly, modelName, confidencePct } = forecastMonthly3(product);
    const cls = classifyDemand(product.demandHistory || []);
    const staticDaily = Math.max(0.01, product.annualDemand / 365);
    const forecastDaily = Math.max(0.01, monthly[0] / DAYS_PER_MONTH);
    const demandShiftPct = ((forecastDaily - staticDaily) / staticDaily) * 100;

    const daysUntilStockout = estimateDaysToStockout(product.stock, monthly, staticDaily);
    const staticDaysOfCover = product.stock <= 0 ? 0 : product.stock / staticDaily;
    const leadTimeDays = Math.max(1, product.leadTime);
    const runsOutBeforeLeadTime = daysUntilStockout <= leadTimeDays;
    const orderDeadlineDays = daysUntilStockout - leadTimeDays;

    let severity: SmartAlertSeverity | null = null;
    if (product.stock <= 0 || daysUntilStockout <= 0.5) {
      severity = 'imminent';
    } else if (runsOutBeforeLeadTime) {
      severity = 'critical';
    } else if (daysUntilStockout <= horizonDays) {
      severity = 'warning';
    } else if (
      (demandShiftPct >= 8 || (cls.trended && cls.slope > 0)) &&
      daysUntilStockout <= Math.round(horizonDays * 1.45)
    ) {
      severity = 'watch';
    }

    if (!severity) continue;

    const targetBufferDays = leadTimeDays + 30;
    const forecastNeed = Math.ceil(forecastDaily * targetBufferDays + metrics.safetyStock - product.stock);
    const recommendedOrderQty = Math.max(
      1,
      Math.round(metrics.eoq.Q || 0),
      metrics.suggestedOrderQty || 0,
      forecastNeed
    );
    const estimatedOrderValue = recommendedOrderQty * Math.max(0, product.unitCost);

    const trendWord =
      demandShiftPct >= 5
        ? `+${Math.round(demandShiftPct)}% vs annual avg`
        : demandShiftPct <= -5
          ? `${Math.round(demandShiftPct)}% vs annual avg`
          : 'steady forecast rate';

    let reason = '';
    if (severity === 'imminent') {
      reason = `Zero or sub-day stock remaining (${Math.round(forecastDaily)}/day ${modelName} burn rate). Immediate PO or production expedite required.`;
    } else if (severity === 'critical') {
      reason = `Depletes in ${daysUntilStockout.toFixed(1)}d vs ${leadTimeDays}d supplier lead time (${Math.abs(orderDeadlineDays).toFixed(1)}d past order deadline) at ${trendWord}.`;
    } else if (severity === 'warning') {
      reason = `Projected stockout in ${daysUntilStockout.toFixed(1)}d (${modelName}, ${trendWord}). Place replenishment within ${Math.max(0, orderDeadlineDays).toFixed(1)}d.`;
    } else {
      reason = `Rising demand (${trendWord}) compresses runway to ${daysUntilStockout.toFixed(1)}d under ${modelName}.`;
    }

    alerts.push({
      id: `smart-${product.id}`,
      product,
      metrics,
      severity,
      daysUntilStockout,
      staticDaysOfCover,
      leadTimeDays,
      runsOutBeforeLeadTime,
      orderDeadlineDays,
      predictedStockoutTs: nowTs + Math.round(daysUntilStockout * 86400000),
      forecastModel: modelName,
      forecastDailyDemand: forecastDaily,
      staticDailyDemand: staticDaily,
      demandShiftPct,
      next3MonthsForecast: monthly,
      recommendedOrderQty,
      estimatedOrderValue,
      confidencePct,
      reason,
    });
  }

  alerts.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.daysUntilStockout - b.daysUntilStockout ||
      a.orderDeadlineDays - b.orderDeadlineDays ||
      b.metrics.usageValue - a.metrics.usageValue
  );

  let imminentCount = 0;
  let criticalCount = 0;
  let warningCount = 0;
  let watchCount = 0;
  let beforeLeadTimeCount = 0;
  let atRiskOrderValue = 0;

  for (const al of alerts) {
    if (al.severity === 'imminent') imminentCount++;
    else if (al.severity === 'critical') criticalCount++;
    else if (al.severity === 'warning') warningCount++;
    else watchCount++;

    if (al.runsOutBeforeLeadTime) beforeLeadTimeCount++;
    atRiskOrderValue += al.estimatedOrderValue;
  }

  return {
    alerts,
    summary: {
      total: alerts.length,
      imminentCount,
      criticalCount,
      warningCount,
      watchCount,
      beforeLeadTimeCount,
      atRiskOrderValue,
      horizonDays,
      mostUrgent: alerts[0] || null,
    },
  };
}
