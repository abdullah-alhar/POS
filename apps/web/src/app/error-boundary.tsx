import { Component, type ReactNode } from 'react';

/**
 * Shows what went wrong (and a way back) instead of a blank screen if a page crashes. Around
 * each page, so the menu keeps working, and it clears itself when another page is opened.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; resetKey?: string },
  { error: Error | null; key?: string }
> {
  override state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: { resetKey?: string },
    state: { error: Error | null; key?: string },
  ) {
    // Another page was opened: try again.
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  override componentDidCatch(error: Error) {
    console.error('Screen error', error);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="bg-card max-w-xl rounded-xl border p-6 shadow-sm">
          <p className="text-lg font-semibold">Something went wrong on this screen</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Nothing is lost: saved bills stay saved and your current bill is kept. Try again, or
            open another page from the menu. If it keeps happening, send a photo of this screen.
          </p>
          <pre className="bg-muted text-destructive mt-4 max-h-60 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
            {this.state.error.stack ?? this.state.error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              className="bg-primary text-primary-foreground h-10 rounded-md px-4 text-sm font-medium"
              onClick={() => this.setState({ error: null })}
            >
              Try again
            </button>
            <button
              className="h-10 rounded-md border px-4 text-sm font-medium"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
