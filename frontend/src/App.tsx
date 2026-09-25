import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
} from '@solana/wallet-adapter-react'
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { clusterApiUrl, type Cluster } from '@solana/web3.js'
import { useEffect, useMemo, useState } from 'react'
import '@solana/wallet-adapter-react-ui/styles.css'
import './App.css'
import { fetchPreStocks, type PreStock } from './prestocksApi'

const PACK_OPTIONS = [1, 10, 20, 50, 100, 200]

type ViewState = 'home' | 'buy' | 'packs' | 'portfolio' | 'explore'
type PackFilter = 'all' | 'unpacked' | 'opened' | 'gifted'

function formatUsd(value: number | undefined): string {
  return value === undefined
    ? '--'
    : `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatValue(value: number | undefined): string {
  if (value === undefined) return '--'
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toLocaleString()}`
}

function ExploreView({ onBack }: { onBack: () => void }) {
  const [stocks, setStocks] = useState<PreStock[]>([])
  const [selectedStock, setSelectedStock] = useState<PreStock | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadStocks = (forceRefresh = false) => {
    setLoading(true)
    setError(null)
    fetchPreStocks(forceRefresh)
      .then(setStocks)
      .catch(() => setError('PreStocks is unavailable right now. Please try again.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchPreStocks()
      .then(setStocks)
      .catch(() => setError('PreStocks is unavailable right now. Please try again.'))
      .finally(() => setLoading(false))
  }, [])

  const filteredStocks = stocks.filter((stock) => {
    const searchText = `${stock.name} ${stock.symbol}`.toLowerCase()
    return searchText.includes(query.trim().toLowerCase())
  })

  return (
    <section className="explore-view">
      <div className="explore-heading">
        <div>
          <button type="button" className="back-link" onClick={onBack}>← Back home</button>
          <span className="panel-label">PreStocks discovery</span>
          <h2>Explore Pre-IPO Stocks</h2>
          <p>Discover companies available through PreStocks.</p>
        </div>
        <button type="button" className="mini-button" onClick={() => loadStocks(true)} disabled={loading}>
          Refresh
        </button>
      </div>

      <label className="search-field">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder="Search companies or symbols"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {loading && <div className="explore-state">Loading the latest PreStocks...</div>}
      {error && (
        <div className="explore-state error-state">
          <strong>{error}</strong>
          <button type="button" className="secondary-button" onClick={() => loadStocks(true)}>Try again</button>
        </div>
      )}
      {!loading && !error && filteredStocks.length === 0 && (
        <div className="explore-state">No PreStocks match your search.</div>
      )}

      {!loading && !error && filteredStocks.length > 0 && (
        <div className="stock-grid">
          {filteredStocks.map((stock) => (
            <button type="button" className="stock-card" key={stock.symbol} onClick={() => setSelectedStock(stock)}>
              {stock.image ? <img src={stock.image} alt="" className="stock-logo" /> : <div className="stock-logo fallback-logo">{stock.symbol.slice(0, 1)}</div>}
              <div className="stock-card-copy">
                <span className="stock-symbol">{stock.symbol}</span>
                <strong>{stock.name.replace(/ PreStocks$/, '')}</strong>
                <span className="stock-price">{formatUsd(stock.tokenPrice)}</span>
                <small>Valuation: {formatValue(stock.impliedValuation ?? stock.markValuation)}</small>
              </div>
              <span className="stock-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      )}

      {selectedStock && (
        <div className="detail-backdrop" onClick={() => setSelectedStock(null)}>
          <article className="stock-detail" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="sheet-close" onClick={() => setSelectedStock(null)} aria-label="Close details">×</button>
            {selectedStock.image ? <img src={selectedStock.image} alt="" className="detail-logo" /> : <div className="detail-logo fallback-logo">{selectedStock.symbol.slice(0, 1)}</div>}
            <span className="stock-symbol">{selectedStock.symbol}</span>
            <h3>{selectedStock.name.replace(/ PreStocks$/, '')}</h3>
            <div className="detail-metrics">
              <div><span>Token price</span><strong>{formatUsd(selectedStock.tokenPrice)}</strong></div>
              <div><span>Mark price</span><strong>{formatUsd(selectedStock.markPrice)}</strong></div>
              <div><span>Valuation</span><strong>{formatValue(selectedStock.impliedValuation ?? selectedStock.markValuation)}</strong></div>
              <div><span>Token supply</span><strong>{selectedStock.supply?.toLocaleString() ?? '--'}</strong></div>
            </div>
            <p className="detail-description">{selectedStock.description ?? 'No description was provided by PreStocks.'}</p>
            <div className="detail-address"><span>PreStocks mint address</span><code>{selectedStock.contractAddress ?? 'Not provided'}</code></div>
            {selectedStock.externalUrl && <a className="sheet-primary detail-link" href={selectedStock.externalUrl} target="_blank" rel="noreferrer">View on PreStocks ↗</a>}
          </article>
        </div>
      )}
    </section>
  )
}

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

          <div className="topbar-actions">
            <button
              type="button"
              className={activeView === 'explore' ? 'nav-button active' : 'nav-button'}
              onClick={() => setActiveView('explore')}
            >
              Explore
            </button>
            <WalletMultiButton className="wallet-button" />
          </div>
        </header>

        {activeView === 'explore' ? (
          <ExploreView onBack={() => setActiveView('home')} />
        ) : (
          <>

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
          </>
        )}

        {activeView !== 'home' && activeView !== 'explore' && (
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
  const endpoint = useMemo(() => {
    const network = (import.meta.env.VITE_SOLANA_NETWORK ?? 'mainnet-beta') as Cluster
    return import.meta.env.VITE_SOLANA_RPC_URL ?? clusterApiUrl(network)
  }, [])
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
