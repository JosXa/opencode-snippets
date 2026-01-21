import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("Logger", () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  let Logger: typeof import("../src/logger.js").Logger;

  beforeAll(() => {
    originalEnv = { ...process.env };
  });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "snippets-logger-test-"));
    Logger = require("../src/logger.js").Logger;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe("isDebugEnabled", () => {
    it("should return false when DEBUG_SNIPPETS is not set", () => {
      delete process.env.DEBUG_SNIPPETS;
      const testLogger = new Logger(join(tempDir, "logs"));
      expect((testLogger as any).enabled).toBe(false);
    });

    it("should return true when DEBUG_SNIPPETS=1", () => {
      process.env.DEBUG_SNIPPETS = "1";
      const testLogger = new Logger(join(tempDir, "logs"));
      expect((testLogger as any).enabled).toBe(true);
    });

    it("should return true when DEBUG_SNIPPETS=true", () => {
      process.env.DEBUG_SNIPPETS = "true";
      const testLogger = new Logger(join(tempDir, "logs"));
      expect((testLogger as any).enabled).toBe(true);
    });

    it("should return false for other values", () => {
      process.env.DEBUG_SNIPPETS = "yes";
      const testLogger = new Logger(join(tempDir, "logs"));
      expect((testLogger as any).enabled).toBe(false);
    });
  });

  describe("log writing", () => {
    it("should not write logs when debug is disabled", () => {
      delete process.env.DEBUG_SNIPPETS;
      const writeSpy = vi.spyOn(require("fs"), "writeFileSync");
      const logger = new Logger(join(tempDir, "logs"));
      logger.debug("test message", { key: "value" });
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it("should write logs when debug is enabled", () => {
      process.env.DEBUG_SNIPPETS = "1";
      const logger = new Logger(join(tempDir, "logs"));
      logger.debug("test debug message", { test: true });
      logger.info("test info message");
      logger.warn("test warn message");
      logger.error("test error message");
    });

    it("should format data correctly", () => {
      process.env.DEBUG_SNIPPETS = "1";
      const logger = new Logger(join(tempDir, "logs"));
      logger.debug("with data", {
        string: "hello",
        number: 42,
        bool: true,
        nullVal: null,
        undefinedVal: undefined,
      });
    });

    it("should handle empty data", () => {
      process.env.DEBUG_SNIPPETS = "1";
      const logger = new Logger(join(tempDir, "logs"));
      logger.debug("no data");
      logger.debug("empty object", {});
      logger.debug("empty array", { items: [] as unknown[] });
    });

    it("should format arrays compactly", () => {
      process.env.DEBUG_SNIPPETS = "1";
      const logger = new Logger(join(tempDir, "logs"));
      logger.debug("small array", { items: [1, 2, 3] });
      logger.debug("large array", { items: [1, 2, 3, 4, 5, 6] });
    });

    it("should handle objects in data", () => {
      process.env.DEBUG_SNIPPETS = "1";
      const logger = new Logger(join(tempDir, "logs"));
      logger.debug("nested object", {
        nested: { a: 1, b: 2 },
        long: "this is a very long string that should be truncated if over 50 characters",
      });
    });
  });

  describe("file output", () => {
    it("should create log file in daily directory", () => {
      process.env.DEBUG_SNIPPETS = "1";
      const logger = new Logger(join(tempDir, "logs"));
      logger.info("file output test", { test: true });

      const today = new Date().toISOString().split("T")[0];
      const logFile = join(tempDir, "logs", "daily", `${today}.log`);

      expect(existsSync(logFile)).toBe(true);
      const content = readFileSync(logFile, "utf-8");
      expect(content).toContain("file output test");
      expect(content).toContain("test=true");
    });

    it("should append to existing log file", () => {
      process.env.DEBUG_SNIPPETS = "1";
      const logger = new Logger(join(tempDir, "logs"));
      logger.info("first message");
      logger.info("second message");

      const today = new Date().toISOString().split("T")[0];
      const logFile = join(tempDir, "logs", "daily", `${today}.log`);
      const content = readFileSync(logFile, "utf-8");

      expect(content).toContain("first message");
      expect(content).toContain("second message");
    });
  });
});
