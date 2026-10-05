/**
 * Cashier Hub native host configuration.
 *
 * The Android platform is intentionally not generated in a browser session.
 * It is built from the committed android/ source after the Capacitor 8
 * dependencies are installed in a supported Node 22 toolchain.
 */
const config = {
  appId: 'com.theplugos.cashierhub',
  appName: 'ThePlugOS Cashier Hub',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    allowMixedContent: false,
    captureInput: true
  }
};

export default config;
