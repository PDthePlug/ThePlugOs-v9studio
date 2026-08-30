/**
 * Browser-generated device IDs are not an identity or proof of possession.
 * Native Android Keystore enrollment replaces this compatibility entry point.
 */
export function getOrCreateDeviceId(): string {
  throw new Error('Browser device identity is retired. Enroll the Android-native Cashier Hub instead.');
}
