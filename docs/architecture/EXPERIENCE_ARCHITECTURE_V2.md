# ThePlugOS Experience Architecture v2

## Product promise

**The whole business, moving as one.**

ThePlugOS is the operating layer between a small-business owner and the daily movement of orders, stock, staff, cash, devices, and decisions. The interface must feel like a calm control system built for a real trading day—not a generic dashboard and not a conventional POS.

## Experience principles

1. **Work first.** The next operational action is always more prominent than configuration or explanation.
2. **Calm under pressure.** Urgency is encoded through hierarchy and status, not visual noise.
3. **Offline is a mode.** Local operation remains trustworthy when the cloud is unavailable.
4. **One system, different stations.** Each role sees a distinct workspace inside a recognizable shared shell.
5. **Plain language.** Operator-facing labels describe the business effect; engineering language stays in administrator surfaces.
6. **Touch is the baseline.** Primary targets are at least 48px, spacing survives imprecise taps, and hover is never required.
7. **Truth has provenance.** Live, local, queued, and last-updated states are explicit.

## Surface model

### 1. Arrival

The public landing page must answer four questions within the first viewport:

- What is ThePlugOS?
- Who is it for?
- What does it coordinate?
- What should I do next?

The hero demonstrates the business heartbeat using realistic South African small-business data. It does not use generic analytics charts or stock photography.

Primary action: **Set up my business**  
Secondary action: **Open ThePlugOS**  
Tertiary device action: **Pair a device**

### 2. Access

Authentication is a focused panel layered over the arrival surface. Sign-in, business creation, and device pairing remain separate modes, but they are not equal-weight tabs competing for attention.

- Sign-in is the default returning-user action.
- Business creation is a guided start action.
- Device pairing is a clearly labelled terminal action.
- Form submission, validation, and backend methods remain unchanged.

### 3. Operating shell

The shell is composed of:

- **Identity rail:** product, active workspace, business, and branch.
- **Business status strip:** local/cloud state, sync queue, device status, and active shift.
- **Primary workspace:** role-specific operational task.
- **Utility menu:** lock, switch operator, diagnostics, pairing, and sign out.

Secondary infrastructure controls must not occupy the same visual level as a cashier checkout or kitchen progression action.

## Role hierarchy

| Role | Primary question | Primary surface | Secondary surfaces |
| --- | --- | --- | --- |
| Cashier | “What is the customer buying?” | Catalog and current basket | Collection queue, receipt search, shift close |
| Kitchen | “What must be prepared next?” | Ordered production queue | Ready hand-off and completed orders |
| Manager | “What needs intervention today?” | Exceptions and branch pulse | Stock, staff, suppliers, shifts, customers |
| Owner | “Is the business healthy?” | Business heartbeat | Branches, sales, margins, people, inventory, devices |
| Administrator | “Is the operating system healthy?” | Runtime and event health | Security, topology, diagnostics |

## Visual system

### Palette

- **Ink 950** `#10120F` — primary text and deep operating surfaces
- **Canvas** `#F4F1E8` — public and management background
- **Paper** `#FCFAF5` — cards, sheets, and form surfaces
- **Signal** `#F4B942` — brand and deliberate primary action
- **Signal dark** `#C98710` — accessible action emphasis
- **Live** `#1F8A5B` — healthy/local/live state
- **Alert** `#C84A3A` — destructive or blocked state
- **Muted** `#6F746C` — secondary text
- **Line** `#D9D5CA` — structural border

Dark operating workspaces may use Ink surfaces, but the public entry and owner/manager intelligence surfaces should use warmer canvas tones to avoid an undifferentiated “dark admin template” appearance.

### Typography

- Human-readable grotesk or system sans for interface and prose
- Tabular numerals for money, order numbers, timers, and counts
- Minimum default interface size of 14px; 12px only for supporting metadata
- Sentence case for operator labels; uppercase reserved for short status codes

### Shape and depth

- Moderate radii (12–20px), not rounded cards at every nesting level
- Borders establish structure; shadows are reserved for floating access panels
- Dense operational screens use fewer containers and stronger alignment
- Status is shown with label + icon or label + dot, never colour alone

## Responsive rules

### Mobile (360–767px)

- Landing navigation collapses to primary actions.
- Access panel becomes a full-height sheet.
- Workspace controls prioritize the current transaction or queue.
- Tables become labelled records or horizontally scroll only when comparison is essential.

### Tablet (768–1199px)

- Cashier uses catalog/basket split where space permits.
- Kitchen preserves wide, tappable queue cards.
- Shell utilities collapse into a labelled overflow panel.

### Desktop (1200px+)

- Owner and manager surfaces use a stable navigation rail or compact section switcher.
- Content width follows the information task, not a universal max-width card stack.

## Accessibility contract

- 48px minimum primary touch controls
- Visible `:focus-visible` treatment on all interactive elements
- WCAG AA text contrast
- Form errors connected to their fields and announced where practical
- Dialog semantics, labelled close actions, and escape-key dismissal
- Reduced-motion support
- No essential meaning conveyed by colour, animation, hover, or icon alone

## Acceptance criteria

- A new visitor understands the product before being asked for credentials.
- A returning operator reaches sign-in in one action.
- Device pairing remains directly accessible without competing with owner registration.
- Role routing, backend requests, events, and state transitions are unchanged.
- Each role's primary task dominates its first viewport.
- Local/cloud state is visible but does not distract from the primary task.
- Mobile, tablet, and desktop layouts remain usable without clipped primary actions.
- The app passes TypeScript and production-build validation.

