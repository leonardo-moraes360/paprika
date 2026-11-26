import { describe, expect, it } from "vitest";
import { buildIssueUrl } from "./issue-url";

describe("buildIssueUrl", () => {
  it("builds a new issue link with the template, title, labels, body and form fields", () => {
    const url = new URL(
      buildIssueUrl({
        repository: "leonardo/paprika",
        template: "canvas-crash.yml",
        title: "[canvas] The canvas stopped",
        body: "Version: 0.9.2\nError: boom & bust",
        labels: ["bug", "canvas"],
        fields: { version: "0.9.2" },
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/leonardo/paprika/issues/new");
    expect(url.searchParams.get("template")).toBe("canvas-crash.yml");
    expect(url.searchParams.get("title")).toBe("[canvas] The canvas stopped");
    expect(url.searchParams.get("body")).toBe("Version: 0.9.2\nError: boom & bust");
    expect(url.searchParams.get("labels")).toBe("bug,canvas");
    expect(url.searchParams.get("version")).toBe("0.9.2");
  });

  it("omits what is not given", () => {
    const url = new URL(buildIssueUrl({ repository: "a/b", title: "T" }));
    expect([...url.searchParams.keys()]).toEqual(["title"]);
  });

  it("rejects a repository that is not owner/name", () => {
    expect(() => buildIssueUrl({ repository: "https://evil.example/x", title: "T" })).toThrow("invalid repository");
    expect(() => buildIssueUrl({ repository: "a/b/c", title: "T" })).toThrow("invalid repository");
    expect(() => buildIssueUrl({ repository: "a", title: "T" })).toThrow("invalid repository");
  });

  it("keeps the link within the length limit by trimming the body", () => {
    const body = "x".repeat(20_000);
    const href = buildIssueUrl({ repository: "a/b", title: "T", body, maxLength: 1000 });
    expect(href.length).toBeLessThanOrEqual(1000);
    const trimmed = new URL(href).searchParams.get("body") as string;
    expect(trimmed.endsWith("…")).toBe(true);
    expect(trimmed.length).toBeGreaterThan(100);
  });

  it("drops the body when even a short one does not fit", () => {
    const href = buildIssueUrl({ repository: "a/b", title: "T".repeat(300), body: "hello", maxLength: 330 });
    expect(new URL(href).searchParams.has("body")).toBe(false);
  });
});
