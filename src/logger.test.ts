import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { Logger } from "./logger.js";

describe("Logger", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "snippets-logger-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("debugEnabled", () => {
    it("should default to false", () => {
      const logger = new Logger(join(tempDir, "logs"));
      expect(logger.debugEnabled).toBe(false);
    });

    it("should be settable via constructor", () => {
      const logger = new Logger(join(tempDir, "logs"), true);
      expect(logger.debugEnabled).toBe(true);
    });

    it("should be settable via property", () => {
      const logger = new Logger(join(tempDir, "logs"));
      logger.debugEnabled = true;
      expect(logger.debugEnabled).toBe(true);
    });
  });

  describe("log writing", () => {
    it("should not write debug logs when debugEnabled is false", () => {
      const logger = new Logger(join(tempDir, "logs"));
      logger.debug("test message", { key: "value" });

      const today = new Date().toISOString().split("T")[0];
      const logFile = join(tempDir, "logs", "daily", `${today}.log`);
      expect(existsSync(logFile)).toBe(false);
    });

    it("should write debug logs when debugEnabled is true", () => {
      const logger = new Logger(join(tempDir, "logs"), true);
      logger.debug("test debug message", { test: true });

      const today = new Date().toISOString().split("T")[0];
      const logFile = join(tempDir, "logs", "daily", `${today}.log`);
      expect(existsSync(logFile)).toBe(true);
      expect(readFileSync(logFile, "utf-8")).toContain("test debug message");
    });

    it("should always write info/warn/error even when debugEnabled is false", () => {
      const logger = new Logger(join(tempDir, "logs"));
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");

      const today = new Date().toISOString().split("T")[0];
      const logFile = join(tempDir, "logs", "daily", `${today}.log`);
      expect(existsSync(logFile)).toBe(true);
      const content = readFileSync(logFile, "utf-8");
      expect(content).toContain("info message");
      expect(content).toContain("warn message");
      expect(content).toContain("error message");
    });

    it("should format data correctly", () => {
      const logger = new Logger(join(tempDir, "logs"), true);
      logger.debug("with data", {
        string: "hello",
        number: 42,
        bool: true,
        nullVal: null,
        undefinedVal: undefined,
      });

      const today = new Date().toISOString().split("T")[0];
      const logFile = join(tempDir, "logs", "daily", `${today}.log`);
      const content = readFileSync(logFile, "utf-8");
      expect(content).toContain("string=hello");
      expect(content).toContain("number=42");
      expect(content).toContain("bool=true");
    });

    it("should handle empty data", () => {
      const logger = new Logger(join(tempDir, "logs"), true);
      logger.debug("no data");
      logger.debug("empty object", {});
      logger.debug("empty array", { items: [] as unknown[] });

      const today = new Date().toISOString().split("T")[0];
      const logFile = join(tempDir, "logs", "daily", `${today}.log`);
      expect(existsSync(logFile)).toBe(true);
    });

    it("should format arrays compactly", () => {
      const logger = new Logger(join(tempDir, "logs"), true);
      logger.debug("small array", { items: [1, 2, 3] });
      logger.debug("large array", { items: [1, 2, 3, 4, 5, 6] });

      const today = new Date().toISOString().split("T")[0];
      const logFile = join(tempDir, "logs", "daily", `${today}.log`);
      const content = readFileSync(logFile, "utf-8");
      expect(content).toContain("items=[1,2,3]");
      expect(content).toContain("items=[1,2,3...+3]");
    });
  });

  describe("file output", () => {
    it("should create log file in daily directory", () => {
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

describe("default log directory", () => {
  it("writes to the XDG data directory even when OpenCode's config directory is set", () => {
    const home = mkdtempSync(join(tmpdir(), "snippets-data-test-"));
    const oldDataHome = process.env.XDG_DATA_HOME;
    const oldConfigDir = process.env.OPENCODE_CONFIG_DIR;
    try {
      process.env.XDG_DATA_HOME = join(home, "data");
      process.env.OPENCODE_CONFIG_DIR = join(home, "config");
      new Logger().info("data directory test");

      const today = new Date().toISOString().split("T")[0];
      const logFile = join(home, "data", "opencode", "log", "snippets", "daily", `${today}.log`);
      expect(readFileSync(logFile, "utf-8")).toContain("data directory test");
      expect(existsSync(join(home, "config", "logs", "snippets"))).toBe(false);
    } finally {
      if (oldDataHome === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = oldDataHome;
      if (oldConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR;
      else process.env.OPENCODE_CONFIG_DIR = oldConfigDir;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("uses the user's data directory when XDG_DATA_HOME is unset", () => {
    const oldDataHome = process.env.XDG_DATA_HOME;
    try {
      delete process.env.XDG_DATA_HOME;
      expect(new Logger()).toHaveProperty(
        "logDir",
        join(homedir(), ".local", "share", "opencode", "log", "snippets"),
      );
    } finally {
      if (oldDataHome !== undefined) process.env.XDG_DATA_HOME = oldDataHome;
    }
  });
});
