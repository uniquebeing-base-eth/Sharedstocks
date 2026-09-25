import {
  ConnectionProvider,
  WalletProvider,
  useConnection,
  useWallet,
} from '@solana/wallet-adapter-react'
import {
  WalletDisconnectButton,
  WalletModalProvider,
  WalletMultiButton,
} from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets'
import { PublicKey, type Cluster } from '@solana/web3.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import '@solana/wallet-adapter-react-ui/styles.css'
import './App.css'
import { fetchPreStocks, type PreStock } from './prestocksApi'
import appIcon from './assets/hero.png'
import {
  executePreStockSwap,
  giftPreStock,
  loadWalletHoldings,
  transactionErrorMessage,
  type Holding,
  type PurchaseStatus,
} from './solanaExecution'

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

function shortAddress(value: string): string {
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function purchaseStatusLabel(status: PurchaseStatus | null): string {
  if (status === 'preparing') return 'Preparing purchase'
  if (status === 'getting-quote') return 'Getting quote'
  if (status === 'awaiting-wallet') return 'Awaiting wallet confirmation'
  if (status === 'submitted') return 'Transaction submitted'
  if (status === 'confirming') return 'Confirming on Solana'
  if (status === 'confirmed') return 'Purchase confirmed'
  if (status === 'received') return 'Stocks received'
  return ''
}

function holdingValue(holding: Holding, stocks: PreStock[]): number {
  const stock = stocks.find((item) => item.contractAddress === holding.mint)
  return holding.amount * (stock?.tokenPrice ?? 0)
}

function formatHoldingAmount(holding: Holding): string {
  const amount = BigInt(holding.rawAmount)
  const scale = 10n ** BigInt(holding.decimals)
  const whole = (amount / scale).toString()
  const fraction = (amount % scale).toString().padStart(holding.decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

type WalletActivity = { bought: number; gifted: number; signatures: string[] }

type HoldingsSyncState = {
  walletAddress: string
  verifiedAt: number | null
  refreshing: boolean
  error: string | null
}

function emptyWalletActivity(): WalletActivity {
  return { bought: 0, gifted: 0, signatures: [] }
}

function readWalletActivity(walletAddress: string): WalletActivity {
  try {
    const stored = localStorage.getItem(`sharedstocks-activity:${walletAddress}`)
    if (!stored) return emptyWalletActivity()
    const activity = JSON.parse(stored) as Partial<WalletActivity>
    return {
      bought: Number.isFinite(activity.bought) ? Number(activity.bought) : 0,
      gifted: Number.isFinite(activity.gifted) ? Number(activity.gifted) : 0,
      signatures: Array.isArray(activity.signatures) ? activity.signatures.filter((signature): signature is string => typeof signature === 'string') : [],
    }
  } catch {
    return emptyWalletActivity()
  }
}

function writeWalletActivity(walletAddress: string, activity: WalletActivity): void {
  try {
    localStorage.setItem(`sharedstocks-activity:${walletAddress}`, JSON.stringify(activity))
  } catch {
    // Keep the current session usable when browser storage is unavailable.
  }
}

function recordWalletActivity(walletAddress: string, kind: 'bought' | 'gifted', amount: number, signature: string): WalletActivity {
  const activity = readWalletActivity(walletAddress)
  if (activity.signatures.includes(signature)) return activity
  const nextActivity: WalletActivity = {
    bought: activity.bought + (kind === 'bought' ? amount : 0),
    gifted: activity.gifted + (kind === 'gifted' ? amount : 0),
    signatures: [...activity.signatures, signature],
  }
  writeWalletActivity(walletAddress, nextActivity)
  return nextActivity
}

function readWalletHoldings(walletAddress: string): Holding[] {
  try {
    const stored = localStorage.getItem(`sharedstocks-holdings:${walletAddress}`)
    if (!stored) return []
    const parsed: unknown = JSON.parse(stored)
    const cached = Array.isArray(parsed)
      ? parsed
      : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { holdings?: unknown }).holdings)
        ? (parsed as { holdings: unknown[] }).holdings
        : []
    return cached.map((item) => ({
      mint: String(item.mint),
      amount: Number(item.amount),
      rawAmount: String(item.rawAmount),
      decimals: Number(item.decimals),
      tokenProgram: new PublicKey(String(item.tokenProgram)),
      tokenAccount: item.tokenAccount ? new PublicKey(String(item.tokenAccount)) : undefined,
    })).filter((holding) => holding.mint && holding.rawAmount !== '0' && Number.isFinite(holding.amount))
  } catch {
    return []
  }
}

function writeWalletHoldings(walletAddress: string, holdings: Holding[], verifiedAt = Date.now()): void {
  try {
    localStorage.setItem(`sharedstocks-holdings:${walletAddress}`, JSON.stringify({
      holdings: holdings.map((holding) => ({
        ...holding,
        tokenProgram: holding.tokenProgram.toBase58(),
        tokenAccount: holding.tokenAccount?.toBase58(),
      })),
      verifiedAt,
    }))
  } catch {
    // Keep the current session usable when browser storage is unavailable.
  }
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
  const [stocks, setStocks] = useState<PreStock[]>([])
  const [holdingsState, setHoldingsState] = useState<{ walletAddress: string; holdings: Holding[] }>({
    walletAddress: '',
    holdings: [],
  })
  const [holdingsSync, setHoldingsSync] = useState<HoldingsSyncState>({ walletAddress: '', verifiedAt: null, refreshing: false, error: null })
  const [selectedSymbol, setSelectedSymbol] = useState('')
  const [purchaseStatus, setPurchaseStatus] = useState<PurchaseStatus | null>(null)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)
  const [purchaseSignature, setPurchaseSignature] = useState<string | null>(null)
  const [purchasedHolding, setPurchasedHolding] = useState<Holding | null>(null)
  const [giftMode, setGiftMode] = useState<'pending' | 'choice' | 'form' | 'complete' | null>(null)
  const [walletActivityState, setWalletActivityState] = useState<{ walletAddress: string; activity: WalletActivity }>({
    walletAddress: '',
    activity: emptyWalletActivity(),
  })
  const [isGifting, setIsGifting] = useState(false)
  const [giftTarget, setGiftTarget] = useState<Holding | null>(null)
  const [giftAmount, setGiftAmount] = useState('')
  const [giftRecipient, setGiftRecipient] = useState('')
  const [giftError, setGiftError] = useState<string | null>(null)
  const [giftSignature, setGiftSignature] = useState<string | null>(null)
  const { connection } = useConnection()
  const { publicKey, sendTransaction } = useWallet()

  const total = (quantity * 0.1).toFixed(2)
  const walletAddress = publicKey?.toBase58() ?? ''
  const holdings = walletAddress
    ? holdingsState.walletAddress === walletAddress
      ? holdingsState.holdings
      : readWalletHoldings(walletAddress)
    : []
  const activeHoldingsSync = holdingsSync.walletAddress === walletAddress ? holdingsSync : null
  const walletActivity = walletAddress
    ? walletActivityState.walletAddress === walletAddress
      ? walletActivityState.activity
      : readWalletActivity(walletAddress)
    : emptyWalletActivity()

  useEffect(() => {
    fetchPreStocks().then((availableStocks) => {
      setStocks(availableStocks)
      if (!selectedSymbol) setSelectedSymbol(availableStocks.find((stock) => stock.contractAddress)?.symbol ?? '')
    }).catch(() => setStocks([]))
  }, [selectedSymbol])

  const refreshHoldings = useCallback(async () => {
    if (!publicKey) {
      setHoldingsState({ walletAddress: '', holdings: [] })
      return false
    }
    const ownerAddress = publicKey.toBase58()
    setHoldingsState((currentState) => currentState.walletAddress === ownerAddress
      ? currentState
      : { walletAddress: ownerAddress, holdings: readWalletHoldings(ownerAddress) })
    if (stocks.length === 0) return false
    const supportedMints = new Set(stocks.flatMap((stock) => stock.contractAddress ? [stock.contractAddress] : []))
    setHoldingsSync({ walletAddress: ownerAddress, verifiedAt: null, refreshing: true, error: null })
    try {
      const nextHoldings = await loadWalletHoldings(connection, publicKey, supportedMints)
      const verifiedAt = Date.now()
      setHoldingsState({ walletAddress: ownerAddress, holdings: nextHoldings })
      writeWalletHoldings(ownerAddress, nextHoldings, verifiedAt)
      setHoldingsSync({ walletAddress: ownerAddress, verifiedAt, refreshing: false, error: null })
      return true
    } catch (error) {
      setHoldingsSync((current) => ({
        walletAddress: ownerAddress,
        verifiedAt: current.walletAddress === ownerAddress ? current.verifiedAt : null,
        refreshing: false,
        error: transactionErrorMessage(error),
      }))
      return false
    }
  }, [connection, publicKey, stocks])

  useEffect(() => {
    refreshHoldings()
  }, [refreshHoldings])

  const selectedStock = stocks.find((stock) => stock.symbol === selectedSymbol && stock.contractAddress)

  const handlePurchase = async () => {
    if (!publicKey || !selectedStock?.contractAddress) return
    setPurchaseError(null)
    setPurchaseSignature(null)
    setPurchaseStatus(null)
    setGiftMode(null)
    setPurchasedHolding(null)
    try {
      const result = await executePreStockSwap({
        connection,
        wallet: { publicKey, sendTransaction },
        outputMint: selectedStock.contractAddress,
        amountUsd: Number(total),
        slippageBps: 500,
        onStatus: setPurchaseStatus,
        onSubmitted: (signature) => {
          setPurchaseSignature(signature)
          setGiftMode('pending')
        },
      })
      setPurchaseSignature(result.signature)
      const purchaser = publicKey.toBase58()
      const nextActivity = recordWalletActivity(purchaser, 'bought', result.holding.amount, result.signature)
      setWalletActivityState({ walletAddress: purchaser, activity: nextActivity })
      setHoldingsState((currentState) => {
        const currentHoldings = currentState.walletAddress === purchaser
          ? currentState.holdings
          : readWalletHoldings(purchaser)
        const existing = currentHoldings.find((holding) => holding.mint === result.holding.mint)
        const nextHoldings = !existing
          ? [...currentHoldings, result.holding]
          : currentHoldings.map((holding) => holding.mint === result.holding.mint
          ? {
              ...holding,
              amount: holding.amount + result.holding.amount,
              rawAmount: (BigInt(holding.rawAmount) + BigInt(result.holding.rawAmount)).toString(),
            }
          : holding)
        writeWalletHoldings(purchaser, nextHoldings)
        return { walletAddress: purchaser, holdings: nextHoldings }
      })
      await refreshHoldings()
      setPurchasedHolding(result.holding)
      setGiftMode('choice')
    } catch (error) {
      setPurchaseStatus(null)
      setPurchaseError(transactionErrorMessage(error))
    }
  }

  const handleGift = async () => {
    if (!publicKey || !giftTarget || isGifting) return
    setGiftError(null)
    setGiftSignature(null)
    setIsGifting(true)
    try {
      const result = await giftPreStock({
        connection,
        wallet: { publicKey, sendTransaction },
        holding: giftTarget,
        recipientAddress: giftRecipient.trim(),
        amount: giftAmount,
      })
      setGiftSignature(result.signature)
      const sender = publicKey.toBase58()
      const nextActivity = recordWalletActivity(sender, 'gifted', result.holding.amount, result.signature)
      setWalletActivityState({ walletAddress: sender, activity: nextActivity })
      setGiftRecipient('')
      setGiftAmount('')
      setHoldingsState((currentState) => {
        const currentHoldings = currentState.walletAddress === sender
          ? currentState.holdings
          : readWalletHoldings(sender)
        const nextHoldings = currentHoldings
          .map((holding) => holding.mint === giftTarget.mint
          ? {
              ...holding,
              amount: holding.amount - result.holding.amount,
              rawAmount: (BigInt(holding.rawAmount) - BigInt(result.holding.rawAmount)).toString(),
            }
          : holding)
          .filter((holding) => holding.rawAmount !== '0')
        writeWalletHoldings(sender, nextHoldings)
        return { walletAddress: sender, holdings: nextHoldings }
      })
      await refreshHoldings()
      if (purchasedHolding?.mint === giftTarget.mint) setGiftMode('complete')
    } catch (error) {
      setGiftError(transactionErrorMessage(error))
    } finally {
      setIsGifting(false)
    }
  }

  const totalHoldingValue = holdings.reduce((totalValue, holding) => totalValue + holdingValue(holding, stocks), 0)
  const collectedShares = holdings.reduce((count, holding) => count + holding.amount, 0)
  const onchainMetrics = [
    { label: 'PreStocks bought', value: walletActivity.bought.toLocaleString(undefined, { maximumFractionDigits: 4 }), hint: 'Shares bought in this app' },
    { label: 'PreStocks gifted', value: walletActivity.gifted.toLocaleString(undefined, { maximumFractionDigits: 4 }), hint: 'Shares gifted in this app' },
    { label: 'PreStocks collected', value: collectedShares.toLocaleString(undefined, { maximumFractionDigits: 4 }), hint: 'Shares currently in your wallet' },
    { label: 'Total value', value: `$${totalHoldingValue.toFixed(2)}`, hint: 'Estimated collection value in USDC' },
  ]

  const packCards = [
    { id: 'In your collection', count: collectedShares, tone: 'purple' },
    { id: 'Companies', count: holdings.length, tone: 'blue' },
    { id: 'Collection value', count: totalHoldingValue, tone: 'orange' },
  ]

  return (
    <main className="app-shell">
      <div className="content-card">
        <header className="topbar">
          <div className="brand-wrap">
            <img className="brand-mark" src={appIcon} alt="" />
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
            {publicKey && <WalletDisconnectButton className="disconnect-button" />}
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
              Discover PreStocks, add them to your collection, and gift a share of the future to someone you care about.
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
                  <strong>{card.id === 'Collection value' ? `$${card.count.toFixed(2)}` : card.count.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="simple-section">
          <h3>How it works</h3>
          <p>SharedStocks makes owning and gifting PreStocks simple.</p>

          <div className="simple-grid">
            <div className="simple-step">
              <div className="simple-icon coin-icon" aria-hidden="true">◍</div>
              <div className="step-copy">
                <strong>Choose a PreStock</strong>
                <span>Pick a company you want to invest in.</span>
              </div>
            </div>

            <div className="simple-step">
              <div className="simple-icon gift-icon" aria-hidden="true">✦</div>
              <div className="step-copy">
                <strong>Buy a Pack</strong>
                <span>Choose how much you want to invest and complete the purchase.</span>
              </div>
            </div>

            <div className="simple-step">
              <div className="simple-icon chart-icon" aria-hidden="true">↗</div>
              <div className="step-copy">
                <strong>Keep or Gift</strong>
                <span>Keep your PreStock or gift the shares to another wallet.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="info-section">
          <div className="info-panel">
            <span className="panel-label">How it works</span>
            <h3>Own a collection of future-facing companies.</h3>
            <ol>
              <li><strong>Choose a PreStock.</strong> Pick a company from the available PreStocks.</li>
              <li><strong>Buy a pack.</strong> Choose how much you want to invest and pay with USDC.</li>
              <li><strong>Keep or gift.</strong> Your new PreStock appears in My Packs, ready to keep or share.</li>
              <li><strong>Watch your collection grow.</strong> Return to My Packs to see what you own.</li>
            </ol>
          </div>

          <div className="info-panel">
            <span className="panel-label">Beginner guide</span>
            <h3>A simple guide to PreStocks.</h3>
            <ul>
              <li><strong>PreStocks</strong> are digital shares that represent a company you want to follow and own.</li>
              <li><strong>Buying a pack</strong> uses USDC to purchase the PreStock you selected. It is not active trading.</li>
              <li><strong>Keep It</strong> leaves the shares in your wallet and your My Packs collection.</li>
              <li><strong>Gift It</strong> sends the exact shares from that purchase to a friend&apos;s Solana wallet.</li>
              <li>Your collection shows the shares you own and their estimated USDC value based on the current PreStock price.</li>
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

                  <label className="search-field stock-picker-field">
                    <span aria-hidden="true">◈</span>
                    <select value={selectedSymbol} onChange={(event) => setSelectedSymbol(event.target.value)}>
                      <option value="">Choose a PreStock</option>
                      {stocks.filter((stock) => stock.contractAddress).map((stock) => (
                        <option key={stock.symbol} value={stock.symbol}>{stock.symbol} — {stock.name.replace(/ PreStocks$/, '')}</option>
                      ))}
                    </select>
                  </label>

                  {selectedStock && <p className="portfolio-note">Jupiter will swap the exact USDC amount into {selectedStock.symbol}. The received token amount is verified from Solana after confirmation.</p>}
                  {purchaseStatus && <div className="transaction-status">{purchaseStatusLabel(purchaseStatus)}</div>}
                  {purchaseError && <div className="explore-state error-state">{purchaseError}</div>}

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

                  {publicKey ? (
                    <button type="button" className="sheet-primary" onClick={handlePurchase} disabled={Boolean(purchaseStatus) || !selectedStock}>
                      {purchaseStatus ? purchaseStatusLabel(purchaseStatus) : 'Buy Packs'}
                    </button>
                  ) : (
                    <WalletMultiButton className="sheet-wallet-button" />
                  )}
                  {purchaseSignature && <a className="transaction-link" href={`https://solscan.io/tx/${purchaseSignature}`} target="_blank" rel="noreferrer">View confirmed swap ↗</a>}
                </>
              )}

              {activeView === 'packs' && (
                <>
                  <div className="sheet-header">My Packs</div>
                  <div className="pack-status-grid">
                    <div className="pack-status-card purple">
                      <span>Shares owned</span>
                      <strong>{holdings.reduce((count, holding) => count + holding.amount, 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong>
                    </div>
                    <div className="pack-status-card blue">
                      <span>Companies</span>
                      <strong>{holdings.length}</strong>
                    </div>
                    <div className="pack-status-card orange">
                      <span>Value in USDC</span>
                      <strong>${totalHoldingValue.toFixed(2)}</strong>
                    </div>
                  </div>
                  <div className="holdings-refresh-row">
                    <div className="portfolio-note">
                      {activeHoldingsSync?.refreshing
                        ? 'Checking your token accounts on Solana…'
                        : activeHoldingsSync?.error
                          ? `Showing saved holdings. Latest Solana read failed: ${activeHoldingsSync.error}`
                          : activeHoldingsSync?.verifiedAt
                            ? `Wallet holdings verified on Solana at ${new Date(activeHoldingsSync.verifiedAt).toLocaleTimeString()}.`
                            : 'Saved holdings appear while your wallet is checked on Solana.'}
                    </div>
                    {publicKey && <button type="button" className="mini-button" onClick={() => { void refreshHoldings() }} disabled={Boolean(activeHoldingsSync?.refreshing)}>{activeHoldingsSync?.refreshing ? 'Refreshing…' : 'Refresh'}</button>}
                  </div>
                  {activeHoldingsSync?.error && <div className="explore-state error-state holdings-error">{activeHoldingsSync.error}</div>}
                  {!publicKey && (
                    <div className="portfolio-placeholder">
                      <div className="portfolio-badge">Connect your wallet to see your collection</div>
                      <WalletMultiButton className="sheet-wallet-button" />
                    </div>
                  )}
                  {publicKey && holdings.length === 0 && <div className="portfolio-placeholder"><div className="portfolio-badge">Your collection is waiting for its first PreStock</div></div>}
                  <div className="holding-list">
                    {holdings.map((holding) => {
                      const stock = stocks.find((item) => item.contractAddress === holding.mint)
                      return (
                        <div className="holding-row" key={holding.mint}>
                          <div><strong>{stock?.symbol ?? shortAddress(holding.mint)}</strong><span>{stock?.name.replace(/ PreStocks$/, '') ?? holding.mint}</span></div>
                          <div className="holding-value"><strong>{holding.amount.toLocaleString(undefined, { maximumFractionDigits: 9 })}</strong><span>${holdingValue(holding, stocks).toFixed(2)} USDC</span></div>
                          <button type="button" className="mini-button" onClick={() => { setGiftTarget(holding); setGiftAmount(formatHoldingAmount(holding)); setGiftRecipient(''); setGiftError(null); setGiftSignature(null) }}>Gift</button>
                        </div>
                      )
                    })}
                  </div>
                  {giftTarget && (
                    <div className="gift-form">
                      <div className="gift-form-heading">
                        <div className="sheet-header">Gift {stocks.find((stock) => stock.contractAddress === giftTarget.mint)?.symbol ?? 'PreStock'}</div>
                        <button type="button" className="gift-cancel" onClick={() => setGiftTarget(null)} aria-label="Cancel gift">×</button>
                      </div>
                      <label className="gift-field-label">Friend&apos;s Solana wallet address
                        <input value={giftRecipient} onChange={(event) => setGiftRecipient(event.target.value)} placeholder="Paste wallet address" aria-label="Recipient Solana address" />
                      </label>
                      <label className="gift-field-label">Amount to gift
                        <input value={giftAmount} onChange={(event) => setGiftAmount(event.target.value)} placeholder={`Amount up to ${giftTarget.amount}`} inputMode="decimal" aria-label="Amount to gift" />
                      </label>
                      <p className="gift-preview">Your friend will receive <strong>{giftAmount || '0'} {stocks.find((stock) => stock.contractAddress === giftTarget.mint)?.symbol ?? 'PreStock'}</strong>.</p>
                      {giftError && <div className="explore-state error-state">{giftError}</div>}
                      {giftSignature && <div className="portfolio-badge gift-success">Gift confirmed. Your collection has been updated.</div>}
                      <button type="button" className="sheet-primary" onClick={handleGift} disabled={!giftRecipient || !giftAmount || isGifting}>{isGifting ? 'Waiting for wallet approval…' : giftSignature ? 'Gift sent' : 'Review and send gift'}</button>
                      {giftSignature && (
                        <>
                          <a className="transaction-link" href={`https://solscan.io/tx/${giftSignature}`} target="_blank" rel="noreferrer">View confirmed transfer ↗</a>
                        </>
                      )}
                    </div>
                  )}
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

        {giftMode && (purchasedHolding || giftMode === 'pending') && (
          <div className="celebration-backdrop">
            <div className="celebration-card" role="dialog" aria-modal="true" aria-labelledby="purchase-complete-title">
              <button type="button" className="sheet-close" onClick={() => { setGiftMode(null); setActiveView('packs') }} aria-label="Close purchase confirmation">×</button>
              {giftMode === 'pending' && (
                <>
                  <div className="celebration-mark" aria-hidden="true">✦</div>
                  <span className="panel-label">Purchase sent</span>
                  <h2 id="purchase-complete-title">Your PreStock is on its way.</h2>
                  <p>We&apos;re confirming your purchase now. Your Keep It and Gift It choices will be ready as soon as your shares arrive.</p>
                  {purchaseSignature && <a className="transaction-link" href={`https://solscan.io/tx/${purchaseSignature}`} target="_blank" rel="noreferrer">View transaction ↗</a>}
                  {purchaseError && <div className="explore-state error-state">{purchaseError}</div>}
                </>
              )}
              {giftMode === 'choice' && purchasedHolding && (
                <>
                  <div className="celebration-mark" aria-hidden="true">✦</div>
                  <span className="panel-label">Purchase complete</span>
                  <h2 id="purchase-complete-title">Hurray! 🎉<br />You just invested in your future.</h2>
                  <p>Do you want to keep this fantastic share or share the love with someone?</p>
                  <div className="choice-grid">
                    <button type="button" className="choice-button keep" onClick={() => { setGiftMode(null); setActiveView('packs') }}>
                      <strong>Keep It</strong>
                      <span>Keep {purchasedHolding.amount.toLocaleString(undefined, { maximumFractionDigits: 9 })} shares in your collection.</span>
                    </button>
                    <button type="button" className="choice-button gift" onClick={() => { setGiftTarget(purchasedHolding); setGiftAmount(formatHoldingAmount(purchasedHolding)); setGiftError(null); setGiftSignature(null); setGiftMode('form') }}>
                      <strong>Gift It</strong>
                      <span>Share the exact shares you just purchased.</span>
                    </button>
                  </div>
                </>
              )}
              {giftMode === 'form' && purchasedHolding && (
                <>
                  <span className="panel-label">Share the love</span>
                  <h2 id="purchase-complete-title">Gift your new {stocks.find((stock) => stock.contractAddress === purchasedHolding.mint)?.symbol ?? 'PreStock'}</h2>
                  <p>Your friend will receive the exact amount from this purchase.</p>
                  <div className="gift-receive-card">
                    <span>They will receive</span>
                    <strong>{purchasedHolding.amount.toLocaleString(undefined, { maximumFractionDigits: 9 })} {stocks.find((stock) => stock.contractAddress === purchasedHolding.mint)?.symbol ?? 'PreStock'}</strong>
                  </div>
                  <input value={giftRecipient} onChange={(event) => setGiftRecipient(event.target.value)} placeholder="Friend's Solana wallet address" aria-label="Friend's Solana wallet address" />
                  {giftError && <div className="explore-state error-state">{giftError}</div>}
                  <button type="button" className="sheet-primary" onClick={handleGift} disabled={!giftRecipient || isGifting || Boolean(giftSignature)}>{isGifting ? 'Waiting for wallet approval…' : 'Confirm Gift'}</button>
                  <button type="button" className="secondary-button" onClick={() => { setGiftMode(null); setActiveView('packs') }}>Keep It Instead</button>
                </>
              )}
              {giftMode === 'complete' && purchasedHolding && (
                <>
                  <div className="celebration-mark" aria-hidden="true">✓</div>
                  <span className="panel-label">Gift sent</span>
                  <h2 id="purchase-complete-title">Your PreStock is on its way.</h2>
                  <p>Your friend now has the shares you just purchased. Your own collection has been updated.</p>
                  {giftSignature && <a className="transaction-link" href={`https://solscan.io/tx/${giftSignature}`} target="_blank" rel="noreferrer">View gift confirmation ↗</a>}
                  <button type="button" className="sheet-primary" onClick={() => { setGiftMode(null); setActiveView('packs') }}>Go to My Packs</button>
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
    const envRpc = import.meta.env.VITE_SOLANA_RPC_URL
    const fallbackRpc = network === 'devnet'
      ? 'https://api.devnet.solana.com'
      : 'https://solana-rpc.publicnode.com'
    return envRpc ?? fallbackRpc
  }, [])
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  )

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect onError={(error) => console.error('Wallet connection error:', error)}>
        <WalletModalProvider>
          <SharedStocksApp />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

export default App
