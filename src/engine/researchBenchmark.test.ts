import assert from 'node:assert/strict';
import test from 'node:test';

import { createSeedDB } from '../store/store';
import {
  BENCHMARK_LIMITATIONS,
  buildBenchmarkExportPayload,
  buildConfigExportPayload,
  buildResearchMarkdownReport,
  classifyResearchProvenance,
  FORECAST_ALGORITHM_DOCS,
  FORECAST_METRIC_DOCS,
  parseExternalSeriesInput,
  runResearchBenchmark,
  verifyAndLoadBenchmarkArtifact,
} from './researchBenchmark';

test('Research Benchmark: documents all 12 methods, metrics, and limitations', () => {
  assert.equal(FORECAST_ALGORITHM_DOCS.length, 12);
  const shortKeys = new Set(FORECAST_ALGORITHM_DOCS.map((d) => d.shortKey));
  assert.equal(shortKeys.size, 12);
  assert.ok(FORECAST_METRIC_DOCS.some((m) => m.id === 'wape'));
  assert.ok(FORECAST_METRIC_DOCS.some((m) => m.id === 'mase'));
  assert.ok(BENCHMARK_LIMITATIONS.some((l) => l.id === 'scale-mixing'));
  assert.ok(BENCHMARK_LIMITATIONS.some((l) => l.id === 'hwm-fallback'));
});

test('Research Benchmark: provenance classification distinguishes all 4 categories and tracks short exclusions', () => {
  assert.equal(classifyResearchProvenance('demo').provenanceClass, 'illustrative-catalogue');
  assert.equal(classifyResearchProvenance(undefined).provenanceClass, 'illustrative-catalogue');
  assert.equal(classifyResearchProvenance('imported').provenanceClass, 'user-imported');
  assert.equal(classifyResearchProvenance('user').provenanceClass, 'user-imported');
  assert.equal(classifyResearchProvenance('synthetic').provenanceClass, 'synthetic-generated');
  assert.equal(classifyResearchProvenance('external').provenanceClass, 'external-dataset');

  const db = createSeedDB();
  const mixedProducts = [
    ...db.products.slice(0, 3),
    {
      id: 'p-imp',
      sku: 'IMP-100',
      name: 'Imported Bearing',
      demandHistory: [50, 52, 54, 58, 60, 62, 65, 67, 70, 72],
      demandSource: 'imported' as const,
    },
    {
      id: 'p-short',
      sku: 'SHORT-2',
      name: 'Too Short',
      demandHistory: [10, 12, 11],
      demandSource: 'user' as const,
    },
  ];

  const ext = [
    {
      id: 'ext:test-1',
      label: 'External-Plant-B',
      history: [100, 110, 120, 115, 125, 130, 135, 140, 145, 150],
    },
  ];

  const res = runResearchBenchmark({
    products: mixedProducts,
    config: { seed: 42, cohortScope: 'all' },
    externalSeries: ext,
  });

  assert.equal(res.provenanceCountsEvaluated['illustrative-catalogue'], 3);
  assert.equal(res.provenanceCountsEvaluated['user-imported'], 1);
  assert.equal(res.provenanceCountsEvaluated['synthetic-generated'], 5);
  assert.equal(res.provenanceCountsEvaluated['external-dataset'], 1);
  assert.equal(res.excludedSeries.length, 1);
  assert.equal(res.excludedSeries[0].label, 'SHORT-2');
});

test('Research Benchmark: causal leakage check passes across expanding and rolling windows and detects zero perturbation drift', () => {
  const db = createSeedDB();

  for (const trainWindowType of ['expanding', 'rolling'] as const) {
    const res = runResearchBenchmark({
      products: db.products.slice(0, 4),
      config: { seed: 42, trainWindowType, rollingMaxTrain: 8, skuHorizon: 2, synthHorizon: 3 },
    });

    assert.equal(res.leakageAudit.passed, true);
    assert.equal(res.leakageAudit.leakedModels.length, 0);
    assert.equal(res.leakageAudit.maxFuturePerturbationDelta, 0);
    assert.equal(res.leakageAudit.perturbationModelsTested, 12);
    assert.ok(res.leakageAudit.verifiedOriginsCount > 50);

    for (const sr of res.perSeries) {
      assert.equal(sr.allOriginsNonOverlapping, true);
      for (const o of sr.originsAudit) {
        assert.equal(o.trainEnd, o.originIndex - 1);
        assert.equal(o.testStart, o.originIndex);
        if (trainWindowType === 'rolling') {
          assert.ok(o.trainSize <= 8);
        }
      }
    }
  }
});

test('Research Benchmark: surfaces HWMultiplicative additive fallback & zero-demand MAPE skipping on intermittent regime', () => {
  const res = runResearchBenchmark({
    products: [],
    config: { seed: 42, cohortScope: 'synthetic' },
  });

  assert.equal(res.includedSeries.length, 5);
  const intermittent = res.perSeries.find((s) => s.series.id === 'synth:intermittent');
  assert.ok(intermittent);
  assert.ok(intermittent.series.zeroCount > 0);

  const hwm = intermittent.methods.find((m) => m.shortKey === 'hwm');
  assert.ok(hwm);
  assert.equal(hwm.degradedVariant, true);
  assert.ok(hwm.zeroActualPoints > 0);
  assert.ok(hwm.mapeValidPoints < hwm.metrics.n);

  assert.equal(res.leaderboardAll.length, 12);
  for (const row of res.leaderboardAll) {
    assert.ok(row.medianWape != null);
    assert.ok(row.iqrWape != null);
    assert.ok(row.meanRank != null && row.meanRank >= 1 && row.meanRank <= 12);
  }
});

test('Research Benchmark: deterministic seeds, full JSON export roundtrip verification, tamper detection, and Markdown report', () => {
  const db = createSeedDB();
  const cfg = { seed: 108, trainWindowType: 'expanding' as const, skuHorizon: 2, synthHorizon: 3 };

  const runA = runResearchBenchmark({ products: db.products, config: cfg });
  const runB = runResearchBenchmark({ products: db.products, config: cfg });
  const runOtherSeed = runResearchBenchmark({ products: db.products, config: { ...cfg, seed: 109 } });

  assert.equal(runA.checksums.resultsChecksum, runB.checksums.resultsChecksum);
  assert.equal(runA.checksums.datasetChecksum, runB.checksums.datasetChecksum);
  assert.notEqual(runA.checksums.datasetChecksum, runOtherSeed.checksums.datasetChecksum);

  const exportedJson = JSON.stringify(buildBenchmarkExportPayload(runA));
  const verified = verifyAndLoadBenchmarkArtifact(exportedJson);
  assert.equal(verified.valid, true);
  assert.equal(verified.kind, 'full-benchmark');
  assert.equal(verified.exactMatch, true);
  assert.equal(verified.expectedResultsChecksum, verified.recomputedResultsChecksum);
  assert.ok((verified.maxWapeDiff ?? 1) < 1e-8);
  assert.equal(verified.seriesChecked, runA.includedSeries.length);

  // Tamper check: modifying exported leaderboard WAPE must fail exactMatch verification
  const tamperedObj = JSON.parse(exportedJson);
  tamperedObj.leaderboards.overall[0].avgWape += 5.0;
  const tamperedCheck = verifyAndLoadBenchmarkArtifact(JSON.stringify(tamperedObj));
  assert.equal(tamperedCheck.valid, true);
  assert.equal(tamperedCheck.exactMatch, false);
  assert.ok((tamperedCheck.mismatches?.length || 0) > 0);

  // Config-only export roundtrip
  const ext = [{ id: 'ext:sample', label: 'Sample-Ext', history: [10, 12, 14, 16, 18, 20, 22, 24] }];
  const cfgExport = JSON.stringify(buildConfigExportPayload(runA.config, ext));
  const cfgVerified = verifyAndLoadBenchmarkArtifact(cfgExport);
  assert.equal(cfgVerified.valid, true);
  assert.equal(cfgVerified.kind, 'config-only');
  assert.equal(cfgVerified.restoredConfig?.seed, 108);
  assert.equal(cfgVerified.restoredExternalSeries?.length, 1);

  // Markdown report structure
  const md = buildResearchMarkdownReport(runA);
  assert.ok(md.includes('# FactoryMind Forecasting Research Benchmark Report'));
  assert.ok(md.includes(runA.checksums.resultsChecksum));
  assert.ok(md.includes('Causal Future-Leakage Verification'));
  assert.ok(md.includes('Preloaded Illustrative Catalogue'));
  assert.ok(md.includes('Workspace SKUs Only'));
  assert.ok(md.includes('Generated Synthetic Regimes Only'));
  assert.ok(md.includes('Methodological Assumptions & Limitations'));
});

test('Research Benchmark: parseExternalSeriesInput validates labels, non-numeric tokens, negatives, and length', () => {
  assert.equal(parseExternalSeriesInput('', '10, 20, 30, 40, 50, 60').valid, false);
  assert.equal(parseExternalSeriesInput('Test', '10, -5, 30, 40, 50, 60').valid, false);
  assert.equal(parseExternalSeriesInput('Test', '10, abc, 30, 40, 50, 60').valid, false);
  assert.equal(parseExternalSeriesInput('Test', '10, 20, 30').valid, false);

  const ok = parseExternalSeriesInput('ERP-Sample', '120, 130, 125, 140, 0, 135, 150');
  assert.equal(ok.valid, true);
  assert.equal(ok.series?.history.length, 7);
});
