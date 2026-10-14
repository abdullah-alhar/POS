import { Component, type ReactNode } from 'react';

/** Shows what went wrong (and a reload button) instead of a blank screen if a page crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="bg-card max-w-xl rounded-xl border p-6 shadow-sm">
          <p className="text-lg font-semibold">Something went wrong on this screen</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Your current bill is saved. Press the button to reload. If it keeps happening, send a
            photo of this screen.
          </p>
          <pre className="bg-muted text-destructive mt-4 max-h-60 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
            {this.state.error.stack ?? this.state.error.message}
          </pre>
          <button
            className="bg-primary text-primary-foreground mt-4 h-10 rounded-md px-4 text-sm font-medium"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
