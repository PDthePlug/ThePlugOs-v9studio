export type StaffRole = "OWNER" | "MANAGER" | "CASHIER" | "KITCHEN";
export type OrderStatus = "PLACED" | "PREPARING" | "READY" | "COLLECTED" | "CANCELLED";
export type PaymentStatus = "UNPAID" | "PAID";

export type StaffMember = {
  id: string;
  name: string;
  role: StaffRole;
  status: string;
};

export type Product = {
  id: string;
  name: string;
  category: string;
  priceCents: number;
  stock: number;
  active: boolean;
};

export type Device = {
  id: string;
  name: string;
  role: StaffRole | "HUB";
  status: string;
  lastSeen: string | null;
};

export type OrderItem = {
  id: string;
  productId: string | null;
  name: string;
  qty: number;
  priceCents: number;
};

export type Order = {
  id: string;
  number: number;
  status: OrderStatus;
  cashierId: string | null;
  cashierName: string | null;
  paymentStatus: PaymentStatus;
  tenderedCents: number | null;
  totalCents: number;
  createdAt: string;
  items: OrderItem[];
};

export type CashShift = {
  id: string;
  status: "OPEN" | "CLOSED";
  openedBy: string;
  openingFloatCents: number;
  expectedCents: number | null;
  countedCents: number | null;
  openedAt: string;
};

export type ShopSnapshot = {
  shop: { id: string; name: string; branchName: string; onboardingStatus: string };
  staff: StaffMember[];
  products: Product[];
  devices: Device[];
  orders: Order[];
  shift: CashShift | null;
  pendingOutbox: number;
  salesTodayCents: number;
  ordersToday: number;
  report: OperationsReport;
};

export type StationContext = {
  sessionId: string;
  staff: StaffMember;
  shopName: string;
  branchName: string;
  products: Product[];
  orders: Order[];
  shift: CashShift | null;
  pendingOutbox: number;
  expectedDrawerCents: number;
  lastOrderId?: string;
  report: OperationsReport | null;
};

export const STARTER_MENU = [
  { name: "Kota — Russian & chips", category: "Kotas", priceCents: 4500, stock: 40 },
  { name: "Kota — Full house", category: "Kotas", priceCents: 6500, stock: 30 },
  { name: "Quarter chicken & pap", category: "Plates", priceCents: 7500, stock: 25 },
  { name: "Pap & vleis", category: "Plates", priceCents: 7000, stock: 20 },
  { name: "Russian & chips", category: "Grills", priceCents: 3500, stock: 40 },
  { name: "Hot chips", category: "Sides", priceCents: 2500, stock: 50 },
  { name: "Vetkoek mince", category: "Bakes", priceCents: 2800, stock: 24 },
  { name: "Coke 500ml", category: "Drinks", priceCents: 1800, stock: 60 },
  { name: "1.5L cooldrink", category: "Drinks", priceCents: 2800, stock: 24 },
  { name: "Still water", category: "Drinks", priceCents: 1200, stock: 40 },
] as const;

export const ROLE_LABEL: Record<StaffRole | "HUB", string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  KITCHEN: "Kitchen",
  HUB: "Hub",
};

export type OperationsReport = {
  daily: {day: string; sales: number; orders: number}[];
  topProducts: {name: string; quantity: number; sales: number}[];
  shifts: {id: string; status: string; opened_by: string; opening_float_cents: number; expected_cents: number | null; counted_cents: number | null; opened_at: string; closed_at: string | null}[];
  inventory: {id: string; name: string; kind: string; qty: string; reason: string | null; created_at: string}[];
};
