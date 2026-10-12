import { supabase } from './supabase';
import type { StaffMember, UserRole } from '../types';

export interface OwnerCatalogInput {
  name: string;
  category: string;
  price: number;
  description?: string;
  unitOfMeasure: string;
  costPrice?: number | null;
}

const OPERATIONAL_STAFF_ROLES: UserRole[] = ['CASHIER', 'KITCHEN_STAFF', 'MANAGER'];

const cleanText = (value: string, max = 160) => value.trim().replace(/\s+/g, ' ').slice(0, max);

function requireMoney(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) throw new Error(`${field} is invalid.`);
  return Number(value.toFixed(2));
}

export async function createOwnerCatalogProduct(
  businessId: string,
  branchId: string,
  input: OwnerCatalogInput,
) {
  const name = cleanText(input.name, 140);
  const category = cleanText(input.category, 80);
  const description = cleanText(input.description || '', 500);
  const unit = cleanText(input.unitOfMeasure, 40) || 'Each';
  if (!name || !category) throw new Error('Name and category are required.');
  const price = requireMoney(input.price, 'Price');
  const costPrice = input.costPrice == null ? null : requireMoney(input.costPrice, 'Cost price');

  const { error } = await supabase.from('catalog_products').insert({
    business_id: businessId,
    branch_id: branchId,
    name,
    category,
    price,
    description: description || null,
    unit_of_measure: unit,
    cost_price: costPrice,
    status: 'ACTIVE',
  });
  if (error) throw new Error(`The menu item could not be created: ${error.message}`);
}

export async function updateOwnerCatalogProduct(
  businessId: string,
  branchId: string,
  productId: string,
  input: OwnerCatalogInput,
) {
  const name = cleanText(input.name, 140);
  const category = cleanText(input.category, 80);
  const description = cleanText(input.description || '', 500);
  const unit = cleanText(input.unitOfMeasure, 40) || 'Each';
  if (!name || !category) throw new Error('Name and category are required.');
  const price = requireMoney(input.price, 'Price');
  const costPrice = input.costPrice == null ? null : requireMoney(input.costPrice, 'Cost price');

  const { error } = await supabase.from('catalog_products').update({
    name,
    category,
    price,
    description: description || null,
    unit_of_measure: unit,
    cost_price: costPrice,
  }).eq('id', productId).eq('business_id', businessId).eq('branch_id', branchId);
  if (error) throw new Error(`The menu item could not be updated: ${error.message}`);
}

export async function setOwnerCatalogProductActive(
  businessId: string,
  branchId: string,
  productId: string,
  active: boolean,
) {
  const { error } = await supabase.from('catalog_products').update({ status: active ? 'ACTIVE' : 'INACTIVE' })
    .eq('id', productId).eq('business_id', businessId).eq('branch_id', branchId);
  if (error) throw new Error(`The menu item status could not be changed: ${error.message}`);
}

/**
 * Creates directory metadata only. No PIN, verifier, staff session, or device
 * authority is accepted here. The staff member still needs native credential
 * setup on an enrolled Hub before they can authenticate operationally.
 */
export async function createOwnerStaffProfile(
  businessId: string,
  branchId: string,
  nameValue: string,
  role: UserRole,
): Promise<StaffMember> {
  const name = cleanText(nameValue, 120);
  if (!name) throw new Error('Staff name is required.');
  if (!OPERATIONAL_STAFF_ROLES.includes(role)) throw new Error('Only operational staff roles can be created here.');

  const { data, error } = await supabase.from('staff_members').insert({
    business_id: businessId,
    branch_id: branchId,
    name,
    role,
    status: 'ACTIVE',
    active_shift: false,
    performance_score: 100,
    pin_hash: null,
  }).select('id, name, role, status, branch_id, active_shift, performance_score').single();
  if (error || !data) throw new Error(`The staff profile could not be created: ${error?.message || 'No record returned.'}`);

  return {
    id: data.id,
    name: data.name,
    role: data.role as UserRole,
    status: data.status || undefined,
    branchId: data.branch_id,
    activeShift: Boolean(data.active_shift),
    performanceScore: Number(data.performance_score ?? 100),
  };
}
