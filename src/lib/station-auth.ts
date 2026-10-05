import { createMiddleware } from "@tanstack/react-start";
export const stationMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const { getBearerToken } = await import("./auth/client");
    return next({ sendContext: { bearerToken: getBearerToken() ?? undefined } });
  })
  .server(async ({ next, context }) => {
    const { assertSameSiteRequest } = await import("./auth/isolation.server");
    const { resolveStation } = await import("./station-auth.server");
    assertSameSiteRequest();
    return next({ context: await resolveStation(context.bearerToken) });
  });
export const pairingMiddleware = createMiddleware({ type: "function" })
  .server(async ({ next }) => {
    const { assertSameSiteRequest } = await import("./auth/isolation.server");
    assertSameSiteRequest();
    return next();
  });
