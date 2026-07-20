import type { StructuredLogger } from '../application/ports';

type LogLevel = 'INFO' | 'ERROR';

export class PowertoolsStructuredLogger implements StructuredLogger {
  private readonly context: Record<string, string> = {};

  constructor(private readonly serviceName: string) {}

  addContext(context: Record<string, string>): void {
    Object.assign(this.context, context);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.write('INFO', message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.write('ERROR', message, metadata);
  }

  private write(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    const entry = {
      level,
      message,
      service: this.serviceName,
      timestamp: new Date().toISOString(),
      ...this.context,
      ...(metadata ?? {})
    };

    const line = `${JSON.stringify(entry)}\n`;

    if (level === 'ERROR') {
      process.stderr.write(line);
      return;
    }

    process.stdout.write(line);
  }
}