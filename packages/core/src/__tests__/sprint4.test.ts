import { describe, it, expect, beforeEach, vi } from 'vitest';
import { notificationService } from '../services/notifications';
import { metricsService } from '../services/metrics';
import { reportingService } from '../services/reporting';
import { storageEngine } from '../storage';
import { InMemoryStorageAdapter } from '../storage/adapters/in-memory';

describe('Phase 2 Sprint 4 - Observability & Notifications', () => {
  beforeEach(async () => {
    await storageEngine.mount(new InMemoryStorageAdapter());
    notificationService['history'] = [];
    notificationService['handlers'].clear();
  });

  it('NotificationService should broadcast and manage notifications', () => {
    const handler = vi.fn();
    notificationService.subscribe(handler);
    
    notificationService.notify('INFO', 'Test Alert', 'This is a test');
    
    expect(handler).toHaveBeenCalledTimes(1);
    const history = notificationService.getUnread();
    expect(history).toHaveLength(1);
    expect(history[0].title).toBe('Test Alert');
    
    notificationService.markAsRead(history[0].id);
    expect(notificationService.getUnread()).toHaveLength(0);
  });

  it('MetricsService should track counters and gauges', async () => {
    await metricsService.increment('orders_processed', 1);
    await metricsService.increment('orders_processed', 2);
    
    const count = await metricsService.getMetric('orders_processed');
    expect(count).toBe(3);

    await metricsService.setGauge('active_users', 42);
    const gauge = await metricsService.getMetric('active_users');
    expect(gauge).toBe(42);
  });

  it('ReportingService should query materialized views', async () => {
    await storageEngine.set('view_daily_sales', '2026-07-31', { total: 1500 });
    await storageEngine.set('view_daily_sales', '2026-08-01', { total: 2200 });

    const results = await reportingService.queryView('view_daily_sales');
    expect(results).toHaveLength(2);
    expect(results.find(r => r.total === 1500)).toBeDefined();
  });
});
