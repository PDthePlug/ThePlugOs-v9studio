/**
 * End-to-end presentation QA with local fixtures only.
 *
 * This runner never contacts production Supabase and never emulates staff PIN
 * verification in React. Owner Auth/PostgREST and native bridge responses are
 * intercepted fixtures so the real screen transitions can be rendered at
 * desktop and mobile widths without customer records or device credentials.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.QA_URL ?? 'http://127.0.0.1:8082';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) {
  throw new Error('Journey renderer is local-only.');
}
const directory = process.env.QA_SCREENSHOT_DIR ?? 'artifacts/customer-journey';
mkdirSync(directory, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'],
});

const ownerId = '20000000-0000-4000-8000-000000000001';
const businessId = '20000000-0000-4000-8000-000000000002';
const branchId = '20000000-0000-4000-8000-000000000003';
const productId = '20000000-0000-4000-8000-000000000004';
const now = new Date().toISOString();
const user = {
  id: ownerId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'owner@example.test',
  email_confirmed_at: now,
  created_at: now,
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
};
const jwt = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: ownerId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
  'journey-fixture',
].join('.');
const sessionPayload = {
  access_token: jwt,
  refresh_token: 'journey-fixture-refresh',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
};
const staff = [
  { id: '20000000-0000-4000-8000-000000000005', branch_id: branchId, name: 'Thandi', role: 'CASHIER', status: 'ACTIVE' },
  { id: '20000000-0000-4000-8000-000000000006', branch_id: branchId, name: 'Sipho', role: 'KITCHEN_STAFF', status: 'ACTIVE' },
  { id: '20000000-0000-4000-8000-000000000007', branch_id: branchId, name: 'Lebo', role: 'MANAGER', status: 'ACTIVE' },
];
const product = { id: productId, business_id: businessId, branch_id: branchId, name: 'Vetkoek mince', category: 'Bakes', price: 28, stock_quantity: 9, unit_of_measure: 'Each', status: 'ACTIVE' };
const order = { id: '20000000-0000-4000-8000-000000000008', business_id: businessId, branch_id: branchId, total_amount: 28, status: 'COLLECTED', payment_status: 'CAPTURED', created_at: now, cashier_name: 'Thandi' };

const errors = [];
const manifest = [];
const contexts = [];

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile',
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  };
}

async function installCloudFixtures(ctx, { onboardingStatus = 'IN_PROGRESS' } = {}) {
  let foundationCreated = false;
  await ctx.route('https://renderer.supabase.co/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders(), body: '' });
      return;
    }

    let payload;
    if (path === '/auth/v1/signup') {
      payload = sessionPayload;
    } else if (path === '/auth/v1/token') {
      payload = sessionPayload;
    } else if (path === '/auth/v1/user') {
      payload = user;
    } else if (path === '/auth/v1/logout') {
      payload = {};
    } else if (path === '/rest/v1/rpc/create_business_with_owner_and_branch') {
      foundationCreated = true;
      payload = { business_id: businessId, branch_id: branchId };
    } else if (path === '/functions/v1/hub-owner-enrollment' || path === '/functions/v1/staff-credential-recovery') {
      payload = { ok: true, terminals: [], recovery: null };
    } else if (path.startsWith('/rest/v1/')) {
      const table = path.slice('/rest/v1/'.length).split('/')[0];
      const business = { id: businessId, name: 'Renderer QA Takeaway', owner_id: ownerId, onboarding_status: onboardingStatus };
      const rows = {
        businesses: foundationCreated ? [business] : [],
        business_memberships: foundationCreated ? [{ business_id: businessId, role: 'OWNER', user_id: ownerId, businesses: business }] : [],
        branches: foundationCreated ? [{ id: branchId, business_id: businessId, name: 'Braam', location: 'Johannesburg', is_active: true, created_at: now }] : [],
        staff_members: foundationCreated ? staff : [],
        catalog_products: foundationCreated ? [product] : [],
        orders: foundationCreated ? [order, { ...order, id: '20000000-0000-4000-8000-000000000009', payment_status: 'PENDING', total_amount: 80 }] : [],
        devices: foundationCreated ? [{ id: 'cloud-device', business_id: businessId, branch_id: branchId, status: 'ACTIVE' }] : [],
      }[table];
      assert(rows !== undefined, `Unexpected PostgREST table in journey fixture: ${table}`);
      const wantsObject = request.headers().accept?.includes('vnd.pgrst.object');
      payload = wantsObject ? (rows[0] ?? null) : rows;
    } else {
      throw new Error(`Unexpected journey fixture request: ${request.method()} ${path}`);
    }

    await route.fulfill({ status: 200, contentType: 'application/json', headers: corsHeaders(), body: JSON.stringify(payload) });
  });
}

async function createOwnerPage(options) {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  await installCloudFixtures(ctx, options);
  const page = await ctx.newPage();
  page.on('pageerror', (error) => errors.push(`owner pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`owner console: ${message.text()}`); });
  return page;
}

async function createNativePage() {
  const ctx = await browser.newContext();
  contexts.push(ctx);
  await ctx.addInitScript(({ productId: fixtureProductId }) => {
    window.__rendererRole = null;
    const snapshot = {
      devices: [], outbox: [], inbox: [], failures: [], transportMetrics: [],
      networkHealth: {
        mode: 'LOCAL_HUB_PRIMARY', availability: 'READY', localPeerCount: 2,
        packetLossRate: 0, latencyMs: 12, outboxDepth: 0, inboxDepth: 0,
        lastSyncTimestamp: new Date().toISOString(), cloudConnected: true,
        cloudStatus: 'CONNECTED', activeTransport: 'LAN_WIFI',
        message: 'Journey renderer fixture only',
      },
    };
    const makeOperator = (role) => ({
      staffName: role === 'CASHIER' ? 'Thandi' : role === 'MANAGER' ? 'Lebo' : 'Sipho',
      role,
      vat: { enabled: false, rate: 15 },
      catalogProducts: [{ id: fixtureProductId, name: 'Vetkoek mince', category: 'Bakes', price: 28, stockQuantity: 9, unit: 'Each', status: 'ACTIVE' }],
      inventoryProducts: [{ id: fixtureProductId, name: 'Vetkoek mince', stockQuantity: 9, unit: 'Each', status: 'ACTIVE' }],
      activeCashShift: role === 'KITCHEN_STAFF' ? null : { id: 'fixture-shift', status: 'OPEN', openingFloat: 500, cashSalesTotal: 28, cashTenderedTotal: 50, cashChangeTotal: 22, expectedCash: 528 },
      pendingCashOrders: [],
      readyForCollectionOrders: [],
      cancellableOrders: [],
      pendingKitchenOrders: role === 'KITCHEN_STAFF' ? [{ id: '20000000-0000-4000-8000-000000000010', status: 'PLACED', items: [{ productId: fixtureProductId, name: 'Vetkoek mince', quantity: 1 }] }] : [],
      recoverableNativeCommands: [],
    });
    const plugin = {
      getSnapshot: async () => snapshot,
      refresh: async () => snapshot,
      discoverDevices: async () => [],
      registerDevice: async () => { throw new Error('Journey renderer only'); },
      revokeDevice: async () => { throw new Error('Journey renderer only'); },
      getNativeOperatorContext: async () => {
        if (!window.__rendererRole) throw new Error('No fixture staff session');
        return structuredClone(makeOperator(window.__rendererRole));
      },
      openNativeStaffSignIn: async () => ({ opened: true }),
      endNativeStaffSession: async () => { window.__rendererRole = null; return { ended: true }; },
      addListener: async () => ({ remove: async () => {} }),
    };
    window.Capacitor = { Plugins: { ThePlugOSLocalHub: plugin } };
  }, { productId });
  const page = await ctx.newPage();
  page.on('pageerror', (error) => errors.push(`native pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`native console: ${message.text()}`); });
  return page;
}

async function shot(page, name) {
  for (const [width, height, kind] of [[1280, 900, 'desktop'], [390, 844, 'mobile']]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${directory}/${name}-${kind}.png`, fullPage: true });
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
      bodyText: document.body.innerText.slice(0, 500),
    }));
    assert(metrics.scrollWidth <= metrics.innerWidth + 1, `${name} has horizontal overflow at ${kind}: ${metrics.scrollWidth} > ${metrics.innerWidth}`);
    manifest.push({ name, kind, width, height, scrollWidth: metrics.scrollWidth });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

try {
  // Owner/customer path: landing -> create owner/business -> setup -> owner dashboard -> resume setup.
  const owner = await createOwnerPage({ onboardingStatus: 'IN_PROGRESS' });
  await owner.goto(base, { waitUntil: 'networkidle' });
  await owner.getByRole('heading', { name: 'Your whole business. Moving as one.', exact: true }).waitFor();
  await shot(owner, '01-landing');

  await owner.getByRole('button', { name: /Set up my business/i }).click();
  await owner.getByRole('dialog').waitFor();
  await owner.getByRole('button', { name: 'Create Business', exact: true }).waitFor();
  await shot(owner, '02-create-business');
  await owner.getByLabel('Business name').fill('Renderer QA Takeaway');
  await owner.getByLabel('First branch name').fill('Braam');
  await owner.getByLabel('Owner email address').fill('owner@example.test');
  await owner.getByLabel('Password', { exact: true }).fill('renderer-only-password');
  await owner.getByLabel('Confirm password').fill('renderer-only-password');
  await owner.getByRole('button', { name: 'Create owner account', exact: true }).click();

  await owner.getByRole('heading', { name: 'Get your shop ready', exact: true }).waitFor({ timeout: 15000 });
  await shot(owner, '03-onboarding');
  await owner.getByRole('button', { name: /Open owner dashboard/i }).click();
  await owner.getByRole('heading', { name: 'Business heartbeat', exact: true }).waitFor({ timeout: 15000 });
  await owner.getByText('Shop setup is still in progress', { exact: true }).waitFor();
  await owner.getByText('Registered devices', { exact: true }).waitFor();
  await shot(owner, '04-owner-dashboard-pending-setup');
  await owner.getByRole('button', { name: 'Resume setup', exact: true }).click();
  await owner.getByRole('heading', { name: 'Get your shop ready', exact: true }).waitFor();

  // Separate returning-owner sign-in surface.
  const signIn = await createOwnerPage({ onboardingStatus: 'COMPLETED' });
  await signIn.goto(base, { waitUntil: 'networkidle' });
  await signIn.getByRole('button', { name: 'Open ThePlugOS', exact: true }).click();
  await signIn.getByLabel('Email address', { exact: true }).waitFor();
  await shot(signIn, '05-owner-sign-in');

  // Native staff entry is one surface; the native PIN activity itself remains
  // outside React. Simulate only the verified return from that native activity.
  const staffEntry = await createNativePage();
  await staffEntry.goto(base, { waitUntil: 'networkidle' });
  await staffEntry.getByRole('heading', { name: 'Who’s working this station?', exact: true }).waitFor();
  await staffEntry.getByRole('button', { name: /Choose profile & enter PIN/i }).waitFor();
  await shot(staffEntry, '06-staff-sign-in');

  for (const [role, title, name] of [
    ['CASHIER', 'Sell, take payment, hand over', '07-cashier'],
    ['KITCHEN_STAFF', 'Cook the queue', '08-kitchen'],
    ['MANAGER', 'Run the shift', '09-manager'],
  ]) {
    const page = await createNativePage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Who’s working this station?', exact: true }).waitFor();
    await page.evaluate((nextRole) => { window.__rendererRole = nextRole; }, role);
    await page.getByRole('button', { name: /Already signed in\? Open my workspace/i }).click();
    await page.getByRole('heading', { name: title, exact: true }).waitFor({ timeout: 15000 });
    await shot(page, name);
    if (role === 'KITCHEN_STAFF') {
      assert(!(await page.locator('body').innerText()).includes('R28'), 'Kitchen workspace leaked catalog price.');
    }
  }

  assert.deepEqual(errors, [], `Journey renderer recorded browser errors: ${errors.join(' | ')}`);
  writeFileSync(`${directory}/manifest.json`, JSON.stringify({ ok: true, scope: 'fixture-only owner and native presentation journey; no production Auth/PIN/pairing/LAN evidence', screenshots: manifest }, null, 2));
  console.log(`Customer journey renderer passed with ${manifest.length} desktop/mobile screenshots.`);
} catch (error) {
  writeFileSync(`${directory}/manifest.json`, JSON.stringify({ ok: false, error: String(error), errors, screenshots: manifest }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.all(contexts.map((ctx) => ctx.close().catch(() => undefined)));
  await browser.close();
}
