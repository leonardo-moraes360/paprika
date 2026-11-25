import { describe, expect, it } from "vitest";
import { BUDGETS, type Budget } from "./budgets.js";
import { evaluate, table } from "./report.js";

const sample: Budget = { id: "x", scenario: "s", label: "l", unit: "ms", kind: "relative", limit: 50, today: "1 s", enforce: false, ticket: "PAP-A-000" };

describe("perf budgets", () => {
  it("every budget names a ticket and starts report-only", () => {
    for (const b of Object.values(BUDGETS)) {
      expect(b.ticket).toMatch(/^PAP-A-\d{3}$/);
      expect(b.id in BUDGETS).toBe(true);
    }
  });

  it("a budget over its limit is known-failing while not enforced", () => {
    expect(evaluate(sample, 1000, 10).status).toBe("known-failing");
    expect(evaluate(sample, 40, 10).status).toBe("ok");
  });

  it("an enforced budget over its limit fails", () => {
    expect(evaluate({ ...sample, enforce: true }, 1000, 10).status).toBe("fail");
    expect(evaluate({ ...sample, enforce: true }, 55, 10).status).toBe("ok");
  });

  it("relative budgets subtract the baseline, exact ones do not", () => {
    expect(evaluate(sample, 100, 80).effective).toBe(20);
    expect(evaluate({ ...sample, kind: "exact" }, 100, 80).effective).toBe(100);
  });

  it("prints a table row per result", () => {
    const out = table([evaluate(sample, 1000, 10)]);
    expect(out).toContain("known-failing (PAP-A-000)");
  });
});
