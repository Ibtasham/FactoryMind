import React, { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { publicAsset } from '../../utils/assetUrl';

const BOOT_STEPS = [
  'Mounting 17-SKU catalogue & BOM hierarchy',
  'Calibrating EOQ, MRP & Line Balancing solvers',
  'Warming 3D Digital Twin & studio lighting',
  'Synchronizing telemetry & analytics workspace',
];

export const LoadingScreen: React.FC<{
  onComplete: () => void;
  reduceMotion?: boolean;
}> = ({ onComplete, reduceMotion = false }) => {
  const [progress, setProgress] = useState(reduceMotion ? 100 : 12);
  const [stepIndex, setStepIndex] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (reduceMotion) {
      const t = window.setTimeout(onComplete, 220);
      return () => window.clearTimeout(t);
    }

    const t1 = window.setTimeout(() => {
      setProgress(42);
      setStepIndex(1);
    }, 180);
    const t2 = window.setTimeout(() => {
      setProgress(76);
      setStepIndex(2);
    }, 420);
    const t3 = window.setTimeout(() => {
      setProgress(100);
      setStepIndex(3);
    }, 680);
    const t4 = window.setTimeout(() => {
      setExiting(true);
    }, 900);
    const t5 = window.setTimeout(() => {
      onComplete();
    }, 1150);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
      window.clearTimeout(t5);
    };
  }, [onComplete, reduceMotion]);

  const dismissNow = () => {
    setExiting(true);
    window.setTimeout(onComplete, 120);
  };

  return (
    <div
      data-testid="factorymind-splash"
      role="status"
      aria-label="Loading FactoryMind"
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950 text-slate-100 px-6 transition-opacity duration-300 ${
        exiting ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Subtle radial studio spotlight (no heavy gradients or blobs) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(16,185,129,0.16),_transparent_62%)]"
      />

      <div className="relative w-full max-w-md rounded-2xl border border-slate-800/90 bg-[#030a17] p-6 sm:p-7 shadow-2xl">
        {/* Full Brand Lockup */}
        <div className="flex flex-col items-center text-center">
          <h1 className="sr-only">FactoryMind — Smarter Factory. Brighter Future.</h1>
          <img
            src={publicAsset('assets/aistudio/FactoryMind_Logo_ce7bb11d.png')}
            alt="FactoryMind — Smarter Factory. Brighter Future."
            className="w-56 sm:w-60 -my-2 h-auto object-contain select-none [mask-image:radial-gradient(ellipse_at_center,black_68%,transparent_98%)]"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Smart Inventory &amp; Production Engineering Workbench
          </p>
        </div>

        {/* Precision Progress Bar */}
        <div className="mt-7 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 truncate pr-3">{BOOT_STEPS[stepIndex]}</span>
            <span className="font-mono tabular-nums font-semibold text-[var(--accent)] shrink-0">
              {progress}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Footer with Attribution & Instant Enter */}
        <div className="mt-6 pt-4 border-t border-slate-800/90 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-400">
            Made by{' '}
            <span className="font-semibold text-slate-200">Md Ibtashamur Rahman</span>
          </div>
          <button
            type="button"
            onClick={dismissNow}
            className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:brightness-110 transition-colors cursor-pointer whitespace-nowrap"
          >
            Enter <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
