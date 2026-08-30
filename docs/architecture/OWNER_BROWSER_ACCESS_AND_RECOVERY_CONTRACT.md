# Owner browser access, account signup, and recovery contract

- **Status:** Gate 0 source contract
- **Date:** 21 August 2026
- **Applies to:** public arrival, owner sign-in, owner account recovery, and
  R001 business-context selection
- **Authority:** ThePlugOS Constitution, ADR-001, and ADR-003

## Purpose

The browser remains an owner-facing cloud foundation surface. It can establish
an authenticated owner context, create an R001 business foundation, and show
the next approved native-Hub step. It is not a staff terminal and it never
becomes an operational authority.

This contract closes the R001 owner-access gaps without inventing a replacement
backend: safe account signup, account recovery, confirmed-but-unbound owner
accounts, and explicit selection where one owner has more than one business.

## Account-signup configuration contract

Owner signup is enabled only when all three non-secret browser values are
configured: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and the exact public
owner-portal origin compiled into `VITE_OWNER_PORTAL_ORIGIN`. The browser must
compare the portal value with its current origin before it renders an Auth form
or sends an Auth request. A missing, malformed, non-HTTPS, path-bearing, or
mismatched value is a safe stop: the page may show the marketing surface, but
it must not collect an owner email or password.

The production Auth configuration is part of this contract, even though it
lives outside SQL migrations:

| Setting | Required production value |
| --- | --- |
| Email/password provider | Enabled |
| New-user signup | Enabled only for the approved owner portal |
| Confirm email | Enabled |
| Site URL | Exact `VITE_OWNER_PORTAL_ORIGIN` value |
| Redirect allow-list | Exact owner-portal confirmation URL and exact `?auth=recovery` URL; no wildcard used for production owner Auth |
| Password policy | Minimum 12 characters in the browser, strong Auth password policy, and leaked-password protection enabled |
| Email delivery | Verified sender/SMTP and tested confirmation and recovery templates |

The `SIGNUP_CONFIRMATION` redirect is the clean owner-portal root. It is
deliberately different from the recovery redirect (`?auth=recovery`):
confirmation must establish or restore a normal owner session, never open a
password-reset form. Both redirect values must be allow-listed in Supabase Auth
before an active signup claim is valid.

## Signup state and event contract

| State | Event | Result | Forbidden result |
| --- | --- | --- | --- |
| Portal or browser Auth client unconfigured; wrong origin | Owner opens sign-in/create surface | Explain that owner access is unavailable on this origin; send no Auth request | Collect credentials or issue a redirect |
| Unauthenticated | Owner submits account and foundation details | `auth.signUp` creates only an Auth account | Create a business, branch, membership, staff record, or device authority |
| Confirmation pending | Supabase returns no session | Clear password fields and require confirmation/sign-in | Persist a pending password or foundation request |
| Confirmed unbound owner | Auth session is restored, `SIGNED_IN` arrives after confirmation, or owner signs in | Reconcile the Auth user once and permit one explicit R001 foundation request | Treat the account as an operational station |
| Foundation request | Confirmed owner submits business and first branch | Call only `create_business_with_owner_and_branch` and validate both returned IDs | Direct table writes, staff-PIN entry, or onboarding completion |
| Foundation created | R001 RPC succeeds | Load only owner-scoped foundation facts and show the native-onboarding stop | Mark onboarding complete or open a browser operational workspace |

The client must use `auth.getUser()` immediately before the R001 RPC and
require a non-empty `email_confirmed_at`. This check is a fail-closed browser
gate, not an authorization substitute: the RPC still binds ownership to
`auth.uid()` in the database.

## Browser states

| State | Permitted action | Must not do |
| --- | --- | --- |
| Unauthenticated | Sign in, start owner registration, request password recovery | Query business data, accept staff credentials, or create a business before email confirmation |
| Confirmation pending | Explain that no business foundation was created and require a confirmed session | Persist a pending password or silently create a business later |
| Confirmed, unbound account | Create exactly one selected R001 business foundation through the existing atomic RPC | Treat an Auth account alone as a station identity |
| Multiple owner businesses | Require an explicit business choice before loading branches or staff directory data | Pick an arbitrary business or restore the last browser-held business |
| Owner context loaded | Read owner-scoped R001 foundation facts and hand off to native onboarding/station UI | Enter staff PINs, issue device credentials, or mutate operational records |
| Recovery link | Let Supabase validate the recovery session, update the password, sign out, and remove the recovery marker | Log, cache, or pass password/recovery material to the application |

## Access rules

1. The browser derives the selected business from an authenticated account's
   current R001 owner records; it never trusts a persisted business ID or a
   caller-supplied role.
2. A business must still prove that its `owner_id` is the authenticated owner
   before branches or staff directory facts are loaded.
3. A newly registered account creates no business data until it has a valid,
   email-confirmed session and explicitly completes the R001 creation action.
4. The only browser mutation in this contract is the accepted R001
   `create_business_with_owner_and_branch` RPC. Staff, PIN, device, catalog,
   order, inventory, shift, payment, and Hub authority flows remain outside
   this browser boundary.
5. Password-reset links return through a same-origin `auth=recovery` marker.
   The marker controls presentation only; Supabase Auth decides whether the
   recovery session is valid.
6. A normal `SIGNED_IN` event after a confirmation redirect reconciles the
   confirmed owner with R001 exactly as a direct owner sign-in does. Duplicate
   sign-in notifications must not open or mutate an additional browser
   context.

## Privacy and failure rules

- Do not log email addresses, user IDs, business IDs, passwords, access
  tokens, reset links, or raw Supabase errors from browser access flows.
- Authentication failure copy is intentionally non-enumerating.
- A failed owner-context lookup leaves the browser without a business context;
  it does not fall back to a legacy workspace or browser-held staff state.
- A failed recovery request tells the user to check their inbox without
  confirming whether an account exists.
- An unconfigured/malformed browser Auth client or mismatched owner portal
  origin renders no credential form and sends no sign-in, signup, or recovery
  request.
- An unconfirmed Auth user cannot call the R001 foundation RPC from this
  browser journey, even if a provider unexpectedly supplies a session.
- A failed business creation leaves the account authenticated but does not
  assume a partial foundation exists; the owner may retry the atomic RPC after
  reviewing the error.

## Operational boundary

This contract does not relax ADR-003. Browser owner access cannot create a
staff session, perform a sale, announce LAN status, claim cloud delivery, or
operate a paired terminal. Those facts continue to require the enrolled
Android Cashier Hub and its signed authorization bundle.
