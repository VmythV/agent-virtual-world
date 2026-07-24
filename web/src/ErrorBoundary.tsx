import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error?: Error;
}

/**
 * Catches render errors (e.g. a malformed event payload) so one bad render
 * doesn't blank the whole app — shows a fallback with a reload button instead.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-fallback">
          <h2>出错了</h2>
          <p>页面渲染时发生了一个错误，其余功能未受影响。</p>
          <pre>{this.state.error.message}</pre>
          <button onClick={() => this.setState({ error: undefined })}>重试</button>
          <button onClick={() => window.location.reload()}>刷新页面</button>
        </div>
      );
    }
    return this.props.children;
  }
}
