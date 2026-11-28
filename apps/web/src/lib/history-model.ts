export type HistoryTone = "agent-1" | "agent-2" | "agent-3" | "agent-4";

export type HistoryAuthor = { id: string; name: string; agent: boolean; tone?: HistoryTone };

export type HistoryStepData = {
  id: string;
  author: HistoryAuthor;
  label: string;
  at: number;
  undone: boolean;
  nodeIds: string[];
};

export type HistoryGroup = {
  key: string;
  author: HistoryAuthor;
  newestAt: number;
  steps: HistoryStepData[];
};

export type HistoryRow = { kind: "header"; key: string; group: HistoryGroup } | { kind: "step"; key: string; step: HistoryStepData; group: HistoryGroup };

export function filterSteps(steps: readonly HistoryStepData[], mineOnly: boolean): HistoryStepData[] {
  return mineOnly ? steps.filter((step) => !step.author.agent) : [...steps];
}

export function groupSteps(steps: readonly HistoryStepData[]): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i] as HistoryStepData;
    const last = groups[groups.length - 1];
    if (last && last.author.id === step.author.id) last.steps.push(step);
    else groups.push({ key: `${step.author.id}:${step.id}`, author: step.author, newestAt: step.at, steps: [step] });
  }
  return groups;
}

export function flattenGroups(groups: readonly HistoryGroup[]): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const group of groups) {
    rows.push({ kind: "header", key: `h:${group.key}`, group });
    for (const step of group.steps) rows.push({ kind: "step", key: `s:${step.id}`, step, group });
  }
  return rows;
}

export function buildHistoryRows(steps: readonly HistoryStepData[], mineOnly: boolean): HistoryRow[] {
  return flattenGroups(groupSteps(filterSteps(steps, mineOnly)));
}
