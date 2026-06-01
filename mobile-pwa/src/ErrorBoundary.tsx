// Top-level error boundary for the PWA.
//
// SessionDetail's defensive event classifier renders raw JSON for
// payload shapes it does not recognise. If the desktop ever forwards a
// payload containing a circular reference, `JSON.stringify` throws
// inside render and would white-screen the entire app. This boundary
// keeps the user on a recoverable screen with a Reload button so they
// don't have to force-quit the PWA from the home screen.
//
// The fallback intentionally avoids hooks and any of the runtime
// components — if `App` itself crashes during mount, those would also
// be unreachable and the fallback must stand alone.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

function reload(): void {
  window.location.reload();
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the console so testers can paste the stack into bug
    // reports. We don't ship this to a remote logger yet — the alpha
    // audience is one user.
    console.error("ErrorBoundary caught render error:", error, info);
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <section className="app">
          <h1>Something broke.</h1>
          <p>{this.state.error.message}</p>
          <button type="button" className="btn" onClick={reload}>
            Reload
          </button>
        </section>
      );
    }
    return this.props.children;
  }
}
