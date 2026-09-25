export const PRESTOCKS_API_URL = 'https://prestocks.com/api/prestocks'
const PRESTOCKS_SNAPSHOT_URL = '/prestocks.json'
const SUPPORTED_PRESTOCK_SYMBOLS = new Set([
  'ANTHROPIC',
  'ANDURIL',
  'OPENAI',
  'NEURALINK',
  'FIGUREAI',
  'KALSHI',
  'POLYMARKET',
])

export type PreStock = {
  name: string
  symbol: string
  description?: string
  image?: string
  externalUrl?: string
  contractAddress?: string
  markPrice?: number
  markValuation?: number
  tokenPrice?: number
  impliedValuation?: number
  supply?: number
  metadata: Record<string, unknown>
}

type ApiPreStock = Record<string, unknown>

let cachedStocks: PreStock[] | null = null
let pendingRequest: Promise<PreStock[]> | null = null

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeStock(item: ApiPreStock): PreStock {
  return {
    name: asString(item.name) ?? asString(item.companyName) ?? 'Unnamed PreStock',
    symbol: asString(item.symbol) ?? 'UNKNOWN',
    description: asString(item.description),
    image: asString(item.image) ?? asString(item.logo),
    externalUrl: asString(item.external_url) ?? asString(item.externalUrl),
    contractAddress: asString(item.contract_address) ?? asString(item.contractAddress),
    markPrice: asNumber(item.markPrice),
    markValuation: asNumber(item.markValuation),
    tokenPrice: asNumber(item.tokenPrice),
    impliedValuation: asNumber(item.impliedValuation),
    supply: asNumber(item.supply),
    metadata: item,
  }
}

function readSessionCache(): PreStock[] | null {
  try {
    const stored = sessionStorage.getItem('sharedstocks-prestocks')
    return stored ? (JSON.parse(stored) as PreStock[]) : null
  } catch {
    return null
  }
}

function writeSessionCache(stocks: PreStock[]): void {
  try {
    sessionStorage.setItem('sharedstocks-prestocks', JSON.stringify(stocks))
  } catch {
    // Session storage can be unavailable in privacy-restricted browsers.
  }
}

function supportedStocks(stocks: PreStock[]): PreStock[] {
  return stocks.filter((stock) => SUPPORTED_PRESTOCK_SYMBOLS.has(stock.symbol))
}

export async function fetchPreStocks(forceRefresh = false): Promise<PreStock[]> {
  if (!forceRefresh && cachedStocks) return cachedStocks

  if (!forceRefresh) {
    const sessionStocks = readSessionCache()
    if (sessionStocks) {
      cachedStocks = supportedStocks(sessionStocks)
      return cachedStocks
    }
  }

  if (pendingRequest) return pendingRequest

  pendingRequest = fetch(PRESTOCKS_SNAPSHOT_URL, {
    cache: forceRefresh ? 'no-store' : 'default',
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`PreStocks returned ${response.status}`)
      const payload: unknown = await response.json()
      if (!Array.isArray(payload)) throw new Error('PreStocks returned an unexpected response')
      return supportedStocks(payload
        .filter((item): item is ApiPreStock => typeof item === 'object' && item !== null)
        .map(normalizeStock))
    })
    .then((stocks) => {
      cachedStocks = stocks
      writeSessionCache(stocks)
      return stocks
    })
    .finally(() => {
      pendingRequest = null
    })

  return pendingRequest
}
