import { StaffMember, ProductItem, Branch } from '../types';

export function mapStaffRowToStaffMember(row: any): StaffMember {
  return {
    id: row.id,
    name: row.name,
    email: row.email || undefined,
    role: row.role,
    status: row.status || undefined,
    branchId: row.branch_id || row.branchId || '',
    branchName: row.branchName || undefined,
    activeShift: row.active_shift ?? row.activeShift ?? false,
    performanceScore: row.performance_score ?? row.performanceScore ?? 100
  };
}

export function mapCatalogProductRowToProductItem(row: any): ProductItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: typeof row.price === 'number' ? row.price : parseFloat(row.price) || 0,
    domain: row.domain || 'fastfood-domain',
    description: row.description || '',
    stock: row.stock_quantity ?? row.stock ?? 0,
    unit: row.unit_of_measure ?? row.unit ?? 'Each',
    costPrice: row.cost_price != null ? Number(row.cost_price) : (row.costPrice != null ? Number(row.costPrice) : undefined),
    branchId: row.branch_id || row.branchId,
    status: row.status || 'ACTIVE'
  };
}

export function mapBranchRowToBranch(row: any): Branch {
  return {
    id: row.id,
    name: row.name,
    location: row.location || '',
    domain: row.domain || 'fastfood-domain',
    isActive: row.is_active ?? row.isActive ?? true
  };
}
