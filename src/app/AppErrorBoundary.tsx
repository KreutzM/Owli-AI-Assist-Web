import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error?: Error;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled Owli web error', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatal-error" id="main-content">
          <h1>Owli-AI Assist konnte nicht gestartet werden</h1>
          <p>{this.state.error.message}</p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => window.location.reload()}
          >
            Neu laden
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
