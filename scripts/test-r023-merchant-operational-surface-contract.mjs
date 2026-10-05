import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');
const requireText = (subject, fragment, message = `Expected source to contain: ${fragment}`) => {
  assert.ok(subject.includes(fragment), message);
};

const [
  packageSource,
  adr,
  primitives,
  cashier,
  kitchen,
  manager,
  receiptPanel,
  adjustmentPanel,
  wastePanel,
  releaseStatus,
] = await Promise.all([
  load('package.json'),
  load('docs/architecture/ADR-013_MERCHANT_OPERATIONAL_SURFACE_V2.md'),
  load('src/components/MerchantStationPrimitives.tsx'),
  load('src/workspaces/NativeCashierStation.tsx'),
  load('src/workspaces/NativeKitchenStation.tsx'),
  load('src/workspaces/NativeManagerStation.tsx'),
  load('src/workspaces/ManagerInventoryReceiptPanel.tsx'),
  load('src/workspaces/ManagerInventoryAdjustmentPanel.tsx'),
  load('src/workspaces/ManagerInventoryWastePanel.tsx'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

const packageManifest = JSON.parse(packageSource);
assert.equal(
  packageManifest.scripts['test:r023-merchant-operations'],
  'node scripts/test-r023-merchant-operational-surface-contract.mjs',
  'R023 must retain a dedicated merchant-operational-surface contract command.',
);
assert.ok(packageManifest.scripts['test:all'].includes('test:r023-merchant-operations'), 'The full source gate must run R023.');

for (const fragment of [
  'source-experience decision',
  'The security truth remains unchanged',
  'Build order',
  'Take payment',
  'Hand over',
  'Waiting to start',
  'Cooking now',
  'Cash control',
  'Order exceptions',
  'Stock desk',
  'Working offline',
  'discardNativeCommandRequest',
  'release status remains **HOLD**',
]) requireText(adr, fragment);

for (const fragment of ['#f7f2e9', '#fffdf8', 'StationHeader', 'MetricCard', 'MerchantAction', 'EmptyState']) {
  requireText(primitives, fragment);
}

for (const fragment of [
  'Sell, take payment, hand over',
  'What is the customer buying?',
  'Cash payments waiting',
  'Ready for customer collection',
  'Working offline',
  'localHubRuntime.getNativeOperatorContext()',
  'localHubRuntime.submitNativeCommandRequest',
  'localHubRuntime.discardNativeCommandRequest',
  "context.role !== 'CASHIER'",
]) requireText(cashier, fragment);
assert.ok(!cashier.includes('supabase'), 'Cashier merchant surface must retain the native authority boundary.');

for (const fragment of [
  'Cook the queue',
  'Waiting to start',
  'Cooking now',
  'Working offline',
  'localHubRuntime.getNativeOperatorContext()',
  'localHubRuntime.submitNativeCommandRequest',
  'localHubRuntime.discardNativeCommandRequest',
  "context.role !== 'KITCHEN_STAFF'",
]) requireText(kitchen, fragment);
assert.ok(!kitchen.includes('supabase'), 'Kitchen merchant surface must retain the native authority boundary.');
assert.ok(!kitchen.includes('paymentMethod'), 'Kitchen merchant surface must not receive tender authority.');
assert.ok(!kitchen.includes('totalAmount'), 'Kitchen merchant surface must not receive financial amounts.');
assert.ok(!kitchen.includes("status: 'CANCELLED'"), 'Kitchen merchant surface must not receive cancellation authority.');
assert.ok(!kitchen.includes("status: 'COLLECTED'"), 'Kitchen merchant surface must not receive collection authority.');

for (const fragment of [
  'Run the shift',
  'Cash control',
  'Order exceptions',
  'Stock desk',
  'ManagerInventoryReceiptPanel',
  'ManagerInventoryAdjustmentPanel',
  'ManagerInventoryWastePanel',
  'Working offline',
  'localHubRuntime.getNativeOperatorContext()',
  'localHubRuntime.submitNativeCommandRequest',
  'localHubRuntime.discardNativeCommandRequest',
  "context.role !== 'MANAGER'",
]) requireText(manager, fragment);
assert.ok(!manager.includes('supabase'), 'Manager merchant surface must retain the native authority boundary.');
assert.ok(!manager.includes('totalAmount'), 'Manager order-exception surface must not expose financial amounts.');
assert.ok(!manager.includes('paymentMethod'), 'Manager order-exception surface must not expose tender details.');

requireText(receiptPanel, 'Receive stock');
requireText(adjustmentPanel, 'Correct a physical count');
requireText(wastePanel, 'Record waste');
assert.ok(!receiptPanel.includes('product.price') && !adjustmentPanel.includes('product.price') && !wastePanel.includes('product.price'), 'Counted stock surfaces must not add product prices.');
assert.ok(!receiptPanel.includes('supplierName') && !adjustmentPanel.includes('supplierName') && !wastePanel.includes('supplierName'), 'Counted stock surfaces must not add supplier authority.');

assert.match(releaseStatus, /\*\*Status:\*\* HOLD/, 'Merchant UX restoration must not grant release authority.');

console.log('R023 merchant operational surface contract checks passed');
