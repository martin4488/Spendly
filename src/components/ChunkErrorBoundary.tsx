'use client';

import { Component, ReactNode } from 'react';

/**
 * Catches errors from lazy-loaded view chunks. Offline, a not-yet-cached chunk
 * fails its dynamic import and would otherwise crash the whole app with a
 * client-side error. Here we show a friendly fallback with a retry instead.
 */
export default class ChunkErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('View failed to load:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
          <div className="text-4xl mb-3">📡</div>
          <p className="text-dark-200 text-sm font-medium">No se pudo cargar esta sección</p>
          <p className="text-dark-500 text-xs mt-1 mb-5">
            Puede que estés sin conexión. Reconectá y reintentá.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="bg-brand-600 text-white text-sm font-semibold px-5 py-2.5 rounded-2xl active:bg-brand-500 transition-colors"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
