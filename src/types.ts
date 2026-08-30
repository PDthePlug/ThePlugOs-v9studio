export type DomainType = 
  | 'fastfood-domain' 
  | 'store-items' 
  | 'bakery-domain' 
  | 'butchery-domain' 
  | 'liquor-domain' 
  | 'hardware-domain' 
  | 'fresh-produce' 
  | 'clothing' 
  | 'services'
  | string;

export interface DomainMeta {
  id: string;
  name: string;
  icon: string;
  label: string;
  description: string;
}

export const COMMERCIAL_DOMAINS: DomainMeta[] = [
  { id: 'fastfood-domain', name: 'Fast Food', icon: '🍔', label: '🍔 Fast Food', description: 'Kotas, Flame Grill, Sides, Combos' },
  { id: 'store-items', name: 'Store Items', icon: '🛒', label: '🛒 Store Items', description: 'Groceries, Tobacco, Airtime, Essentials' },
  { id: 'bakery-domain', name: 'Bakery', icon: '🥖', label: '🥖 Bakery', description: 'Fresh Breads, Cakes, Pastries' },
  { id: 'butchery-domain', name: 'Butchery', icon: '🥩', label: '🥩 Butchery', description: 'Meats, Sausage, Braai Packs' },
  { id: 'liquor-domain', name: 'Liquor Depot', icon: '🍾', label: '🍾 Liquor Depot', description: 'Beverages, Spirits, Beers (Licensed)' },
  { id: 'hardware-domain', name: 'Hardware', icon: '🛠️', label: '🛠️ Hardware', description: 'Tools, Building Materials, Electrical' },
  { id: 'fresh-produce', name: 'Fresh Produce', icon: '🍎', label: '🍎 Fresh Produce', description: 'Fruits, Vegetables, Fresh Herbs' },
  { id: 'clothing', name: 'Clothing', icon: '👕', label: '👕 Clothing', description: 'Apparel, Footwear, Accessories' },
  { id: 'services', name: 'Services', icon: '⚡', label: '⚡ Services', description: 'Bill Payments, Airtime, Tokens, Repairs' }
];

export const STORE_ITEMS_CATEGORIES = [
  'Food',
  'Beverages',
  'Tobacco',
  'Household',
  'Electrical',
  'Personal Care',
  'Stationery',
  'Services',
  'Other'
];

export type UserRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN_STAFF' | 'ADMINISTRATOR';

export type PaymentType = 'CASH' | 'CARD' | 'SPAZAPAY_QR';

export interface UserSession {
  userId: string;
  userName: string;
  role: UserRole;
  businessId?: string;
  branchId: string;
  branchName: string;
  deviceId: string;
  permissions: string[];
  shiftId?: string;
  sessionToken?: string;
}

export interface Branch {
  id: string;
  name: string;
  location: string;
  domain: DomainType;
  isActive: boolean;
}

export interface RecipeIngredient {
  rawItemId: string;
  rawItemName: string;
  quantity: number;
  unit: string;
}

export interface ProductItem {
  id: string;
  name: string;
  category: string;
  price: number;
  domain: DomainType;
  description: string;
  stock: number;
  unit: string;
  supplier?: string;
  purchaseUnit?: string;
  sellingUnit?: string;
  minQuantity?: number;
  reorderQuantity?: number;
  costPrice?: number;
  supplierNotes?: string;
  storageLocation?: string;
  barcode?: string;
  photoUrl?: string;
  status?: 'ACTIVE' | 'ARCHIVED';
  branchId?: string;
  recipe?: RecipeIngredient[];
}

export interface SupplierRecord {
  id: string;
  name: string;
  representative: string;
  phone: string;
  whatsapp: string;
  email: string;
  deliveryDays: string;
  minOrder: number;
  paymentTerms: string;
  status: 'ACTIVE' | 'INACTIVE';
  notes?: string;
}

export interface RestockItem {
  productId: string;
  name: string;
  quantity: number;
  costPrice?: number;
  unit?: string;
}

export interface RestockRequest {
  id: string;
  branchId: string;
  branchName: string;
  managerId: string;
  managerName: string;
  date: string;
  supplierId?: string;
  supplierName?: string;
  supplierPhone?: string;
  items: RestockItem[];
  reason: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED' | 'DELIVERED';
  totalEstimatedCost?: number;
  approvedAt?: string;
  deliveredAt?: string;
  notes?: string;
}

export interface CustomerRecord {
  id: string;
  phone: string;
  name?: string;
  visits: number;
  lifetimeSpend: number;
  avgBasket: number;
  lastVisit: string;
  favouriteProducts: string[];
  createdAt: string;
}

export type OrderStatus = 'DRAFT' | 'SUBMITTED' | 'PENDING' | 'ACCEPTED' | 'IN_PREP' | 'PREP' | 'READY' | 'FULFILLED' | 'COMPLETED' | 'CANCELLED';

export interface CartItem {
  product: ProductItem;
  quantity: number;
  notes?: string;
}

export interface OrderItemRecord {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  domain?: DomainType;
  notes?: string;
}

export interface OrderRecord {
  id: string; // Globally unique order_id
  businessId?: string;
  branchId: string;
  branchName?: string;
  deviceId?: string;
  cashierId: string;
  cashierName: string;
  domain?: DomainType;
  customerName?: string;
  customerPhone?: string;
  items: OrderItemRecord[];
  subtotal: number;
  discount?: number;
  tax: number;
  total: number;
  totalAmount: number;
  status: OrderStatus;
  paymentMethod: PaymentType;
  paymentType: PaymentType;
  cashTendered?: number;
  changeDue?: number;
  orderNotes?: string;
  createdAt: string;
  updatedAt: string;
  prepStartedAt?: string;
  readyAt?: string;
  completedAt?: string;
  voidedAt?: string;
  refundedBy?: string;
}

export interface AuditEventRecord {
  eventId: string;
  businessId: string;
  branchId: string;
  deviceId: string;
  actorId: string;
  timestamp: string;
  entityId: string;
  eventType: 'ORDER_CREATED' | 'ORDER_SUBMITTED' | 'ORDER_STARTED' | 'ORDER_READY' | 'ORDER_FULFILLED' | 'PAYMENT_RECORDED' | 'INVENTORY_DEDUCTED' | string;
  details?: Record<string, any>;
}

export interface ShiftInfo {
  id: string;
  branchId: string;
  branchName: string;
  operatorId: string;
  operatorName: string;
  cashierName?: string;
  role: UserRole;
  openingFloat: number;
  openedAt: string;
  closedAt?: string;
  status: 'OPEN' | 'CLOSED';
  closingCashCount?: number;
  expectedCashTotal?: number;
  variance?: number;
  managerApproved?: boolean;
  notes?: string;
}

export interface NotificationItem {
  id: string;
  targetRole?: UserRole | 'ALL';
  level: 'info' | 'warn' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  orderId?: string;
}

export type RoleNotification = NotificationItem;

export interface RuleEvaluationLog {
  id: string;
  ruleId: string;
  condition: string;
  triggered: boolean;
  actionTaken: string;
  timestamp: string;
}

export interface StaffMember {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  /** Cloud directory status only; never a credential or session signal. */
  status?: string;
  branchId: string;
  branchName?: string;
  activeShift: boolean;
  performanceScore: number;
}

export interface PendingStaffSetup {
  staff: StaffMember;
  pin: string;
}

export interface StaffCredentialInput {
  staffId: string;
  pin: string;
}
