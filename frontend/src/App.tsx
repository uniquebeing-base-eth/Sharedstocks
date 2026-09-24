import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from '@solana/wallet-adapter-react'
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { clusterApiUrl } from '@solana/web3.js'
import { useMemo, useState } from 'react'
import '@solana/wallet-adapter-react-ui/styles.css'
import './App.css'

const PACK_OPTIONS = [1, 10, 20, 50, 100, 200]

type ViewState = 'home' | 'buy' | 'packs' | 'portfolio'
type PackFilter = 'all' | 'unpacked' | 'opened' | 'gifted'

function SharedStocksApp() {
  const [activeView, setActiveView] = useState<ViewState>('home')
  const [quantity, setQuantity] = useState(20)
  const [packFilter, setPackFilter] = useState<PackFilter>('all')
  const { publicKey } = useWallet()

  const total = (quantity * 0.1).toFixed(2)

  const onchainMetrics = [
    { label: 'Packs bought', value: '--', hint: 'Live data after contract launch' },
    { label: 'Packs gifted', value: '--', hint: 'Gift transfers from chain' },
    { label: 'Packs opened', value: '--', hint: 'Claimable and opened packs' },
    { label: 'Total value', value: '--', hint: 'USDC value from on-chain records' },
  ]

  const packCards = [
    { id: 'Unpacked', count: 0, tone: 'purple' },
    { id: 'Opened', count: 0, tone: 'blue' },
    { id: 'Gifted', count: 0, tone: 'orange' },
  ]

  return (
    <main className="app-shell">
      <div className="content-card">
        <header className="topbar">
          <div className="brand-wrap">
            <div className="brand-mark" aria-hidden="true">
              <span className="brand-mark-inner">S</span>
            </div>
            <h1 className="brand-name">SharedStocks</h1>
          </div>

          <button type="button" className="home-link" onClick={() => setActiveView('home')}>
            Home
          </button>

          <WalletMultiButton className="wallet-button" />
        </header>

        <section className="hero-panel">
          <div className="hero-copy">
            <div className="eyebrow">Pre-IPO Stocks, Made Giftable</div>

            <h2>Give a piece of the future.</h2>

            <p>
              Buy stock packs, open them yourself, or gift unopened packs to someone you care about.
            </p>

            <div className="price-row">
              <span className="price-icon" aria-hidden="true">◌</span>
              <span>$0.10 per pack</span>
            </div>

            <div className="powered-by">Powered by PreStocks</div>

            <div className="cta-stack">
              <button type="button" className="primary-button" onClick={() => setActiveView('buy')}>
                Get Stock Packs <span aria-hidden="true">→</span>
              </button>
              <button type="button" className="secondary-button" onClick={() => setActiveView('packs')}>
                My Packs
              </button>
            </div>
          </div>

          <div className="hero-visual" aria-label="SharedStocks gift box art">
            <div className="visual-glow" />
            <div className="gift-box">
              <div className="gift-box-lid" />
              <div className="gift-box-base" />
              <div className="gift-flower">
                <span className="flower-petal" />
                <span className="flower-petal" />
                <span className="flower-petal" />
                <span className="flower-center" />
              </div>
            </div>
          </div>
        </section>

        <section className="stats-panel">
          {onchainMetrics.map((metric) => (
            <div key={metric.label} className="stat-card">
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.hint}</small>
            </div>
          ))}
        </section>

        <section className="packs-panel">
          <div className="section-head">
            <div>
              <span className="panel-label">Portfolio</span>
              <h3>My Packs</h3>
            </div>
            <button type="button" className="mini-button" onClick={() => setActiveView('packs')}>
              View all
            </button>
          </div>

          <div className="pack-filter-row">
            {(['all', 'unpacked', 'opened', 'gifted'] as PackFilter[]).map((filter) => (
              <button
                key={filter}
                type="button"
                className={packFilter === filter ? 'filter-chip active' : 'filter-chip'}
                onClick={() => setPackFilter(filter)}
              >
                {filter === 'all' ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>

          <div className="pack-summary-grid">
            {packCards.map((card) => (
              <div key={card.id} className={`pack-box ${card.tone}`}>
                <div className="pack-box-visual" aria-hidden="true" />
                <div className="pack-box-copy">
                  <small>{card.id}</small>
                  <strong>{card.count}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="simple-section">
          <h3>It&apos;s simple</h3>
          <p>A few steps to owning a piece of tomorrow&apos;s biggest companies.</p>

          <div className="simple-grid">
            <div className="simple-step">
              <div className="simple-icon coin-icon" aria-hidden="true">◍</div>
              <div className="step-copy">
                <strong>Buy</strong>
                <span>Get stock packs for $0.10 each.</span>
              </div>
            </div>

            <div className="simple-step">
              <div className="simple-icon gift-icon" aria-hidden="true">✦</div>
              <div className="step-copy">
                <strong>Open or Gift</strong>
                <span>Keep it for yourself or send it to someone special.</span>
              </div>
            </div>

            <div className="simple-step">
              <div className="simple-icon chart-icon" aria-hidden="true">↗</div>
              <div className="step-copy">
                <strong>Receive a PreStock</strong>
                <span>Get a real pre-IPO stock, on-chain.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="info-section">
          <div className="info-panel">
            <span className="panel-label">How it works</span>
            <h3>From pack to real pre-IPO ownership.</h3>
            <ol>
              <li>Connect your wallet and buy a pack with USDC.</li>
              <li>Open or gift the pack from your wallet at any time.</li>
              <li>On-chain resolution assigns the reward and records the receipt.</li>
            </ol>
          </div>

          <div className="info-panel">
            <span className="panel-label">Beginner guide</span>
            <h3>What to expect before the contract is live.</h3>
            <ul>
              <li>Wallet connection is required before any pack action is available.</li>
              <li>Pack counts, gifts, open status, and value update from the chain when live.</li>
              <li>All on-chain data stays wallet-owned and verifiable from the program itself.</li>
            </ul>
          </div>
        </section>

        {activeView !== 'home' && (
          <div className="sheet-backdrop" onClick={() => setActiveView('home')}>
            <div className="action-sheet" onClick={(event) => event.stopPropagation()}>
              <button type="button" className="sheet-close" onClick={() => setActiveView('home')} aria-label="Close panel">
                ×
              </button>

              {activeView === 'buy' && (
                <>
                  <div className="sheet-header">Get Stock Packs</div>
                  <p className="sheet-subtitle">Choose how many packs you want to buy.<br />Each pack costs $0.10 USDC.</p>

                  <div className="picker-list">
                    {PACK_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={option === quantity ? 'picker-option active' : 'picker-option'}
                        onClick={() => setQuantity(option)}
                      >
                        <span>{option}</span>
                        <strong>${(option * 0.1).toFixed(2)}</strong>
                      </button>
                    ))}
                  </div>

                  <div className="purchase-summary">
                    <div>
                      <span>Quantity</span>
                      <strong>{quantity}</strong>
                    </div>
                    <div>
                      <span>Total</span>
                      <strong>${total} USDC</strong>
                    </div>
                  </div>

                  <button type="button" className="sheet-primary" onClick={() => publicKey && setActiveView('home')}>
                    {publicKey ? 'Buy Packs' : 'Connect wallet'}
                  </button>
                </>
              )}

              {activeView === 'packs' && (
                <>
                  <div className="sheet-header">My Packs</div>
                  <div className="pack-status-grid">
                    <div className="pack-status-card purple">
                      <span>Unpacked</span>
                      <strong>0</strong>
                    </div>
                    <div className="pack-status-card blue">
                      <span>Opened</span>
                      <strong>0</strong>
                    </div>
                    <div className="pack-status-card orange">
                      <span>Gifted</span>
                      <strong>0</strong>
                    </div>
                  </div>
                  <div className="portfolio-note">
                    Pack records will appear here once the contract is live and wallet data is available on-chain.
                  </div>
                </>
              )}

              {activeView === 'portfolio' && (
                <>
                  <div className="sheet-header">Portfolio</div>
                  <div className="portfolio-placeholder">
                    <div className="portfolio-badge">No on-chain holdings yet</div>
                    <div className="portfolio-note">Connect a wallet to load your actual holdings from the chain.</div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function App() {
  const endpoint = useMemo(() => clusterApiUrl('devnet'), [])
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  )

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <SharedStocksApp />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

export default App
