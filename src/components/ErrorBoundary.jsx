// src/components/ErrorBoundary.jsx
import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null, tick: 0 };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Basic console logging
    // You can wire this to Sentry/PostHog later if desired.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] Caught error:", error, info);

    this.setState({ info });
  }

  handleRetry = () => {
    // Soft reset: remount children without full page reload
    this.setState((s) => ({
      hasError: false,
      error: null,
      info: null,
      tick: s.tick + 1,
    }));
  };

  render() {
    const { hasError, error } = this.state;

    if (hasError) {
      return (
        <div className="m-4 rounded-2xl border border-red-200/60 dark:border-red-900/60 bg-white dark:bg-neutral-950 p-4">
          <div className="text-base font-semibold text-red-600 dark:text-red-400">
            Something went wrong.
          </div>
          <div className="mt-2 text-sm text-neutral-700 dark:text-neutral-300 break-words">
            {error?.message || String(error) || "Unknown error"}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={this.handleRetry}
              className="px-3 py-2 rounded-xl bg-black text-white hover:bg-black/90"
            >
              Retry
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-2 rounded-xl border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-900"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    // key forces remount on Retry
    return <div key={this.state.tick}>{this.props.children}</div>;
  }
}
