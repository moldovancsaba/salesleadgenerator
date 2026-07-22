'use client';

import { Component, type ReactNode } from 'react';

type State = { hasError: boolean; error: unknown };
type ErrorBoundaryProps = { children: ReactNode; fallback?: ReactNode; onError?(error: unknown): void };

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, info: unknown) {
    this.props.onError?.(error);
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="mantine-Paper-root" style={{ padding: '0.75rem', minHeight: '2.5rem' }}>
          <div style={{ fontSize: '0.75re', color: 'var(--mantine-color-error-color)' }}>
            Could not render this card.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
