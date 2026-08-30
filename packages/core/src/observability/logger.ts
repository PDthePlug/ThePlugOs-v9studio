export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LogEntry {
  timestamp: string;
  traceId?: string;
  component: string;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
}

export class Logger {
  private component: string;
  private traceId?: string;

  constructor(component: string, traceId?: string) {
    this.component = component;
    this.traceId = traceId;
  }

  public withTrace(traceId: string): Logger {
    return new Logger(this.component, traceId);
  }

  private log(level: LogLevel, message: string, context?: Record<string, any>) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      traceId: this.traceId,
      component: this.component,
      level,
      message,
      context,
    };

    // In a real environment, this might write to IndexedDB or stream to cloud
    const formattedMessage = `[${entry.timestamp}]${entry.traceId ? `[${entry.traceId}]` : ''}[${entry.component}][${entry.level}] ${entry.message}`;
    
    switch (level) {
      case 'DEBUG': console.debug(formattedMessage, context || ''); break;
      case 'INFO': console.info(formattedMessage, context || ''); break;
      case 'WARN': console.warn(formattedMessage, context || ''); break;
      case 'ERROR': console.error(formattedMessage, context || ''); break;
      case 'FATAL': console.error(`FATAL: ${formattedMessage}`, context || ''); break;
    }
  }

  public debug(message: string, context?: Record<string, any>) { this.log('DEBUG', message, context); }
  public info(message: string, context?: Record<string, any>) { this.log('INFO', message, context); }
  public warn(message: string, context?: Record<string, any>) { this.log('WARN', message, context); }
  public error(message: string, context?: Record<string, any>) { this.log('ERROR', message, context); }
  public fatal(message: string, context?: Record<string, any>) { this.log('FATAL', message, context); }
}

export const createLogger = (component: string) => new Logger(component);
