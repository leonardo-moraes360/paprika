import { Component, type ErrorInfo, type ReactNode } from "react";
import { CanvasErrorScreen } from "./canvas-error-screen";
import { toErrorInfo } from "./details";
import type { CanvasErrorInfo, CanvasErrorProps } from "./types";

type State = { error: CanvasErrorInfo | null };

export class CanvasError extends Component<CanvasErrorProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: toErrorInfo(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const known = toErrorInfo(error, info.componentStack);
    this.setState({ error: known });
    this.props.onError?.(known);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { onReload, issueUrl, issue, environment, className } = this.props;
    return <CanvasErrorScreen error={error} onReload={onReload} issueUrl={issueUrl} issue={issue} environment={environment} className={className} />;
  }
}
