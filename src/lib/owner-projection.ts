import { supabase } from './supabase';

export interface OwnerOrder {
  id: string; total_amount: number; status: string; payment_status: string;
  cashier_name: string | null; created_at: string;
}
export interface OwnerProduct {
  id: string; name: string; category: string; price: number; stock_quantity: number;
  unit_of_measure: string; status: string;
}
export interface OwnerProjection {
  businessId: string; branchId: string; orders: OwnerOrder[]; products: OwnerProduct[]; deviceCount: number; loadedAt: string;
}
export const tradingDay = (date: string | Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(date));
export const capturedOrder = (order: OwnerOrder) =>
  order.status !== 'CANCELLED' && ['CAPTURED', 'PAID'].includes(order.payment_status);
export function summarizeOwnerProjection(data: OwnerProjection, now = new Date()) {
  const today = tradingDay(now);
  const ordersToday = data.orders.filter(order => tradingDay(order.created_at) === today && order.status !== 'CANCELLED');
  return {
    salesToday: ordersToday.filter(capturedOrder).reduce((sum, order) => sum + Number(order.total_amount), 0),
    ordersToday: ordersToday.length,
    activeDevices: data.deviceCount,
    activeProducts: data.products.filter(product => product.status === 'ACTIVE').length,
    lowStockProducts: data.products.filter(product => product.status === 'ACTIVE' && Number(product.stock_quantity) < 10).length,
  };
}

/** Read the established R001 cloud projections under the current owner's RLS. */
export async function loadOwnerProjection(businessId: string, branchId: string): Promise<OwnerProjection> {
  const loadedAt = new Date().toISOString();
  const firstDay = tradingDay(new Date(Date.now() - 29 * 86400000));
  const from = `${firstDay}T00:00:00+02:00`;
  const readPages = async <T,>(table: string, columns: string, since?: string): Promise<T[]> => {
    const rows: T[] = [];
    for (let offset = 0; ; offset += 500) {
      let query = supabase.from(table).select(columns).eq('business_id', businessId).eq('branch_id', branchId)
        .order('id').range(offset, offset + 499);
      if (since) query = query.gte('created_at', since).lte('created_at', loadedAt);
      const result = await query;
      if (result.error) throw new Error(`Could not load ${table}: ${result.error.message}`);
      const page = result.data as unknown as T[];
      rows.push(...page);
      if (page.length < 500) return rows;
    }
  };
  const [orders, products, devices] = await Promise.all([
    readPages<OwnerOrder>('orders', 'id, total_amount, status, payment_status, cashier_name, created_at', from),
    readPages<OwnerProduct>('catalog_products', 'id, name, category, price, stock_quantity, unit_of_measure, status'),
    readPages<{id:string;status:string}>('devices', 'id, status'),
  ]);
  return {businessId, branchId, orders, products, deviceCount: devices.filter(device => device.status === 'ACTIVE').length, loadedAt};
}
