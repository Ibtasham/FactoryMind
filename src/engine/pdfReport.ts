/**
 * Client-side multi-page PDF generator for FactoryMind Operations Reports.
 * Uses jsPDF + jspdf-autotable for crisp, deterministic tabular export.
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmtCover, fmtInt, fmtMoney, fmtNum } from './formatters';
import { OperationsReportSnapshot } from './reports';

export interface PdfSectionFlags {
  includeSummary: boolean;
  includeReplenishment: boolean;
  includeProduction: boolean;
  includeInventory: boolean;
  includeCategories: boolean;
}

export function generateOperationsPdf(
  snapshot: OperationsReportSnapshot,
  sections: PdfSectionFlags
): { filename: string; pageCount: number } {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 82, 'F');
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 82, pageWidth, 3, 'F');

  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('FACTORYMIND · INVENTORY & PRODUCTION WORKBENCH', marginX, 26);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(17);
  doc.text('Consolidated Inventory & Production Report', marginX, 48);

  doc.setTextColor(203, 213, 225);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const scopeText = `Generated ${snapshot.generatedDisplay}  ·  Category: ${snapshot.scope.category}  ·  Status: ${snapshot.scope.status.toUpperCase()}  ·  Policy: ${fmtNum(snapshot.policy.cover, 1)} mo cover`;
  doc.text(scopeText, marginX, 66);

  let y = 104;

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - 54) {
      doc.addPage();
      y = 44;
    }
  };

  const drawSectionTitle = (title: string, subtitle?: string) => {
    ensureSpace(56);
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(title, marginX, y);
    y += 13;
    if (subtitle) {
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(subtitle, marginX, y);
      y += 10;
    }
  };

  const getLastFinalY = (fallback: number) => {
    const docWithTable = doc as jsPDF & { lastAutoTable?: { finalY?: number } };
    return docWithTable.lastAutoTable?.finalY ?? fallback;
  };

  // 1. Executive KPI Summary
  if (sections.includeSummary) {
    drawSectionTitle('1. Executive KPI Summary', 'Portfolio capital efficiency, service status, and production readiness');
    autoTable(doc, {
      startY: y,
      margin: { left: marginX, right: marginX },
      theme: 'grid',
      headStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8.5, textColor: [15, 23, 42] },
      head: [['Metric', 'Value', 'Context']],
      body: [
        [
          'Active SKUs in Scope',
          `${fmtInt(snapshot.inventory.filteredSkuCount)} / ${fmtInt(snapshot.inventory.totalCatalogSkus)}`,
          `${snapshot.inventory.counts.ok} healthy · ${snapshot.inventory.counts.reorder} reorder · ${snapshot.inventory.counts.critical} low · ${snapshot.inventory.counts.out} out`,
        ],
        [
          'Total Inventory at Cost',
          fmtMoney(snapshot.inventory.stockValue),
          snapshot.inventory.avgCoverMonths != null
            ? `Avg cover ${fmtNum(snapshot.inventory.avgCoverMonths, 1)} months across active SKUs`
            : 'Current on-hand valuation',
        ],
        [
          'Annual Usage & Turnover',
          fmtMoney(snapshot.inventory.usageValue),
          snapshot.inventory.turnover != null
            ? `${fmtNum(snapshot.inventory.turnover, 2)}x annual turns · Class A share ${fmtNum(snapshot.inventory.abcStats.A.usagePct, 0)}%`
            : 'Annualized consumption value',
        ],
        [
          'Open Replenishment Spend',
          fmtMoney(snapshot.replenishment.totalPoValue),
          `${fmtInt(snapshot.replenishment.rows.length)} SKUs below ROP (${fmtInt(snapshot.replenishment.totalOrderUnits)} total units)`,
        ],
        [
          `Production Batch Readiness (Q=${snapshot.scope.buildQty})`,
          `${fmtInt(snapshot.production.totalBuildableAssemblies)} / ${fmtInt(snapshot.production.assemblies.length)} ready`,
          `Net MRP spend ${fmtMoney(snapshot.production.totalNetReqSpend)} · ${snapshot.production.totalShortages} shortages · ${snapshot.production.totalLateOrders} late releases`,
        ],
        [
          `Line Balance (${snapshot.production.lineBalance.benchmarkName})`,
          snapshot.production.lineBalance.bestStations != null
            ? `${snapshot.production.lineBalance.bestStations} stations (${fmtNum(snapshot.production.lineBalance.efficiencyPct ?? 0, 1)}%)`
            : '—',
          `${snapshot.production.lineBalance.bestAlgorithm} at C=${snapshot.production.lineBalance.cycleTime}s (min ${snapshot.production.lineBalance.theoreticalMin})`,
        ],
      ],
    });
    y = getLastFinalY(y + 80) + 18;
  }

  // 2. Replenishment Action Schedule
  if (sections.includeReplenishment) {
    drawSectionTitle(
      '2. Replenishment Action Schedule',
      'SKUs at or below reorder point ordered by urgency and estimated purchase order value'
    );
    if (snapshot.replenishment.rows.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [15, 23, 42] },
        columnStyles: {
          3: { halign: 'right' },
          4: { halign: 'right' },
          5: { halign: 'right', fontStyle: 'bold' },
          6: { halign: 'right' },
          7: { halign: 'right' },
        },
        head: [['SKU', 'Item', 'Status', 'On Hand', 'ROP', 'Order Qty', 'Est. PO Value', 'Cover']],
        body: snapshot.replenishment.rows.map((r) => [
          r.product.sku,
          r.product.name.slice(0, 28),
          r.metrics.status.toUpperCase(),
          `${fmtInt(r.product.stock)} ${r.product.unit}`,
          fmtInt(r.metrics.rop),
          fmtInt(r.metrics.suggestedOrderQty),
          fmtMoney(r.suggestedPoValue),
          fmtCover(r.metrics.monthsOfCover),
        ]),
        didParseCell: (hook) => {
          if (hook.section === 'body' && hook.column.index === 2) {
            const raw = String(hook.cell.raw || '');
            if (raw === 'OUT' || raw === 'CRITICAL') hook.cell.styles.textColor = [220, 38, 38];
            else if (raw === 'REORDER') hook.cell.styles.textColor = [217, 119, 6];
            hook.cell.styles.fontStyle = 'bold';
          }
        },
      });
      y = getLastFinalY(y + 60) + 18;
    } else {
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text('No SKUs currently require replenishment inside the selected scope.', marginX, y + 6);
      y += 24;
    }
  }

  // 3. Production & MRP Readiness
  if (sections.includeProduction) {
    drawSectionTitle(
      '3. Production, BOM & MRP Readiness',
      `Batch build quantity = ${snapshot.scope.buildQty} units · Need in ${snapshot.scope.needInDays} days · Rule: ${snapshot.scope.lotRule.toUpperCase()}`
    );
    if (snapshot.production.assemblies.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: [15, 23, 42] },
        columnStyles: {
          2: { halign: 'right' },
          3: { halign: 'right' },
          5: { halign: 'right' },
          6: { halign: 'right' },
          7: { halign: 'right' },
        },
        head: [['Assembly', 'Name', 'BOM Cost', 'Buildable', 'Bottleneck', 'Net Req Spend', 'Shortages', 'Late']],
        body: snapshot.production.assemblies.map((a) => [
          a.product.sku,
          a.product.name.slice(0, 26),
          fmtMoney(a.unitBomCost),
          fmtInt(a.buildableNow),
          a.bottleneckSku,
          fmtMoney(a.netReqSpend),
          fmtInt(a.shortageCount),
          fmtInt(a.lateOrderCount),
        ]),
      });
      y = getLastFinalY(y + 60) + 16;
    }

    if (snapshot.production.selectedAssembly) {
      const sel = snapshot.production.selectedAssembly;
      drawSectionTitle(
        `3b. Exploded MRP Components (${sel.product.sku} × ${sel.batchQty})`,
        `Low-level BOM component requirements, current stock, and net order quantities`
      );
      autoTable(doc, {
        startY: y,
        margin: { left: marginX, right: marginX },
        theme: 'grid',
        headStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontSize: 7.5 },
        bodyStyles: { fontSize: 7.5, textColor: [15, 23, 42] },
        columnStyles: {
          2: { halign: 'center' },
          3: { halign: 'right' },
          4: { halign: 'right' },
          5: { halign: 'right' },
          6: { halign: 'right', fontStyle: 'bold' },
          7: { halign: 'right' },
        },
        head: [['SKU', 'Component', 'Lvl', 'On Hand', 'Gross Req', 'Lead (d)', 'Net Req', 'Ending POH']],
        body: Object.values(sel.plan.components).map((c) => [
          c.sku,
          c.name.slice(0, 28),
          String(c.level),
          `${fmtInt(c.onHand)} ${c.unit}`,
          fmtInt(c.totalGross),
          `${c.leadTimeDays}d`,
          fmtInt(c.totalNetRequirement),
          fmtInt(c.finalProjectedOnHand),
        ]),
      });
      y = getLastFinalY(y + 60) + 18;
    }
  }

  // 4. Category Breakdown & Line Balance
  if (sections.includeCategories) {
    drawSectionTitle('4. Category Capital & Line Balancing Summary', 'On-hand capital concentration by category and assembly line efficiency');
    autoTable(doc, {
      startY: y,
      margin: { left: marginX, right: marginX },
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: [15, 23, 42] },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
      },
      head: [['Category', 'SKUs', 'Stock Value', 'Annual Usage', 'Share %', 'Turnover']],
      body: snapshot.categories.map((c) => [
        c.category,
        fmtInt(c.skuCount),
        fmtMoney(c.stockValue),
        fmtMoney(c.usageValue),
        `${fmtNum(c.sharePct, 1)}%`,
        c.turnover != null ? `${fmtNum(c.turnover, 1)}x` : '—',
      ]),
    });
    y = getLastFinalY(y + 60) + 14;

    autoTable(doc, {
      startY: y,
      margin: { left: marginX, right: marginX },
      theme: 'grid',
      headStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontSize: 7.5 },
      bodyStyles: { fontSize: 7.5, textColor: [15, 23, 42] },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
      },
      head: [['Line Balance Algorithm', 'Stations', 'Efficiency', 'Balance Delay', 'Smoothness']],
      body: snapshot.production.lineBalance.comparison.map((c) => [
        c.label,
        c.stationCount != null ? String(c.stationCount) : '—',
        c.efficiency != null ? `${fmtNum(c.efficiency, 1)}%` : '—',
        c.balanceDelay != null ? `${fmtNum(c.balanceDelay, 1)}%` : '—',
        c.smoothnessIndex != null ? fmtNum(c.smoothnessIndex, 2) : '—',
      ]),
    });
    y = getLastFinalY(y + 60) + 18;
  }

  // 5. Full Inventory & ABC Metrics Ledger
  if (sections.includeInventory && snapshot.inventory.rows.length > 0) {
    drawSectionTitle('5. Full Inventory & ABC Pareto Metrics', 'Complete SKU catalogue with EOQ, safety stock, ROP, cover, and valuation');
    autoTable(doc, {
      startY: y,
      margin: { left: marginX, right: marginX },
      theme: 'striped',
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontSize: 7.5 },
      bodyStyles: { fontSize: 7.5, textColor: [15, 23, 42] },
      columnStyles: {
        2: { halign: 'center' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right' },
        8: { halign: 'right' },
      },
      head: [['SKU', 'Item', 'ABC', 'Stock', 'EOQ', 'ROP', 'Cover', 'Value', 'Status']],
      body: snapshot.inventory.rows.map((r) => [
        r.product.sku,
        r.product.name.slice(0, 24),
        r.abcClass,
        `${fmtInt(r.product.stock)} ${r.product.unit}`,
        fmtInt(r.metrics.eoq.Q),
        fmtInt(r.metrics.rop),
        fmtCover(r.metrics.monthsOfCover),
        fmtMoney(r.metrics.stockValue),
        r.metrics.status.toUpperCase(),
      ]),
    });
  }

  // Page numbering footer
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(226, 232, 240);
    doc.line(marginX, pageHeight - 36, pageWidth - marginX, pageHeight - 36);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('FactoryMind Operations Workbench · Made by Md Ibtashamur Rahman', marginX, pageHeight - 22);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - marginX, pageHeight - 22, { align: 'right' });
  }

  const stamp = snapshot.generatedIso.slice(0, 10);
  const filename = `factorymind-operations-report-${stamp}.pdf`;
  doc.save(filename);
  return { filename, pageCount: totalPages };
}
