import { describe, expect, it } from "bun:test";
import { InjectionManager } from "./injection-manager.js";

describe("InjectionManager", () => {
  describe("touchInjections", () => {
    it("returns true when a new injection is registered", () => {
      const manager = new InjectionManager();
      const result = manager.touchInjections("session", [
        { snippetName: "safe", content: "Be careful" },
      ]);
      expect(result).toBe(true);
    });

    it("returns false when an existing injection is touched again", () => {
      const manager = new InjectionManager();
      manager.touchInjections("session", [{ snippetName: "safe", content: "Be careful" }]);
      const result = manager.touchInjections("session", [
        { snippetName: "safe", content: "Be careful" },
      ]);
      expect(result).toBe(false);
    });

    it("returns false for empty injections", () => {
      const manager = new InjectionManager();
      expect(manager.touchInjections("session", [])).toBe(false);
    });
  });

  describe("registerAndGetNew", () => {
    it("returns newly registered injections", () => {
      const manager = new InjectionManager();
      const newOnes = manager.registerAndGetNew("session", [
        { snippetName: "safe", content: "Be careful" },
      ]);
      expect(newOnes).toHaveLength(1);
      expect(newOnes[0]?.snippetName).toBe("safe");
    });

    it("returns empty array for already-registered injections", () => {
      const manager = new InjectionManager();
      manager.registerAndGetNew("session", [{ snippetName: "safe", content: "Be careful" }]);
      const newOnes = manager.registerAndGetNew("session", [
        { snippetName: "safe", content: "Be careful" },
      ]);
      expect(newOnes).toHaveLength(0);
    });

    it("returns only the new ones when mixing new and existing", () => {
      const manager = new InjectionManager();
      manager.registerAndGetNew("session", [{ snippetName: "a", content: "A" }]);
      const newOnes = manager.registerAndGetNew("session", [
        { snippetName: "a", content: "A" },
        { snippetName: "b", content: "B" },
      ]);
      expect(newOnes).toHaveLength(1);
      expect(newOnes[0]?.snippetName).toBe("b");
    });
  });

  describe("getRenderableInjections - placement", () => {
    it("places injection at max(0, messageCount - recencyWindow)", () => {
      const manager = new InjectionManager();
      manager.touchInjections("session", [{ snippetName: "safe", content: "Be careful" }]);

      const result = manager.getRenderableInjections("session", 10, 5);

      expect(result.injections).toHaveLength(1);
      expect(result.injections[0]?.targetPosition).toBe(5); // 10 - 5
    });

    it("clamps to position 0 when conversation is shorter than recency window", () => {
      const manager = new InjectionManager();
      manager.touchInjections("session", [{ snippetName: "safe", content: "Be careful" }]);

      const result = manager.getRenderableInjections("session", 3, 5);

      expect(result.injections).toHaveLength(1);
      expect(result.injections[0]?.targetPosition).toBe(0); // max(0, 3-5)
    });

    it("position moves up as conversation grows", () => {
      const manager = new InjectionManager();
      manager.touchInjections("session", [{ snippetName: "safe", content: "Be careful" }]);

      const at6 = manager.getRenderableInjections("session", 6, 5);
      const at10 = manager.getRenderableInjections("session", 10, 5);
      const at20 = manager.getRenderableInjections("session", 20, 5);

      expect(at6.injections[0]?.targetPosition).toBe(1); // 6-5
      expect(at10.injections[0]?.targetPosition).toBe(5); // 10-5
      expect(at20.injections[0]?.targetPosition).toBe(15); // 20-5
    });

    it("all injections share the same target position", () => {
      const manager = new InjectionManager();
      manager.touchInjections("session", [
        { snippetName: "a", content: "A" },
        { snippetName: "b", content: "B" },
      ]);

      const result = manager.getRenderableInjections("session", 10, 5);

      expect(result.injections).toHaveLength(2);
      expect(result.injections[0]?.targetPosition).toBe(5);
      expect(result.injections[1]?.targetPosition).toBe(5);
    });

    it("maintains injection order by registration time", () => {
      const manager = new InjectionManager();
      manager.touchInjections("session", [{ snippetName: "first", content: "First" }]);
      manager.touchInjections("session", [{ snippetName: "second", content: "Second" }]);

      const result = manager.getRenderableInjections("session", 10, 5);

      expect(result.injections.map((i) => i.snippetName)).toEqual(["first", "second"]);
    });

    it("returns empty when no injections exist", () => {
      const manager = new InjectionManager();

      const result = manager.getRenderableInjections("session", 10, 5);

      expect(result.injections).toHaveLength(0);
      expect(result.newlyRegistered).toHaveLength(0);
    });

    it("treats recencyWindow=0 as recencyWindow=1", () => {
      const manager = new InjectionManager();
      manager.touchInjections("session", [{ snippetName: "safe", content: "Be careful" }]);

      const result = manager.getRenderableInjections("session", 10, 0);

      expect(result.injections[0]?.targetPosition).toBe(9); // 10 - max(1,0) = 9
    });

    it("isolates sessions from each other", () => {
      const manager = new InjectionManager();
      manager.touchInjections("session-a", [{ snippetName: "a", content: "A" }]);
      manager.touchInjections("session-b", [{ snippetName: "b", content: "B" }]);

      const resultA = manager.getRenderableInjections("session-a", 10, 5);
      const resultB = manager.getRenderableInjections("session-b", 10, 5);

      expect(resultA.injections).toHaveLength(1);
      expect(resultA.injections[0]?.snippetName).toBe("a");
      expect(resultB.injections).toHaveLength(1);
      expect(resultB.injections[0]?.snippetName).toBe("b");
    });
  });

  describe("clearSession", () => {
    it("removes all injections for a session", () => {
      const manager = new InjectionManager();
      manager.touchInjections("session", [{ snippetName: "safe", content: "Be careful" }]);
      manager.clearSession("session");

      const result = manager.getRenderableInjections("session", 10, 5);

      expect(result.injections).toHaveLength(0);
    });

    it("does not affect other sessions", () => {
      const manager = new InjectionManager();
      manager.touchInjections("keep", [{ snippetName: "a", content: "A" }]);
      manager.touchInjections("clear", [{ snippetName: "b", content: "B" }]);
      manager.clearSession("clear");

      expect(manager.getRenderableInjections("keep", 10, 5).injections).toHaveLength(1);
      expect(manager.getRenderableInjections("clear", 10, 5).injections).toHaveLength(0);
    });
  });
});
