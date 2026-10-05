import {describe,expect,it,vi} from 'vitest';
vi.mock('./supabase',()=>({supabase:{}}));
import {capturedOrder,summarizeOwnerProjection,tradingDay,type OwnerProjection} from './owner-projection';

describe('existing Supabase owner records',()=>{
  it('uses South African dates and excludes unpaid/cancelled amounts',()=>{
    const order={id:'order',total_amount:28,status:'COLLECTED',payment_status:'CAPTURED',cashier_name:'Thandi',created_at:'2026-10-04T22:15:00Z'};
    const projection:OwnerProjection={businessId:'business',branchId:'branch',orders:[order,{...order,id:'unpaid',payment_status:'PENDING',total_amount:100},{...order,id:'cancelled',status:'CANCELLED',total_amount:150}],products:[],deviceCount:2,loadedAt:'2026-10-05T08:00:00Z'};
    expect(tradingDay(order.created_at)).toBe('2026-10-05');
    expect(summarizeOwnerProjection(projection,new Date('2026-10-05T12:00:00Z'))).toMatchObject({salesToday:28,ordersToday:2,activeDevices:2});
    expect(capturedOrder({...order,payment_status:'PENDING'})).toBe(false);
  });
});
