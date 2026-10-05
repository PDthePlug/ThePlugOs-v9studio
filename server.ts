import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const RETIRED_OPERATIONAL_ENDPOINTS = [
  '/api/devices',
  '/api/devices/:deviceId',
  '/api/devices/save',
  '/api/pairing/generate',
  '/api/pairing/validate',
  '/api/pairing/register-device',
  '/api/pairing/cancel',
  '/api/pairing/active-code',
  '/api/pairing/business-config/save',
  '/api/pairing/business-config/:businessId'
];

function retiredOperationalEndpoint(_: express.Request, res: express.Response) {
  return res.status(410).json({
    error: 'LEGACY_OPERATIONAL_TRANSPORT_RETIRED',
    message: 'Device pairing, local-hub discovery, and operational writes are not served by this web process.',
    remediation: 'Use the authenticated Android-native Cashier Hub transport. Cloud pairing remains unavailable until the staged R002 release is accepted.'
  });
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // This process is a web shell only. It deliberately has no unauthenticated
  // operational API, no cross-origin device-write surface, and no /tmp store.
  app.get('/api/health', (_, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      status: 'ok',
      service: 'theplugos-web-shell',
      operationalTransport: 'native-hub-required',
      timestamp: new Date().toISOString()
    });
  });

  app.all(RETIRED_OPERATIONAL_ENDPOINTS, retiredOperationalEndpoint);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, HOST, () => {
    console.log(`ThePlugOS web shell listening on http://${HOST}:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('ThePlugOS web shell failed to start.', error);
  process.exitCode = 1;
});
