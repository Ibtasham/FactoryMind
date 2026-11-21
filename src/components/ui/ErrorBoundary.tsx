import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from './Primitives';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  routeKey?: string;
  onResetRoute?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (prevProps.routeKey !== this.props.routeKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="rounded-xl border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 p-6 max-w-xl mx-auto my-8 space-y-3 shadow-xs"
        >
          <div className="flex items-center gap-2.5 text-rose-700 dark:text-rose-400">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <h2 className="text-sm font-semibold">Module encountered an unexpected error</h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {this.state.error.message || 'A rendering or calculation exception occurred in this view.'}
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => this.setState({ error: null })}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Retry view
            </Button>
            {this.props.onResetRoute && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  this.setState({ error: null });
                  this.props.onResetRoute?.();
                }}
              >
                Return to Dashboard
              </Button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
