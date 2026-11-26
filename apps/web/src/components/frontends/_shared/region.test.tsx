import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createRegion, shallow } from "./index";

type CounterState = { count: number; label: string };

const Counter = createRegion<CounterState, { increment: () => void; rename: (label: string) => void }>("Counter", ({ setState }) => ({
  increment: () => setState((s) => ({ ...s, count: s.count + 1 })),
  rename: (label) => setState((s) => ({ ...s, label })),
}));

function Display({ id }: { id: string }) {
  const count = Counter.useRegion((s) => s.count);
  return <output data-testid={id}>{count}</output>;
}

function Increment({ name }: { name: string }) {
  const { increment } = Counter.useRegionActions();
  return <button onClick={increment}>{name}</button>;
}

function Instance({ id, initial }: { id: string; initial: CounterState | (() => CounterState) }) {
  return (
    <Counter.Provider initial={initial}>
      <Display id={id} />
      <Increment name={`inc-${id}`} />
    </Counter.Provider>
  );
}

describe("createRegion", () => {
  it("keeps one store per Provider instance and exposes typed actions", async () => {
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

  it("does not re-render an object selector with shallow compare when nothing changed", async () => {
    const user = userEvent.setup();
    let renders = 0;
    function Pair() {
      renders += 1;
      const pair = Counter.useRegion((s) => ({ label: s.label }), shallow);
      return <span>{pair.label}</span>;
    }
    render(
      <Counter.Provider initial={{ count: 0, label: "x" }}>
        <Pair />
        <Increment name="inc" />
      </Counter.Provider>,
    );
    const before = renders;
    await user.click(screen.getByRole("button", { name: "inc" }));
    expect(renders).toBe(before);
  });

  it("lets the owner create the store and share it with the Provider", async () => {
    const user = userEvent.setup();
    let ownerStore: ReturnType<typeof Counter.useCreateRegionStore> | undefined;
    function Owner() {
      const store = Counter.useCreateRegionStore({ count: 3, label: "owner" });
      ownerStore = store;
      return (
        <Counter.Provider store={store}>
          <Display id="shared" />
          <Increment name="inc" />
        </Counter.Provider>
      );
    }
    render(<Owner />);
    await user.click(screen.getByRole("button", { name: "inc" }));
    expect(screen.getByTestId("shared")).toHaveTextContent("4");
    act(() => ownerStore?.actions.increment());
    expect(screen.getByTestId("shared")).toHaveTextContent("5");
    expect(ownerStore?.get().label).toBe("owner");
  });

  it("reads initial once per mount: a new initial prop does not reset the state", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Instance id="a" initial={{ count: 1, label: "a" }} />);
    await user.click(screen.getByRole("button", { name: "inc-a" }));
    rerender(<Instance id="a" initial={{ count: 100, label: "z" }} />);
    expect(screen.getByTestId("a")).toHaveTextContent("2");
  });

  it("throws clear errors outside a Provider and without store or initial", () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Display id="x" />)).toThrow("Counter: region hook used outside its Provider");
    expect(() =>
      render(
        <Counter.Provider>
          <span />
        </Counter.Provider>,
      ),
    ).toThrow("Counter: Provider needs a store or an initial state");
    silence.mockRestore();
  });

  it("keeps one store and its state under StrictMode, with a pure lazy initial", async () => {
    const user = userEvent.setup();
    let calls = 0;
    const initial = () => {
      calls += 1;
      return { count: 5, label: "lazy" };
    };
    const { rerender } = render(
      <StrictMode>
        <Instance id="a" initial={initial} />
      </StrictMode>,
    );
    expect(calls).toBeLessThanOrEqual(2);
    expect(screen.getByTestId("a")).toHaveTextContent("5");
    await user.click(screen.getByRole("button", { name: "inc-a" }));
    rerender(
      <StrictMode>
        <Instance id="a" initial={initial} />
      </StrictMode>,
    );
    expect(screen.getByTestId("a")).toHaveTextContent("6");
    expect(calls).toBeLessThanOrEqual(2);
  });

  it("renders on the server without a window", () => {
    expect(renderToString(<Instance id="a" initial={{ count: 7, label: "s" }} />)).toContain("7");
  });
});
