import type { ReactNode } from "react";

export type CanvasErrorInfo = {
  name: string;
  message: string;
  stack?: string;
  componentStack?: string;
};

export type CanvasErrorReport = {
  error: CanvasErrorInfo;
  details: string;
  environment?: string;
  includeDetails: boolean;
  title: string;
  body: string;
};

export type CanvasErrorIssue = {
  repository: string;
  template?: string;
  labels?: readonly string[];
};

export type CanvasErrorProps = {
  children: ReactNode;
  onReload: () => void;
  issueUrl?: string | ((report: CanvasErrorReport) => string);
  issue?: CanvasErrorIssue;
  environment?: string;
  onError?: (error: CanvasErrorInfo) => void;
  resetKey?: unknown;
  className?: string;
};

export type CanvasErrorScreenProps = Omit<CanvasErrorProps, "children" | "onError" | "resetKey"> & {
  error: CanvasErrorInfo;
};
