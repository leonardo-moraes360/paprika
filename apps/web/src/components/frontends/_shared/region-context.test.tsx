import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createRegionContext } from "./region-context";

type CounterState = { count: number; label: string };

const Counter = createRegionContext<CounterState>("Counter");

function Display({ id }: { id: string }) {
  const count = Counter.useRegion((s) => s.count);
  return <output data-testid={id}>{count}</output>;
}

function Increment({ name }: { name: string }) {
  const store = Counter.useRegionStore();
  return <button onClick={() => store.setState((s) => ({ ...s, count: s.count + 1 }))}>{name}</button>;
}

function Instance({ id, initial }: { id: string; initial: CounterState | (() => CounterState) }) {
  return (
    <Counter.Provider initial={initial}>
      <Display id={id} />
      <Increment name={`inc-${id}`} />
    </Counter.Provider>
  );
}

describe("createRegionContext", () => {
  it("keeps one store per Provider instance", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Instance id="a" initial={{ count: 0, label: "a" }} />
        <Instance id="b" initial={{ count: 10, label: "b" }} />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "inc-a" }));
    await user.click(screen.getByRole("button", { name: "inc-a" }));
    expect(screen.getByTestId("a")).toHaveTextContent("2");
    expect(screen.getByTestId("b")).toHaveTextContent("10");
    await user.click(screen.getByRole("button", { name: "inc-b" }));
    expect(screen.getByTestId("a")).toHaveTextContent("2");
    expect(screen.getByTestId("b")).toHaveTextContent("11");
  });

  it("calls a lazy initial once per instance", () => {
    let calls = 0;
    const initial = () => {
      calls += 1;
      return { count: 5, label: "lazy" };
    };
    const { rerender } = render(<Instance id="a" initial={initial} />);
    rerender(<Instance id="a" initial={initial} />);
    expect(calls).toBe(1);
    expect(screen.getByTestId("a")).toHaveTextContent("5");
  });

  it("re-renders a consumer only when its slice changes", async () => {
    const user = userEvent.setup();
    let renders = 0;
    function Label() {
      renders += 1;
      return <span>{Counter.useRegion((s) => s.label)}</span>;
    }
    render(
      <Counter.Provider initial={{ count: 0, label: "x" }}>
        <Label />
        <Increment name="inc" />
      </Counter.Provider>,
    );
    const before = renders;
    await user.click(screen.getByRole("button", { name: "inc" }));
    expect(renders).toBe(before);
  });

  it("throws a clear error outside its Provider", () => {
    const silence = console.error;
    console.error = () => {};
    try {
      expect(() => render(<Display id="x" />)).toThrow("Counter: region hook used outside its Provider");
    } finally {
      console.error = silence;
    }
  });
});
