export function newId(prefix = "id") {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === "function") {
    return `${prefix}_${webCrypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function sixDigitCode() {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.getRandomValues === "function") {
    const n = webCrypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
    return n.toString().padStart(6, "0");
  }
  return Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
}
