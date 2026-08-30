import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

async function exists(relativePath) {
  try {
    await access(resolve(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

const [packageSource, lockSource, config, variables, appBuild, manifest, wrapperProperties, guide] = await Promise.all([
  load('package.json'),
  load('package-lock.json'),
  load('capacitor.config.ts'),
  load('android/variables.gradle'),
  load('android/app/build.gradle'),
  load('android/app/src/main/AndroidManifest.xml'),
  load('android/gradle/wrapper/gradle-wrapper.properties'),
  load('docs/implementation/ANDROID_CASHIER_HUB_BUILD_AND_SECURITY.md'),
]);
const mainActivity = await load('android/app/src/main/java/com/theplugos/cashierhub/MainActivity.kt');
const manifestPackage = JSON.parse(packageSource);
const lockPackage = JSON.parse(lockSource);

for (const dependency of ['@capacitor/core', '@capacitor/android']) {
  assert.equal(manifestPackage.dependencies?.[dependency], '8.5.0', `${dependency} must be a pinned production dependency.`);
  assert.equal(lockPackage.packages?.['']?.dependencies?.[dependency], '8.5.0', `${dependency} must be represented in the root lockfile.`);
  assert.equal(lockPackage.packages?.[`node_modules/${dependency}`]?.version, '8.5.0', `${dependency} lock entry must match the native host.`);
}
assert.equal(manifestPackage.devDependencies?.['@capacitor/cli'], '8.5.0', 'The Capacitor CLI must be pinned for deterministic Android sync.');
assert.equal(lockPackage.packages?.['']?.devDependencies?.['@capacitor/cli'], '8.5.0', 'The Capacitor CLI must be represented in the root lockfile.');
assert.equal(lockPackage.packages?.['node_modules/@capacitor/cli']?.version, '8.5.0', 'The Capacitor CLI lock entry must match the native host.');

assert.match(config, /appId:\s*'com\.theplugos\.cashierhub'/, 'Capacitor must build the Cashier Hub package ID.');
assert.match(config, /webDir:\s*'dist'/, 'Capacitor must copy the production web bundle into Android.');
for (const expected of [
  "minSdkVersion = 24",
  "compileSdkVersion = 36",
  "targetSdkVersion = 36",
  "androidxActivityVersion = '1.11.0'",
  "androidxCoreVersion = '1.17.0'",
  "androidxFragmentVersion = '1.8.9'",
  "coreSplashScreenVersion = '1.2.0'",
  "androidxWebkitVersion = '1.14.0'",
  "cordovaAndroidVersion = '14.0.1'",
]) {
  assert.ok(variables.includes(expected), `Android variables must match Capacitor 8.5: ${expected}`);
}
assert.match(appBuild, /JavaVersion\.VERSION_21/, 'The app host must compile with Java 21 for Capacitor 8.5.');
assert.match(appBuild, /jvmTarget\s*=\s*'21'/, 'Kotlin must target Java 21 for Capacitor 8.5.');
assert.match(appBuild, /project\.findProperty\('THEPLUGOS_CLOUD_FUNCTIONS_BASE_URL'\)\s*\?:\s*''/, 'A fresh Android build must have no default cloud receiver endpoint.');
assert.match(manifest, /android:usesCleartextTraffic="false"/, 'The Android host must not allow cleartext traffic.');
assert.match(manifest, /HubForegroundService/, 'The Android host must declare the native Hub foreground service.');
for (const permission of [
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.CHANGE_WIFI_STATE',
  'android.permission.CHANGE_WIFI_MULTICAST_STATE',
  'android.permission.BLUETOOTH_ADVERTISE',
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.NEARBY_WIFI_DEVICES',
]) {
  assert.ok(manifest.includes(permission), `The Android host must declare ${permission} for measured local-link capability.`);
}
assert.match(mainActivity, /requestMeasuredLocalLinkPermissions\(/, 'The Android host must request its runtime nearby-device permissions.');
assert.match(mainActivity, /refreshLocalDiscovery\(\)/, 'Granting nearby-device permission must re-attempt only measured discovery.');
assert.match(mainActivity, /Manifest\.permission\.ACCESS_FINE_LOCATION/, 'Android 6-12L Wi-Fi Direct discovery must request its legacy permission.');
assert.match(manifest, /NativeTerminalLocalLinkActivity/, 'The Android host must expose the measured terminal local-link screen.');
for (const source of [
  'android/app/src/main/java/com/theplugos/cashierhub/native/HubWifiDirectAdvertiser.kt',
  'android/app/src/main/java/com/theplugos/cashierhub/native/TerminalLocalLinkController.kt',
  'android/app/src/main/java/com/theplugos/cashierhub/native/NativeTerminalLocalLinkActivity.kt',
]) {
  assert.equal(await exists(source), true, `The Android host must retain ${source}.`);
}
assert.match(wrapperProperties, /gradle-8\.14\.3-all\.zip/, 'The Gradle wrapper must be pinned for clean-checkout builds.');
assert.equal(await exists('android/gradlew'), true, 'The Android Gradle wrapper must be committed.');
assert.equal(await exists('android/gradle/wrapper/gradle-wrapper.jar'), true, 'The Gradle wrapper binary must be committed.');
assert.match(guide, /JDK 21/, 'The Android build guide must require the matching JDK.');

console.log('Android native host contract checks passed');
