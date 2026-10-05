import { OrderStatus } from '../types';

/**
 * Authoritative Order Lifecycle State Machine
 * DRAFT → SUBMITTED → IN_PREP → READY → FULFILLED
 */
export const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['SUBMITTED', 'PENDING', 'CANCELLED'],
  SUBMITTED: ['IN_PREP', 'PREP', 'CANCELLED'],
  PENDING: ['IN_PREP', 'PREP', 'CANCELLED'],
  ACCEPTED: ['IN_PREP', 'PREP', 'CANCELLED'],
  IN_PREP: ['READY', 'CANCELLED'],
  PREP: ['READY', 'CANCELLED'],
  READY: ['FULFILLED', 'COMPLETED', 'CANCELLED'],
  FULFILLED: [], // Terminal state
  COMPLETED: [], // Terminal state
  CANCELLED: []  // Terminal state
};

/**
 * Validates if an order transition from currentStatus to targetStatus is allowed.
 */
export function isValidOrderTransition(currentStatus: OrderStatus, targetStatus: OrderStatus): boolean {
  if (currentStatus === targetStatus) return true;
  const allowed = VALID_ORDER_TRANSITIONS[currentStatus] || [];
  return allowed.includes(targetStatus);
}

/**
 * Asserts valid transition or throws descriptive error.
 */
export function validateOrderTransition(orderId: string, currentStatus: OrderStatus, targetStatus: OrderStatus): void {
  if (!isValidOrderTransition(currentStatus, targetStatus)) {
    throw new Error(`Illegal order state transition for Order ${orderId}: cannot transition from '${currentStatus}' to '${targetStatus}'.`);
  }
}
