import { createLogger } from '../../observability/logger';
import { ulid } from 'ulid';

const log = createLogger('NotificationService');

export type NotificationLevel = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';

export interface Notification {
  id: string;
  level: NotificationLevel;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export type NotificationHandler = (notification: Notification) => void;

export class NotificationService {
  private handlers: Set<NotificationHandler> = new Set();
  private history: Notification[] = [];

  public subscribe(handler: NotificationHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  public notify(level: NotificationLevel, title: string, message: string): void {
    const notification: Notification = {
      id: ulid(),
      level,
      title,
      message,
      timestamp: new Date().toISOString(),
      read: false
    };

    this.history.push(notification);
    log.debug(`[${level}] ${title}: ${message}`);

    this.handlers.forEach(handler => {
      try {
        handler(notification);
      } catch (err: any) {
        log.error('Notification handler failed', { error: err.message });
      }
    });
  }

  public getUnread(): Notification[] {
    return this.history.filter(n => !n.read);
  }

  public markAsRead(id: string): void {
    const notification = this.history.find(n => n.id === id);
    if (notification) {
      notification.read = true;
    }
  }
}

export const notificationService = new NotificationService();
