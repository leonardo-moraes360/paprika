export type IssueUrlOptions = {
  repository: string;
  title: string;
  body?: string;
  template?: string;
  labels?: readonly string[];
  fields?: Readonly<Record<string, string>>;
  maxLength?: number;
};

const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const defaultMaxLength = 7000;

function build(options: IssueUrlOptions, body: string | undefined): string {
  const params = new URLSearchParams();
  if (options.template) params.set("template", options.template);
  params.set("title", options.title);
  if (body) params.set("body", body);
  if (options.labels && options.labels.length > 0) params.set("labels", options.labels.join(","));
  for (const [id, value] of Object.entries(options.fields ?? {})) params.set(id, value);
  return `https://github.com/${options.repository}/issues/new?${params.toString()}`;
}

export function buildIssueUrl(options: IssueUrlOptions): string {
  if (!repositoryPattern.test(options.repository)) throw new Error(`invalid repository: ${options.repository}`);
  const limit = options.maxLength ?? defaultMaxLength;
  const full = build(options, options.body);
  if (full.length <= limit || !options.body) return full;
  let body = options.body;
  while (body.length > 0) {
    body = body.slice(0, Math.floor(body.length * 0.8));
    const url = build(options, body.length > 0 ? `${body}…` : undefined);
    if (url.length <= limit) return url;
  }
  return build(options, undefined);
}
