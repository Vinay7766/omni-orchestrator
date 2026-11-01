import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorBoundaryProps {
  /** Short panel name shown in the fallback, e.g. "Research Hub". */
  panelName: string;
  children: ReactNode;
  /** Optional close action so the user can dismiss a broken modal. */
  onClose?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Contains render-time crashes to a single panel so the rest of the app keeps working.
 * Shows the real error message — never a fabricated success state.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.panelName}] crashed:`, error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 text-zinc-200 space-y-3"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <span>{this.props.panelName} stopped working</span>
        </div>
        <pre className="text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg p-3 whitespace-pre-wrap break-words">
          {error.message || String(error)}
        </pre>
        <div className="flex items-center gap-2">
          <button
            onClick={this.reset}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Try again</span>
          </button>
          {this.props.onClose && (
            <button
              onClick={this.props.onClose}
              className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-lg text-xs font-medium transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    );
  }
}
