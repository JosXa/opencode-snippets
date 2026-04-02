import { describe, expect, it } from "bun:test";
import { InjectionManager } from "./injection-manager.js";

describe("InjectionManager", () => {
  it("injects new snippet context immediately", () => {
    const manager = new InjectionManager();
    manager.touchInjections("session", [{ snippetName: "safe", content: "Be careful" }]);

    const result = manager.getRenderableInjections("session", 3, 5);

    expect(result.reinjected).toHaveLength(1);
    expect(result.reinjected[0]?.snippetName).toBe("safe");
    expect(result.reinjected[0]?.lastInjectedMessageCount).toBe(3);
    expect(result.injections).toHaveLength(1);
  });

  it("does not refresh again inside the recency window", () => {
    const manager = new InjectionManager();
    manager.touchInjections("session", [{ snippetName: "safe", content: "Be careful" }]);
    manager.getRenderableInjections("session", 3, 5);

    const result = manager.getRenderableInjections("session", 7, 5);

    expect(result.reinjected).toHaveLength(0);
    expect(result.injections).toHaveLength(1);
    expect(result.injections[0]?.lastInjectedMessageCount).toBe(3);
  });

  it("refreshes again once the recency window is reached", () => {
    const manager = new InjectionManager();
    manager.touchInjections("session", [{ snippetName: "safe", content: "Be careful" }]);
    manager.getRenderableInjections("session", 3, 5);

    const result = manager.getRenderableInjections("session", 8, 5);

    expect(result.reinjected).toHaveLength(1);
    expect(result.reinjected[0]?.lastInjectedMessageCount).toBe(8);
    expect(result.injections[0]?.lastInjectedMessageCount).toBe(8);
  });

  it("touching an existing injection forces it to move to the newest position", () => {
    const manager = new InjectionManager();
    manager.touchInjections("session", [{ snippetName: "safe", content: "Be careful" }]);
    manager.getRenderableInjections("session", 3, 5);

    manager.touchInjections("session", [{ snippetName: "safe", content: "Be careful" }]);
    const result = manager.getRenderableInjections("session", 4, 5);

    expect(result.reinjected).toHaveLength(1);
    expect(result.injections[0]?.lastInjectedMessageCount).toBe(4);
  });

  it("keeps multiple injections ordered by their injected message position", () => {
    const manager = new InjectionManager();
    manager.touchInjections("session", [{ snippetName: "a", content: "A" }]);
    manager.getRenderableInjections("session", 1, 5);

    manager.touchInjections("session", [{ snippetName: "b", content: "B" }]);
    const result = manager.getRenderableInjections("session", 4, 5);

    expect(result.injections.map((item) => item.snippetName)).toEqual(["a", "b"]);
  });
});
