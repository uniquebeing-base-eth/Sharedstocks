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
export const JUPITER_API_URL = import.meta.env.VITE_JUPITER_API_URL ?? 'https://api.jup.ag/swap/v1'

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

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  try {
    return await readJson<T>(await fetch(input, init))
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
      throw new Error('Jupiter is unreachable right now. Check your network connection and try again.')
    }
    throw error
  }
}

function toBaseUnits(amountUsd: number): string {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) throw new Error('Enter a valid USDC amount.')
  return Math.round(amountUsd * 10 ** USDC_DECIMALS).toString()
}

function parseUiAmount(rawAmount: string, decimals: number): number {
  return Number(rawAmount) / 10 ** decimals
}

export async function loadWalletHoldings(
  connection: Connection,
  owner: PublicKey,
  supportedMints: Set<string>,
): Promise<Holding[]> {
  const accounts = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
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
}

async function readActualOutput(
  connection: Connection,
  signature: string,
  owner: PublicKey,
  outputMint: string,
): Promise<Holding> {
  const transaction = await connection.getParsedTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
  if (!transaction?.meta) throw new Error('The confirmed transaction has no readable token metadata.')

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
}

export async function executePreStockSwap({
  connection,
  wallet,
  outputMint,
  amountUsd,
  slippageBps = 100,
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
  const quoteUrl = new URL(`${JUPITER_API_URL}/quote`)
  quoteUrl.searchParams.set('inputMint', USDC_MINT.toBase58())
  quoteUrl.searchParams.set('outputMint', mint.toBase58())
  quoteUrl.searchParams.set('amount', inputAmount)
  quoteUrl.searchParams.set('slippageBps', String(slippageBps))
  quoteUrl.searchParams.set('restrictIntermediateTokens', 'true')
  const quote = await fetchJson<JupiterQuote>(quoteUrl)
  if (!quote.routePlan?.length) throw new Error('Jupiter found no route for this PreStock.')

  const swap = await fetchJson<JupiterSwapResponse>(`${JUPITER_API_URL}/swap`, {
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
  await connection.confirmTransaction(signature, 'confirmed')
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
  await connection.confirmTransaction(signature, 'confirmed')
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
