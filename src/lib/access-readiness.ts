import { createServerFn } from "@tanstack/react-start";
/** Public availability flag, never returns credentials or infrastructure details. */
export const getAccessReadiness = createServerFn({method:"GET"}).handler(() => {
  const local = process.env.NODE_ENV !== "production" || process.env.PLUGOS_PREVIEW === "true";
  return { ready: local || Boolean(process.env.DATABASE_URL?.trim() && process.env.BETTER_AUTH_SECRET?.trim() && process.env.BETTER_AUTH_URL?.trim()) };
});
