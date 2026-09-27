import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
}

interface ErrorBoundaryState {
  readonly hasError: boolean;
}

/**
 * Top-level render-error boundary.
 *
 * A rendering bug should never leave the operator on a blank page, so this
 * catches unexpected component errors and offers a reload. Stack traces stay in
 * the console; the user only sees a recovery screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface detail to developers without exposing it in the UI.
    console.error('Unhandled render error', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ hasError: false });
  };

  public override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-muted-foreground text-sm">
          The page could not be displayed. You can try again; if the problem persists, reload the
          application.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={this.reset}>
            Try again
          </Button>
          <Button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
