type LogLevel = 'debug' | 'info' | 'warn' | 'error'

function timestamp(): string {
  return new Date().toISOString()
}

function format(level: LogLevel, module: string, message: string): string {
  return `[${timestamp()}] [${level.toUpperCase()}] [${module}] ${message}`
}

export function createLogger(module: string) {
  return {
    debug: (message: string) => console.debug(format('debug', module, message)),
    info: (message: string) => console.info(format('info', module, message)),
    warn: (message: string) => console.warn(format('warn', module, message)),
    error: (message: string, err?: unknown) => {
      console.error(format('error', module, message))
      if (err instanceof Error) {
        console.error(err.stack ?? err.message)
      }
    },
  }
}
