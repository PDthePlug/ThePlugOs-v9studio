// Domain entry point
export const domain = "fastfood-domain";

export const reducers = {
  order: (state: any, event: any) => {
    const s = state || { status: 'PENDING', items: [], total: 0 };
    if (event.action === 'ORDER_PLACED') {
      s.items = event.payload.items;
      s.total = event.payload.total;
    } else if (event.action === 'PAYMENT_RECEIVED') {
      s.status = 'PREP';
    } else if (event.action === 'ORDER_PREPARED') {
      s.status = 'READY';
    }
    return s;
  },
  inventory: (state: any, event: any) => {
    const s = state || { item_id: event.entityId, quantity: 100 };
    if (event.action === 'INVENTORY_DEPLETED') {
      s.quantity -= event.payload.quantity;
    }
    return s;
  }
};
