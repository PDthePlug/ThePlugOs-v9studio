const zar = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });

export function formatZar(cents: number) {
  return zar.format((cents || 0) / 100);
}

export function parseZarToCents(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Enter a valid rand amount.");
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999_999.99) {
    throw new Error("That amount is outside the supported range.");
  }
  return Math.round(parsed * 100);
}
