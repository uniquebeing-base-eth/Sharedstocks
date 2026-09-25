import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getMint,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type SendTransactionError,
} from '@solana/web3.js'

export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
export const USDC_DECIMALS = 6
const DEFAULT_JUPITER_API_URLS = [
  import.meta.env.VITE_JUPITER_API_URL,
  'https://api.jup.ag/swap/v1',
  'https://lite-api.jup.ag/swap/v1',
].filter((url): url is string => Boolean(url))
export const JUPITER_API_URLS = Array.from(new Set(DEFAULT_JUPITER_API_URLS))
export const JUPITER_API_URL = JUPITER_API_URLS[0] ?? 'https://api.jup.ag/swap/v1'

const DEFAULT_SOLANA_RPC_URLS = [
  import.meta.env.VITE_SOLANA_RPC_URL,
  import.meta.env.VITE_SOLANA_NETWORK === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com',
  'https://rpc.ankr.com/solana',
  'https://public-rpc.blockpi.io',
].filter((url): url is string => Boolean(url))

export function getSolanaRpcUrls(primaryEndpoint?: string): string[] {
  return Array.from(new Set([primaryEndpoint, ...DEFAULT_SOLANA_RPC_URLS].filter((url): url is string => Boolean(url))))
}

function isRpcAccessError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /403|Access forbidden|Failed to fetch|fetch failed|429|rate limit/i.test(message)
}

async function withRpcFallback<T>(
  primaryConnection: Connection,
  operation: (connection: Connection) => Promise<T>,
  primaryEndpoint?: string,
): Promise<T> {
  const rpcUrls = getSolanaRpcUrls(primaryEndpoint ?? (primaryConnection as Connection & { rpcEndpoint?: string }).rpcEndpoint)
  let lastError: unknown

  for (const rpcUrl of rpcUrls) {
    const connection = rpcUrl === primaryEndpoint || rpcUrl === (primaryConnection as Connection & { rpcEndpoint?: string }).rpcEndpoint
      ? primaryConnection
      : new Connection(rpcUrl, 'confirmed')

    try {
      return await operation(connection)
    } catch (error) {
      lastError = error
      if (!isRpcAccessError(error)) {
        throw error
      }
    }
  }

  throw lastError ?? new Error('Solana RPC is unavailable right now.')
}

export async function getWalletBalanceWithFallback(
  connection: Connection,
  owner: PublicKey,
): Promise<number> {
  return withRpcFallback(connection, async (rpcConnection) => rpcConnection.getBalance(owner, 'confirmed'))
}

export type PurchaseStatus =
  | 'preparing'
  | 'getting-quote'
  | 'awaiting-wallet'
  | 'submitted'
  | 'confirming'
  | 'confirmed'
  | 'received'

export type Holding = {
  mint: string
  amount: number
  rawAmount: string
  decimals: number
  tokenProgram: PublicKey
}

type JupiterQuote = {
  inputMint: string
  outputMint: string
  inAmount: string
  outAmount: string
  otherAmountThreshold: string
  swapMode: string
  slippageBps: number
  routePlan: unknown[]
}

type JupiterSwapResponse = {
  swapTransaction: string
}

type WalletSigner = {
  sendTransaction: (transaction: Transaction | import('@solana/web3.js').VersionedTransaction, connection: Connection) => Promise<string>
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `Request failed with ${response.status}`)
  }
  return response.json() as Promise<T>
}

async function fetchJupiterJson<T>(path: string, init?: RequestInit, params?: Record<string, string>): Promise<T> {
  const urls = JUPITER_API_URLS.map((base) => {
    const url = new URL(path, `${base.replace(/\/$/, '')}/`)
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value)
    return url
  })

  let lastError: unknown
  for (const url of urls) {
    try {
      return await readJson<T>(await fetch(url, init))
    } catch (error) {
      lastError = error
      if (!(error instanceof TypeError) || error.message !== 'Failed to fetch') {
        throw error
      }
    }
  }

  if (lastError instanceof TypeError && lastError.message === 'Failed to fetch') {
    throw new Error('Jupiter is unreachable right now. Check your network connection and try again.')
  }

  throw lastError ?? new Error('Jupiter request failed.')
}

function toBaseUnits(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('Enter a valid USDC amount.')
  return Math.round(amountUsd * 10 ** USDC_DECIMALS).toString()
}

function parseUiAmount(rawAmount: string, decimals: number): number {
  return Number(rawAmount) / 10 ** decimals
}

async function confirmTransactionWithRetry(
  connection: Connection,
  signature: string,
  commitment: 'processed' | 'confirmed' | 'finalized' = 'confirmed',
  timeoutMs = 90_000,
): Promise<void> {
  const primaryEndpoint = (connection as Connection & { rpcEndpoint?: string }).rpcEndpoint
  const rpcUrls = getSolanaRpcUrls(primaryEndpoint)
  let lastError: unknown

  for (const rpcUrl of rpcUrls) {
    const rpcConnection = rpcUrl === primaryEndpoint ? connection : new Connection(rpcUrl, 'confirmed')
    const startedAt = Date.now()

    try {
      await rpcConnection.confirmTransaction(signature, commitment)
      return
    } catch (error) {
      lastError = error
      if (!isRpcAccessError(error)) throw error
    }

    while (Date.now() - startedAt < timeoutMs) {
      try {
        const statuses = await rpcConnection.getSignatureStatuses([signature], { searchTransactionHistory: true })
        const status = statuses.value?.[0]
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return
        if (status?.err) {
          throw new Error(`Transaction failed on Solana: ${JSON.stringify(status.err)}`)
        }
      } catch (error) {
        lastError = error
        if (!isRpcAccessError(error)) throw error
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  }

  throw lastError instanceof Error && lastError.message.includes('Transaction failed on Solana')
    ? lastError
    : new Error(`Transaction was not confirmed in ${timeoutMs / 1000} seconds. It is unknown if it succeeded or failed. Check signature ${signature} using the Solana Explorer or CLI tools.`)
}

export async function loadWalletHoldings(
  connection: Connection,
  owner: PublicKey,
  supportedMints: Set<string>,
): Promise<Holding[]> {
  return withRpcFallback(connection, async (rpcConnection) => {
    const accounts = await Promise.all([
      rpcConnection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      rpcConnection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
    ])

    return accounts
      .flatMap((result) => result.value)
      .map((account) => {
        const parsed = account.account.data.parsed.info
        const mint = String(parsed.mint)
        const rawAmount = String(parsed.tokenAmount.amount)
        return {
          mint,
          amount: Number(parsed.tokenAmount.uiAmount ?? 0),
          rawAmount,
          decimals: Number(parsed.tokenAmount.decimals),
          tokenProgram: account.account.owner,
        }
      })
      .filter((holding) => supportedMints.has(holding.mint) && holding.rawAmount !== '0')
  }, (connection as Connection & { rpcEndpoint?: string }).rpcEndpoint)
}

async function readActualOutput(
  connection: Connection,
  signature: string,
  owner: PublicKey,
  outputMint: string,
): Promise<Holding> {
  const primaryEndpoint = (connection as Connection & { rpcEndpoint?: string }).rpcEndpoint
  const rpcUrls = getSolanaRpcUrls(primaryEndpoint)
  let lastError: unknown

  for (const rpcUrl of rpcUrls) {
    const rpcConnection = rpcUrl === primaryEndpoint ? connection : new Connection(rpcUrl, 'confirmed')
    try {
      const transaction = await rpcConnection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      })
      if (!transaction?.meta) {
        throw new Error('The confirmed transaction has no readable token metadata.')
      }

      const before = new Map<string, { amount: string; decimals: number; owner: string; program: PublicKey }>()
      for (const balance of transaction.meta.preTokenBalances ?? []) {
        if (balance.owner) {
          before.set(`${balance.accountIndex}:${balance.mint}`, {
            amount: balance.uiTokenAmount.amount,
            decimals: balance.uiTokenAmount.decimals,
            owner: balance.owner,
            program: balance.programId ? new PublicKey(balance.programId) : TOKEN_PROGRAM_ID,
          })
        }
      }

      let receivedRaw = 0n
      let decimals = 0
      let tokenProgram = TOKEN_PROGRAM_ID
      for (const balance of transaction.meta.postTokenBalances ?? []) {
        if (balance.mint !== outputMint || balance.owner !== owner.toBase58()) continue
        const previous = before.get(`${balance.accountIndex}:${balance.mint}`)
        receivedRaw += BigInt(balance.uiTokenAmount.amount) - BigInt(previous?.amount ?? '0')
        decimals = balance.uiTokenAmount.decimals
        tokenProgram = balance.programId ? new PublicKey(balance.programId) : (previous?.program ?? TOKEN_PROGRAM_ID)
      }

      if (receivedRaw <= 0n) throw new Error('The confirmed swap did not deliver the requested PreStock token.')
      return {
        mint: outputMint,
        amount: parseUiAmount(receivedRaw.toString(), decimals),
        rawAmount: receivedRaw.toString(),
        decimals,
        tokenProgram,
      }
    } catch (error) {
      lastError = error
      if (!isRpcAccessError(error) && !(error instanceof Error && error.message === 'The confirmed transaction has no readable token metadata.')) {
        throw error
      }
    }
  }

  throw lastError ?? new Error('The confirmed transaction could not be verified on the Solana RPC network.')
}

export async function executePreStockSwap({
  connection,
  wallet,
  outputMint,
  amountUsd,
  slippageBps = 500,
  onStatus,
}: {
  connection: Connection
  wallet: WalletSigner & { publicKey: PublicKey }
  outputMint: string
  amountUsd: number
  slippageBps?: number
  onStatus?: (status: PurchaseStatus) => void
}): Promise<{ signature: string; holding: Holding }> {
  const mint = new PublicKey(outputMint)
  onStatus?.('preparing')
  const inputAmount = toBaseUnits(amountUsd)

  onStatus?.('getting-quote')
  const quote = await fetchJupiterJson<JupiterQuote>('quote', undefined, {
    inputMint: USDC_MINT.toBase58(),
    outputMint: mint.toBase58(),
    amount: inputAmount,
    slippageBps: String(slippageBps),
    restrictIntermediateTokens: 'true',
  })
  if (!quote.routePlan?.length) throw new Error('Jupiter found no route for this PreStock.')

  const swap = await fetchJupiterJson<JupiterSwapResponse>('swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: false,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  })

  const transactionBytes = Uint8Array.from(atob(swap.swapTransaction), (character) => character.charCodeAt(0))
  const transaction = VersionedTransaction.deserialize(transactionBytes)
  onStatus?.('awaiting-wallet')
  const signature = await wallet.sendTransaction(transaction, connection)
  onStatus?.('submitted')
  onStatus?.('confirming')
  await confirmTransactionWithRetry(connection, signature, 'confirmed', 90_000)
  onStatus?.('confirmed')
  const holding = await readActualOutput(connection, signature, wallet.publicKey, mint.toBase58())
  onStatus?.('received')
  return { signature, holding }
}

export async function giftPreStock({
  connection,
  wallet,
  holding,
  recipientAddress,
  amount,
}: {
  connection: Connection
  wallet: WalletSigner & { publicKey: PublicKey }
  holding: Holding
  recipientAddress: string
  amount: number
}): Promise<{ signature: string; recipient: string; holding: Holding }> {
  const recipient = new PublicKey(recipientAddress)
  if (recipient.equals(wallet.publicKey)) throw new Error('Choose a recipient wallet different from your own.')
  if (!Number.isFinite(amount) || amount <= 0 || amount > holding.amount) throw new Error('Enter an amount within your available balance.')

  const mint = new PublicKey(holding.mint)
  const source = await getAssociatedTokenAddress(mint, wallet.publicKey, false, holding.tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID)
  const destination = await getAssociatedTokenAddress(mint, recipient, false, holding.tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID)
  const recipientBefore = await loadWalletHoldings(connection, recipient, new Set([mint.toBase58()]))
  const beforeRaw = BigInt(recipientBefore.find((item) => item.mint === mint.toBase58())?.rawAmount ?? '0')
  const destinationInfo = await connection.getAccountInfo(destination)
  const transaction = new Transaction()
  if (!destinationInfo) {
    transaction.add(createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      destination,
      recipient,
      mint,
      holding.tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ))
  }

  const mintInfo = await getMint(connection, mint, 'confirmed', holding.tokenProgram)
  const rawAmount = BigInt(Math.round(amount * 10 ** mintInfo.decimals))
  transaction.add(createTransferCheckedInstruction(
    source,
    mint,
    destination,
    wallet.publicKey,
    Number(rawAmount),
    mintInfo.decimals,
    [],
    holding.tokenProgram,
  ))

  const signature = await wallet.sendTransaction(transaction, connection)
  await confirmTransactionWithRetry(connection, signature, 'confirmed', 90_000)
  const recipientHoldings = await loadWalletHoldings(connection, recipient, new Set([mint.toBase58()]))
  const received = recipientHoldings.find((item) => item.mint === mint.toBase58())
  const receivedRaw = BigInt(received?.rawAmount ?? '0')
  if (!received || receivedRaw - beforeRaw < rawAmount) {
    throw new Error('The transfer confirmed, but the recipient balance could not be verified.')
  }
  return { signature, recipient: recipient.toBase58(), holding: received }
}

export function transactionErrorMessage(error: unknown): string {
  if ((error as SendTransactionError)?.logs?.length) return 'The wallet transaction failed on Solana. Please try again.'
  if (error instanceof Error) return error.message
  return 'The Solana transaction could not be completed.'
}
