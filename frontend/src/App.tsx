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

const PACK_OPTIONS = [1, 10, 20, 50, 100, 200]
const TIER_DATA = [
  { name: 'Common', range: '$0.02–$0.05', weight: '80%' },
  { name: 'Uncommon', range: '$0.05–$0.10', weight: '15%' },
  { name: 'Rare', range: '$0.10–$0.25', weight: '4%' },
  { name: 'Ultra Rare', range: '$0.25–$0.50', weight: '0.9%' },
  { name: 'Jackpot', range: '$0.50+', weight: '0.1%' },
]

const RECENT_REWARDS = [
  { pack: '#1842', reward: '$0.08', status: 'Common' },
  { pack: '#1843', reward: '$0.16', status: 'Rare' },
  { pack: '#1844', reward: '$0.41', status: 'Ultra Rare' },
  { pack: '#1845', reward: '$0.03', status: 'Common' },
]

function SharedStocksApp() {
  const [quantity, setQuantity] = useState(10)
  const { publicKey } = useWallet()

  const total = (quantity * 0.1).toFixed(2)

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-mark">S</div>
          <div>
            <div className="brand-name">SharedStocks</div>
            <div className="brand-tag">Give a piece of the future.</div>
          </div>
        </div>

        <nav className="topnav" aria-label="Main navigation">
          <a href="#buy">Buy</a>
          <a href="#how-it-works">How it works</a>
          <a href="#rewards">Rewards</a>
        </nav>

        <WalletMultiButton className="wallet-button" />
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">On-chain stock packs</div>
          <h1>Buy a pack. Gift it. Open it. Discover what future you got.</h1>
          <p>
            SharedStocks mints randomized stock packs on Solana. Every pack is a unique,
            verifiable ownership right, and the reward is determined on-chain using a
            trusted randomness source.
          </p>

          <div className="cta-row">
            <a href="#buy" className="primary-button">
              Buy packs
            </a>
            <a href="#how-it-works" className="secondary-button">
              View flow
            </a>
          </div>

          <div className="stat-grid">
            <div>
              <strong>$0.10</strong>
              <span>per pack</span>
            </div>
            <div>
              <strong>5</strong>
              <span>reward tiers</span>
            </div>
            <div>
              <strong>100%</strong>
              <span>on-chain truth</span>
            </div>
          </div>
        </div>

        <div className="purchase-panel" id="buy">
          <div className="panel-header">
            <div>
              <div className="panel-label">Pack purchase</div>
              <div className="panel-title">Buy SharedStocks</div>
            </div>
            <span className="price-badge">$0.10 each</span>
          </div>

          <div className="quantity-selector">
            {PACK_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={option === quantity ? 'quantity-btn active' : 'quantity-btn'}
                onClick={() => setQuantity(option)}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="total-card">
            <span>Total</span>
            <strong>${total}</strong>
          </div>

          <div className="detail-row">
            <span>Selected packs</span>
            <strong>{quantity}</strong>
          </div>

          <div className="detail-row">
            <span>Wallet</span>
            <strong>{publicKey ? `${publicKey.toString().slice(0, 4)}...${publicKey.toString().slice(-4)}` : 'Not connected'}</strong>
          </div>

          <button type="button" className="checkout-button">
            {publicKey ? 'Confirm purchase' : 'Connect wallet to buy'}
          </button>
        </div>
      </section>

      <section className="reward-section" id="rewards">
        <div className="section-heading">
          <span className="eyebrow">Reward model</span>
          <h2>Higher value tiers are intentionally rarer.</h2>
        </div>

        <div className="reward-grid">
          {TIER_DATA.map((tier) => (
            <article key={tier.name} className="reward-card">
              <div className="reward-chip">{tier.name}</div>
              <div className="reward-range">{tier.range}</div>
              <div className="reward-weight">{tier.weight} of packs</div>
            </article>
          ))}
        </div>
      </section>

      <section className="flow-section" id="how-it-works">
        <div className="section-heading">
          <span className="eyebrow">How it works</span>
          <h2>Everything important lives on-chain.</h2>
        </div>

        <div className="flow-grid">
          <div className="flow-step">
            <span>1</span>
            <h3>Buy</h3>
            <p>Buy pack(s) with USDC and mint the unique pack NFT to the buyer.</p>
          </div>
          <div className="flow-step">
            <span>2</span>
            <h3>Gift</h3>
            <p>Transfer unopened packs to another wallet without a backend database.</p>
          </div>
          <div className="flow-step">
            <span>3</span>
            <h3>Open</h3>
            <p>Only the pack owner can open it, and the action triggers verifiable randomness.</p>
          </div>
          <div className="flow-step">
            <span>4</span>
            <h3>Claim</h3>
            <p>Rewards are allocated from configured tiers and claim status is validated on-chain.</p>
          </div>
        </div>
      </section>

      <section className="recent-section">
        <div className="section-heading">
          <span className="eyebrow">Recent pack outcomes</span>
          <h2>Sample reward distribution</h2>
        </div>

        <div className="recent-list">
          {RECENT_REWARDS.map((item) => (
            <div key={item.pack} className="recent-item">
              <span>Pack {item.pack}</span>
              <strong>{item.reward}</strong>
              <em>{item.status}</em>
            </div>
          ))}
        </div>
      </section>
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
