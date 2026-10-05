import React from 'react';
import {
  ArrowRight,
  BarChart3,
  Banknote,
  Boxes,
  ChefHat,
  CircleCheck,
  Clock3,
  PackageCheck,
  Radio,
  ShieldCheck,
  ShoppingBag,
  Store,
  Users,
  WifiOff,
} from 'lucide-react';

interface MarketingLandingProps {
  onSignIn: () => void;
  onCreateBusiness: () => void;
}

const orderFlow = [
  { id: '#1842', item: '2× Kota Special', state: 'Preparing', tone: 'amber' },
  { id: '#1841', item: 'Chips + Russian', state: 'Ready', tone: 'green' },
  { id: '#1840', item: 'Family Combo', state: 'Collected', tone: 'neutral' },
];

const movements = [
  {
    number: '01',
    icon: ShoppingBag,
    title: 'The sale begins the story.',
    copy: 'Capture the order in seconds, take payment and send the right work to the right station.',
  },
  {
    number: '02',
    icon: ChefHat,
    title: 'The team sees what moves next.',
    copy: 'Kitchen and fulfilment queues update as the order progresses—without shouting across the shop.',
  },
  {
    number: '03',
    icon: Boxes,
    title: 'Stock follows the truth.',
    copy: 'Every completed movement becomes a reliable stock signal and an early warning before service stops.',
  },
  {
    number: '04',
    icon: BarChart3,
    title: 'The owner sees the business.',
    copy: 'Sales, pace, exceptions and branch health become one live operational picture from anywhere.',
  },
];

const roles = [
  { role: 'Cashier', line: 'Sell fast. Keep the queue moving.', icon: Banknote, accent: 'cashier' },
  { role: 'Kitchen', line: 'Know what is next and how long it has waited.', icon: ChefHat, accent: 'kitchen' },
  { role: 'Manager', line: 'Act on today’s exceptions before they grow.', icon: ShieldCheck, accent: 'manager' },
  { role: 'Owner', line: 'See the heartbeat without standing at the counter.', icon: BarChart3, accent: 'owner' },
  { role: 'Administrator', line: 'Keep the operating system healthy and trusted.', icon: Radio, accent: 'admin' },
];

const BrandMark = ({ small = false }: { small?: boolean }) => (
  <span className={`plug-brand-mark${small ? ' is-small' : ''}`} aria-hidden="true">
    <span />
    <span />
    <span />
    <span />
  </span>
);

export const MarketingLanding: React.FC<MarketingLandingProps> = ({
  onSignIn,
  onCreateBusiness
}) => {
  return (
    <div className="plug-landing" id="top">
      <header className="plug-site-nav">
        <a className="plug-brand" href="#top" aria-label="ThePlugOS home">
          <BrandMark />
          <span>ThePlugOS</span>
        </a>

        <nav className="plug-nav-links" aria-label="Landing page sections">
          <a href="#system">The system</a>
          <a href="#roles">Built for the whole team</a>
          <a href="#offline">Works offline</a>
        </nav>

        <button className="plug-nav-action" type="button" onClick={onSignIn}>
          Open ThePlugOS
          <ArrowRight aria-hidden="true" />
        </button>
      </header>

      <main>
        <section className="plug-hero" aria-labelledby="plug-hero-title">
          <div className="plug-hero-copy">
            <p className="plug-eyebrow">
              <span className="plug-live-dot" aria-hidden="true" />
              A small business operating system
            </p>
            <h1 id="plug-hero-title">Your whole business. Moving as one.</h1>
            <p className="plug-hero-lede">
              Orders, kitchen, stock, staff, cash and business insight—connected in one calm
              system that keeps working through the rush and through the outage.
            </p>

            <div className="plug-hero-actions">
              <button className="plug-button plug-button-primary" type="button" onClick={onCreateBusiness}>
                Set up my business
                <ArrowRight aria-hidden="true" />
              </button>
              <a className="plug-button plug-button-quiet" href="#system">
                See how it works
              </a>
            </div>

            <div className="plug-proof-strip" aria-label="ThePlugOS operating areas">
              <span>Sell</span><i aria-hidden="true" />
              <span>Fulfil</span><i aria-hidden="true" />
              <span>Stock</span><i aria-hidden="true" />
              <span>Understand</span>
            </div>
          </div>

          <div className="plug-heartbeat-wrap" aria-label="Illustrative business heartbeat">
            <div className="plug-orbit plug-orbit-one" aria-hidden="true" />
            <div className="plug-orbit plug-orbit-two" aria-hidden="true" />

            <article className="plug-heartbeat-card">
              <header className="plug-heartbeat-header">
                <div>
                  <span className="plug-micro-label">Business heartbeat</span>
                  <h2>Soweto Central</h2>
                </div>
                <span className="plug-status-pill"><span /> Illustrative preview</span>
              </header>

              <div className="plug-metric-row">
                <div className="plug-metric plug-metric-primary">
                  <span>Today&apos;s sales</span>
                  <strong>R 8,460</strong>
                  <small>↑ 12% from last Tuesday</small>
                </div>
                <div className="plug-metric">
                  <span>Orders</span>
                  <strong>86</strong>
                  <small>R98 average</small>
                </div>
                <div className="plug-metric">
                  <span>Avg. prep</span>
                  <strong>06:42</strong>
                  <small>Inside target</small>
                </div>
              </div>

              <div className="plug-flow-head">
                <div>
                  <span className="plug-micro-label">Illustrative order flow</span>
                  <strong>3 example movements</strong>
                </div>
                <span className="plug-local-note">Cloud queued: 4</span>
              </div>

              <div className="plug-order-flow">
                {orderFlow.map((order) => (
                  <div className="plug-flow-row" key={order.id}>
                    <span className={`plug-flow-signal ${order.tone}`} aria-hidden="true" />
                    <strong>{order.id}</strong>
                    <span>{order.item}</span>
                    <em className={`plug-flow-state ${order.tone}`}>{order.state}</em>
                  </div>
                ))}
              </div>

              <footer className="plug-heartbeat-footer">
                <span><b>4</b> devices connected</span>
                <span><b>18</b> items in stock alert</span>
                <span className="plug-pulse-label">Local engine healthy</span>
              </footer>
            </article>

            <aside className="plug-floating-note plug-note-orders">
              <span className="plug-note-icon"><CircleCheck aria-hidden="true" /></span>
              <span><small>Order #1841</small><strong>Ready for counter</strong></span>
            </aside>
            <aside className="plug-floating-note plug-note-stock">
              <span className="plug-note-icon alert"><PackageCheck aria-hidden="true" /></span>
              <span><small>Stock signal</small><strong>Russian rolls · 18 left</strong></span>
            </aside>
          </div>
        </section>

        <section className="plug-system-intro" id="system">
          <p className="plug-section-kicker">One operational truth</p>
          <h2>Not another dashboard. The place where work moves.</h2>
          <p>
            Every sale becomes a fulfilment action, a stock movement, a cash record and a
            business signal—without the owner needing to stand behind the counter.
          </p>
        </section>

        <section className="plug-movement-section" aria-labelledby="movement-title">
          <div className="plug-section-heading">
            <p className="plug-section-kicker">The business movement</p>
            <h2 id="movement-title">One action carries through the whole system.</h2>
          </div>
          <div className="plug-movement-grid">
            {movements.map(({ number, icon: Icon, title, copy }) => (
              <article className="plug-movement-card" key={number}>
                <div className="plug-movement-top">
                  <span>{number}</span>
                  <Icon aria-hidden="true" />
                </div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="plug-offline-section" id="offline" aria-labelledby="offline-title">
          <div className="plug-offline-copy">
            <p className="plug-section-kicker">Local-first by design</p>
            <h2 id="offline-title">When the internet stops, the shop does not.</h2>
            <p>
              Cashier, kitchen and local devices keep moving together on the shop network.
              The cloud catches up when the connection returns.
            </p>
            <ul>
              <li><CircleCheck aria-hidden="true" /> Orders continue locally</li>
              <li><CircleCheck aria-hidden="true" /> Kitchen queues stay connected</li>
              <li><CircleCheck aria-hidden="true" /> Events sync safely when online</li>
            </ul>
          </div>

          <div className="plug-network-card" aria-label="Local network status example">
            <div className="plug-network-head">
              <span><WifiOff aria-hidden="true" /> Illustrative outage</span>
              <strong>Example local mode</strong>
            </div>
            <div className="plug-network-line" aria-hidden="true">
              <i /><i /><i /><i />
            </div>
            <div className="plug-device-grid">
              <div><Store aria-hidden="true" /><span><strong>Cashier hub</strong><small>Connected · live</small></span></div>
              <div><ChefHat aria-hidden="true" /><span><strong>Kitchen screen</strong><small>Connected · live</small></span></div>
              <div><Users aria-hidden="true" /><span><strong>Manager tablet</strong><small>Connected · live</small></span></div>
            </div>
            <footer>
              <span><Clock3 aria-hidden="true" /> 4 events safely queued</span>
              <span>Auto-sync on reconnect</span>
            </footer>
          </div>
        </section>

        <section className="plug-roles-section" id="roles" aria-labelledby="roles-title">
          <div className="plug-section-heading plug-role-heading">
            <p className="plug-section-kicker">One system, different stations</p>
            <h2 id="roles-title">Every person sees the work that belongs to them.</h2>
          </div>
          <div className="plug-role-grid">
            {roles.map(({ role, line, icon: Icon, accent }) => (
              <article className={`plug-role-card ${accent}`} key={role}>
                <div><Icon aria-hidden="true" /><span>{role}</span></div>
                <p>{line}</p>
                <span className="plug-role-arrow" aria-hidden="true">↗</span>
              </article>
            ))}
          </div>
        </section>

        <section className="plug-final-cta">
          <div>
            <p className="plug-section-kicker">Ready for a calmer trading day?</p>
            <h2>Put the whole business on the same page.</h2>
          </div>
          <div className="plug-final-actions">
            <button className="plug-button plug-button-light" type="button" onClick={onCreateBusiness}>
              Set up ThePlugOS <ArrowRight aria-hidden="true" />
            </button>
            <button className="plug-text-action" type="button" onClick={onSignIn}>
              Sign in to manage your business
            </button>
          </div>
        </section>
      </main>

      <footer className="plug-site-footer">
        <a className="plug-brand" href="#top">
          <BrandMark small />
          <span>ThePlugOS</span>
        </a>
        <p>Local-first operational intelligence for small businesses.</p>
        <button type="button" onClick={onSignIn}>Open the operating system <ArrowRight aria-hidden="true" /></button>
      </footer>
    </div>
  );
};
