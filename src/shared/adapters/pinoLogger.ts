import pino from "pino";
import { Logger, LogContext } from "../ports/Logger";

type PinoInstance = pino.Logger;

export class PinoLogger implements Logger {
  constructor(private readonly instance: PinoInstance) {}

  debug(msg: string, ctx?: LogContext): void {
    this.instance.debug(ctx ?? {}, msg);
  }

  info(msg: string, ctx?: LogContext): void {
    this.instance.info(ctx ?? {}, msg);
  }

  warn(msg: string, ctx?: LogContext): void {
    this.instance.warn(ctx ?? {}, msg);
  }

  error(msg: string, ctx?: LogContext): void {
    this.instance.error(ctx ?? {}, msg);
  }

  child(bindings: LogContext): Logger {
    return new PinoLogger(this.instance.child(bindings));
  }
}

export function createPinoLogger(): Logger {
  const instance = pino({
    level: process.env.LOG_LEVEL || "info",
    base: { service: "reconciliation-backend" },
  });
  return new PinoLogger(instance);
}
