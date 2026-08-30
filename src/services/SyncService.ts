import { supabase } from '../lib/supabase';
import { OrderRecord, ProductItem, StaffMember } from '../types';
import { mapCatalogProductRowToProductItem, mapStaffRowToStaffMember } from '../lib/mappers';

export type SyncStatus = 'SYNCED' | 'SYNCING' | 'OFFLINE' | 'ERROR';
export type RealtimeStatus = 'CONNECTING' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';

export interface SyncLogEntry {
  id: string;
  deviceId: string;
  businessId: string;
  direction: 'UP' | 'DOWN' | 'BROADCAST';
  entityType: 'order' | 'product' | 'staff' | 'branch' | 'device' | 'config' | 'all';
  entityId: string;
  operation: 'UPSERT' | 'DELETE' | 'FETCH' | 'STATUS_CHANGE';
  timestamp: string;
  status: 'SUCCESS' | 'FAILURE';
  error?: string;
}

export interface SyncListenerCallbacks {
  onOrdersUpdated?: (orders: OrderRecord[]) => void;
  onProductsUpdated?: (products: ProductItem[]) => void;
  onStaffUpdated?: (staff: StaffMember[]) => void;
  onStatusChanged?: (status: SyncStatus) => void;
  onLogAdded?: (log: SyncLogEntry) => void;
}

const browserReadOnlyDeviceId = 'browser-readonly-shell';
const nativeHubRequiredMessage = 'Cloud writes and local multi-device delivery are owned by the authenticated Android-native Cashier Hub.';

/**
 * Read-only cloud replica client for the web shell.
 *
 * It intentionally does not use BroadcastChannel, browser device IDs, direct
 * table writes, or an optimistic "synced" state. The native Hub persists a
 * command locally first and then performs authenticated cloud replication.
 */
export class SyncService {
  private status: SyncStatus = 'OFFLINE';
  private businessId = '';
  private branchId = '';
  private logs: SyncLogEntry[] = [];
  private listeners: SyncListenerCallbacks[] = [];
  private realtimeStatus: RealtimeStatus = 'CLOSED';

  public setBusinessContext(businessId: string, branchId: string) {
    this.businessId = businessId || '';
    this.branchId = branchId || '';
  }

  public getStatus(): SyncStatus {
    return this.status;
  }

  public getRealtimeStatus(): RealtimeStatus {
    return this.realtimeStatus;
  }

  public getLogs(): SyncLogEntry[] {
    return [...this.logs];
  }

  public subscribe(callbacks: SyncListenerCallbacks) {
    this.listeners.push(callbacks);
    return () => {
      this.listeners = this.listeners.filter((listener) => listener !== callbacks);
    };
  }

  public async logAuditEvent(event: {
    eventType: string;
    entityId: string;
    actorId: string;
    details?: Record<string, unknown>;
  }): Promise<boolean> {
    this.recordBlockedWrite('all', event.entityId, 'UPSERT', `Audit event ${event.eventType} was not written: ${nativeHubRequiredMessage}`);
    return false;
  }

  public async syncOrder(_: OrderRecord, operation: 'UPSERT' | 'STATUS_CHANGE' = 'UPSERT', __?: string): Promise<boolean> {
    this.recordBlockedWrite('order', 'native-hub-command-required', operation);
    return false;
  }

  public async syncProducts(_: ProductItem[], singleProduct?: ProductItem): Promise<boolean> {
    this.recordBlockedWrite('product', singleProduct?.id || 'products-batch', 'UPSERT');
    return false;
  }

  public async syncStaff(_: StaffMember[], singleMember?: StaffMember): Promise<boolean> {
    this.recordBlockedWrite('staff', singleMember?.id || 'staff-batch', 'UPSERT');
    return false;
  }

  public async fetchAndSyncOrders(): Promise<OrderRecord[]> {
    if (!this.requireBusinessContext('order', 'orders-fetch')) return [];
    this.notifyStatus('SYNCING');

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('business_id', this.businessId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const orders = (data || []).map((row: any): OrderRecord => ({
        id: row.id,
        businessId: row.business_id,
        branchId: row.branch_id,
        deviceId: row.device_id,
        cashierId: row.cashier_id,
        cashierName: row.cashier_name,
        customerName: row.customer_name || undefined,
        customerPhone: row.customer_phone || undefined,
        subtotal: row.subtotal || row.total_amount,
        tax: row.tax || 0,
        total: row.total_amount,
        totalAmount: row.total_amount,
        paymentMethod: row.payment_method || 'CASH',
        paymentType: row.payment_method || 'CASH',
        status: row.status,
        items: [],
        createdAt: row.created_at,
        updatedAt: row.updated_at || row.created_at
      }));

      this.listeners.forEach((listener) => listener.onOrdersUpdated?.(orders));
      this.record('DOWN', 'order', 'orders-fetch', 'FETCH', 'SUCCESS');
      this.notifyStatus('SYNCED');
      return orders;
    } catch (cause: any) {
      this.record('DOWN', 'order', 'orders-fetch', 'FETCH', 'FAILURE', this.errorMessage(cause));
      this.notifyStatus('ERROR');
      return [];
    }
  }

  public async fetchAndSyncProducts(): Promise<ProductItem[]> {
    if (!this.requireBusinessContext('product', 'products-fetch')) return [];
    this.notifyStatus('SYNCING');

    try {
      const { data, error } = await supabase
        .from('catalog_products')
        .select('*')
        .eq('business_id', this.businessId);

      if (error) throw error;
      const products = (data || []).map(mapCatalogProductRowToProductItem);
      this.listeners.forEach((listener) => listener.onProductsUpdated?.(products));
      this.record('DOWN', 'product', 'products-fetch', 'FETCH', 'SUCCESS');
      this.notifyStatus('SYNCED');
      return products;
    } catch (cause: any) {
      this.record('DOWN', 'product', 'products-fetch', 'FETCH', 'FAILURE', this.errorMessage(cause));
      this.notifyStatus('ERROR');
      return [];
    }
  }

  public async fetchAndSyncStaff(): Promise<StaffMember[]> {
    if (!this.requireBusinessContext('staff', 'staff-fetch')) return [];
    this.notifyStatus('SYNCING');

    try {
      const { data, error } = await supabase
        .from('staff_members')
        // R001 keeps an obsolete pin_hash column on this table. A browser
        // replica must never download it, even for an owner-authorized read.
        .select('id, name, role, branch_id, active_shift, performance_score')
        .eq('business_id', this.businessId);

      if (error) throw error;
      const staff = (data || []).map(mapStaffRowToStaffMember);
      this.listeners.forEach((listener) => listener.onStaffUpdated?.(staff));
      this.record('DOWN', 'staff', 'staff-fetch', 'FETCH', 'SUCCESS');
      this.notifyStatus('SYNCED');
      return staff;
    } catch (cause: any) {
      this.record('DOWN', 'staff', 'staff-fetch', 'FETCH', 'FAILURE', this.errorMessage(cause));
      this.notifyStatus('ERROR');
      return [];
    }
  }

  private requireBusinessContext(entityType: SyncLogEntry['entityType'], entityId: string): boolean {
    if (this.businessId) return true;
    this.record('DOWN', entityType, entityId, 'FETCH', 'FAILURE', 'No business context is available for this read-only cloud replica request.');
    this.notifyStatus('OFFLINE');
    return false;
  }

  private recordBlockedWrite(entityType: SyncLogEntry['entityType'], entityId: string, operation: SyncLogEntry['operation'], detail = nativeHubRequiredMessage) {
    this.record('UP', entityType, entityId, operation, 'FAILURE', detail);
    this.notifyStatus('OFFLINE');
  }

  private notifyStatus(status: SyncStatus) {
    this.status = status;
    this.listeners.forEach((listener) => listener.onStatusChanged?.(status));
  }

  private record(
    direction: SyncLogEntry['direction'],
    entityType: SyncLogEntry['entityType'],
    entityId: string,
    operation: SyncLogEntry['operation'],
    status: SyncLogEntry['status'],
    error?: string
  ) {
    const entry: SyncLogEntry = {
      id: `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      deviceId: browserReadOnlyDeviceId,
      businessId: this.businessId,
      direction,
      entityType,
      entityId,
      operation,
      timestamp: new Date().toISOString(),
      status,
      error
    };
    this.logs = [entry, ...this.logs].slice(0, 100);
    this.listeners.forEach((listener) => listener.onLogAdded?.(entry));
  }

  private errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
  }
}

export const syncService = new SyncService();
