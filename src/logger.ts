import { writeFileSync, mkdirSync, existsSync } from "fs"
import { join } from "path"
import { OPENCODE_CONFIG_DIR } from "./constants.js"

/**
 * Check if debug logging is enabled via environment variable
 */
function isDebugEnabled(): boolean {
    const value = process.env.DEBUG_SNIPPETS
    return value === "1" || value === "true"
}

export class Logger {
    private logDir: string

    constructor() {
        this.logDir = join(OPENCODE_CONFIG_DIR, "logs", "snippets")
    }

    private get enabled(): boolean {
        return isDebugEnabled()
    }

    private ensureLogDir() {
        if (!existsSync(this.logDir)) {
            mkdirSync(this.logDir, { recursive: true })
        }
    }

    private formatData(data?: any): string {
        if (!data) return ""

        const parts: string[] = []
        for (const [key, value] of Object.entries(data)) {
            if (value === undefined || value === null) continue

            // Format arrays compactly
            if (Array.isArray(value)) {
                if (value.length === 0) continue
                parts.push(`${key}=[${value.slice(0, 3).join(",")}${value.length > 3 ? `...+${value.length - 3}` : ""}]`)
            }
            else if (typeof value === 'object') {
                const str = JSON.stringify(value)
                if (str.length < 50) {
                    parts.push(`${key}=${str}`)
                }
            }
            else {
                parts.push(`${key}=${value}`)
            }
        }
        return parts.join(" ")
    }

    private getCallerFile(): string {
        const originalPrepareStackTrace = Error.prepareStackTrace
        try {
            const err = new Error()
            Error.prepareStackTrace = (_, stack) => stack
            const stack = err.stack as unknown as NodeJS.CallSite[]
            Error.prepareStackTrace = originalPrepareStackTrace

            for (let i = 3; i < stack.length; i++) {
                const filename = stack[i]?.getFileName()
                if (filename && !filename.includes('logger.')) {
                    const match = filename.match(/([^/\\]+)\.[tj]s$/)
                    return match ? match[1] : 'unknown'
                }
            }
            return 'unknown'
        } catch {
            return 'unknown'
        }
    }

    private write(level: string, component: string, message: string, data?: any) {
        if (!this.enabled) return

        try {
            this.ensureLogDir()

            const timestamp = new Date().toISOString()
            const dataStr = this.formatData(data)

            const dailyLogDir = join(this.logDir, "daily")
            if (!existsSync(dailyLogDir)) {
                mkdirSync(dailyLogDir, { recursive: true })
            }

            const logLine = `${timestamp} ${level.padEnd(5)} ${component}: ${message}${dataStr ? " | " + dataStr : ""}\n`

            const logFile = join(dailyLogDir, `${new Date().toISOString().split('T')[0]}.log`)
            writeFileSync(logFile, logLine, { flag: "a" })
        } catch (error) {
            // Silent fail
        }
    }

    info(message: string, data?: any) {
        const component = this.getCallerFile()
        this.write("INFO", component, message, data)
    }

    debug(message: string, data?: any) {
        const component = this.getCallerFile()
        this.write("DEBUG", component, message, data)
    }

    warn(message: string, data?: any) {
        const component = this.getCallerFile()
        this.write("WARN", component, message, data)
    }

    error(message: string, data?: any) {
        const component = this.getCallerFile()
        this.write("ERROR", component, message, data)
    }
}

// Export singleton logger instance
export const logger = new Logger()
