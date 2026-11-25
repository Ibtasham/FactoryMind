import React, { Component, Suspense, lazy, useState } from 'react';
import type { Factory3DViewportProps, Selected3DPart } from './Factory3DViewport';
import { DigitalTwin2DFallback } from './DigitalTwin2DFallback';

const LazyViewportInner = lazy(() =>
  import('./Factory3DViewport').then((mod) => ({ default: mod.Factory3DViewport }))
);

export type { Selected3DPart };
export type LazyFactory3DViewportProps = Factory3DViewportProps;

interface ViewportBoundaryProps {
  children: React.ReactNode;
  fallbackProps: LazyFactory3DViewportProps;
  onRetry: () => void;
}

interface ViewportBoundaryState {
  hasError: boolean;
}

class ViewportErrorBoundary extends Component<ViewportBoundaryProps, ViewportBoundaryState> {
  state: ViewportBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ViewportBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      const p = this.props.fallbackProps;
      const heightCls = p.compact
        ? 'h-[240px] sm:h-[300px]'
        : 'h-[300px] sm:h-[420px] lg:h-[560px] max-h-[75vh] min-h-[240px]';
      return (
        <div
          className={`relative overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-[#0b1120] ${heightCls} ${p.className || ''}`}
        >
          <DigitalTwin2DFallback
            mode={p.mode}
            assemblySku={p.assemblySku}
            explodeAmount={p.explodeAmount}
            plantProducts={p.plantProducts}
            plantStations={p.plantStations}
            selectedPartId={p.selectedPartId}
            onSelectPart={(part) => p.onSelectPart?.(part)}
            simPlaying={p.simPlaying}
            reason="3D module unavailable — interactive 2D Digital Twin fallback active."
            onRetry3D={() => {
              this.setState({ hasError: false });
              this.props.onRetry();
            }}
            theme={p.theme}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

export const LazyFactory3DViewport: React.FC<LazyFactory3DViewportProps> = (props) => {
  const [retryCount, setRetryCount] = useState(0);
  const heightCls = props.compact
    ? 'min-h-[240px] sm:min-h-[300px]'
    : 'min-h-[300px] sm:min-h-[420px]';
  return (
    <ViewportErrorBoundary fallbackProps={props} onRetry={() => setRetryCount((c) => c + 1)}>
      <Suspense
        fallback={
          <div
            role="status"
            aria-live="polite"
            className={`w-full ${heightCls} rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/80 flex items-center justify-center text-xs text-slate-600 dark:text-slate-300 font-mono`}
          >
            Loading 3D Digital Twin engine…
          </div>
        }
      >
        <LazyViewportInner key={retryCount} {...props} />
      </Suspense>
    </ViewportErrorBoundary>
  );
};
