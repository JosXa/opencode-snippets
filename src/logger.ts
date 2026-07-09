import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { PATHS } from "./constants.js";

export class Logger {
  private logDir: string;
  debugEnabled: boolean;
  /**
   * When true, every log call is a no-op. Used by the exported singleton under
   * test to avoid synchronous disk I/O (which is slow and flaky under load) and
   * to keep the test suite from polluting the real ~/.config/opencode log dir.
   * Explicitly-constructed Logger instances (e.g. in logger.test.ts) stay active.
   */
  private silent: boolean;

  constructor(logDirOverride?: string, debugEnabled = false, silent = false) {
    this.logDir = logDirOverride ?? join(PATHS.CONFIG_DIR, "logs", "snippets");
    this.debugEnabled = debugEnabled;
    this.silent = silent;
  }

  private ensureLogDir() {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  private formatData(data?: Record<string, unknown>): string {
    if (!data) return "";

    const parts: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) continue;

      // Format arrays compactly
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        parts.push(
          `${key}=[${value.slice(0, 3).join(",")}${value.length > 3 ? `...+${value.length - 3}` : ""}]`,
        );
      } else if (typeof value === "object") {
        const str = JSON.stringify(value);
        if (str.length < 50) {
          parts.push(`${key}=${str}`);
        }
      } else {
        parts.push(`${key}=${value}`);
      }
    }
    return parts.join(" ");
  }

  private getCallerFile(): string {
    const originalPrepareStackTrace = Error.prepareStackTrace;
    try {
      const err = new Error();
      Error.prepareStackTrace = (_, stack) => stack;
      const stack = err.stack as unknown as NodeJS.CallSite[];
      Error.prepareStackTrace = originalPrepareStackTrace;

      for (let i = 3; i < stack.length; i++) {
        const filename = stack[i]?.getFileName();
        if (filename && !filename.includes("logger.")) {
          const match = filename.match(/([^/\\]+)\.[tj]s$/);
          return match ? match[1] : "unknown";
        }
      }
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  private write(level: string, component: string, message: string, data?: Record<string, unknown>) {
    if (this.silent) return;
    // Only write debug logs when debugEnabled, but always write other levels
    if (level === "DEBUG" && !this.debugEnabled) return;

    try {
      this.ensureLogDir();

      const timestamp = new Date().toISOString();
      const dataStr = this.formatData(data);

      const dailyLogDir = join(this.logDir, "daily");
      if (!existsSync(dailyLogDir)) {
        mkdirSync(dailyLogDir, { recursive: true });
      }

      const logLine = `${timestamp} ${level.padEnd(5)} ${component}: ${message}${dataStr ? ` | ${dataStr}` : ""}\n`;

      const logFile = join(dailyLogDir, `${new Date().toISOString().split("T")[0]}.log`);
      writeFileSync(logFile, logLine, { flag: "a" });
    } catch {
      // Silent fail
    }
  }

  info(message: string, data?: Record<string, unknown>) {
    const component = this.getCallerFile();
    this.write("INFO", component, message, data);
  }

  debug(message: string, data?: Record<string, unknown>) {
    const component = this.getCallerFile();
    this.write("DEBUG", component, message, data);
  }

  warn(message: string, data?: Record<string, unknown>) {
    const component = this.getCallerFile();
    this.write("WARN", component, message, data);
  }

  error(message: string, data?: Record<string, unknown>) {
    const component = this.getCallerFile();
    this.write("ERROR", component, message, data);
  }
}

// Export singleton logger instance. Silenced under `bun test` (NODE_ENV=test) so
// production hot paths that log (e.g. snippet loop detection) don't perform
// synchronous disk writes during tests.
export const logger = new Logger(undefined, false, process.env.NODE_ENV === "test");
