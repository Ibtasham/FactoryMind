import React, { Suspense, lazy } from 'react';
import type { Factory3DViewportProps, Selected3DPart } from './Factory3DViewport';

const LazyViewportInner = lazy(() =>
  import('./Factory3DViewport').then((mod) => ({ default: mod.Factory3DViewport }))
);

export type { Selected3DPart };
export type LazyFactory3DViewportProps = Factory3DViewportProps;

export const LazyFactory3DViewport: React.FC<LazyFactory3DViewportProps> = (props) => {
  const heightCls = props.compact
    ? 'min-h-[240px] sm:min-h-[300px]'
    : 'min-h-[300px] sm:min-h-[420px]';
  return (
    <Suspense
      fallback={
        <div
          className={`w-full ${heightCls} rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-900/80 flex items-center justify-center text-xs text-slate-400 font-mono`}
        >
          Loading 3D Digital Twin engine…
        </div>
      }
    >
      <LazyViewportInner {...props} />
    </Suspense>
  );
};
