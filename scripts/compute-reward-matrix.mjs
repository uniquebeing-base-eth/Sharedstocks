const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com'
const API_URL = 'https://prestocks.com/api/prestocks'
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const MAINNET_TREASURY = 'Cg5jju2XcxFvX8zU6JsFHFg2vMz23chXX1iz4dbB2v6r'
const DEPLOYER = 'CSG6s9GRvGASXzjTJCcDsn6A76Z7XYczFrxaCF9unPVf'
const PROGRAM_ID = 'HCqpbmtJqBaTPoD23QLCQDTF8shAR2Xa82CNoMikZAGj'
const TARGET_CENTS = [3n, 6n, 10n, 30n, 50n]
const REWARD_WEIGHTS_BPS = [8000, 1500, 400, 90, 10]
const ASSETS = {
  ANTHROPIC: 'Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw',
  ANDURIL: 'PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB',
  OPENAI: 'PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF',
  NEURALINK: 'PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S',
  FIGUREAI: 'PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd',
  KALSHI: 'PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua',
  POLYMARKET: 'Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP',
}

function fraction(value) {
  const text = String(value)
  const [whole, fractionPart = ''] = text.split('.')
  const scale = 10n ** BigInt(fractionPart.length)
  return { numerator: BigInt(`${whole}${fractionPart}`), denominator: scale }
}

async function rpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const payload = await response.json()
  if (payload.error) throw new Error(`${method}: ${payload.error.message}`)
  return payload.result
}

const apiResponse = await fetch(API_URL)
if (!apiResponse.ok) throw new Error(`PreStocks API returned ${apiResponse.status}`)
const apiStocks = await apiResponse.json()
const bySymbol = new Map(apiStocks.map((stock) => [stock.symbol, stock]))
const accounts = await rpc('getMultipleAccounts', [Object.values(ASSETS), { encoding: 'jsonParsed' }])

const matrix = {}
for (const [index, [symbol, mint]] of Object.entries(ASSETS).entries()) {
  const stock = bySymbol.get(symbol)
  if (!stock || typeof stock.tokenPrice !== 'number' || stock.tokenPrice <= 0) {
    throw new Error(`Missing positive tokenPrice for ${symbol}`)
  }
  const account = accounts.value[index]
  if (!account || account.owner !== TOKEN_2022_PROGRAM || account.data?.program !== 'spl-token-2022') {
    throw new Error(`${symbol} is not a Token-2022 mint`)
  }
  const info = account.data.parsed.info
  const decimals = info.decimals
  const price = fraction(stock.tokenPrice)
  const amounts = TARGET_CENTS.map((cents) =>
    (cents * price.denominator * (10n ** BigInt(decimals)) / (100n * price.numerator)).toString(),
  )
  const feeConfig = info.extensions?.find((extension) => extension.extension === 'transferFeeConfig')
  if (!feeConfig) throw new Error(`${symbol} has no verifiable transfer-fee configuration`)
  const currentFee = feeConfig.state.newerTransferFee
  matrix[symbol] = {
    mint,
    apiTokenPrice: stock.tokenPrice,
    decimals,
    transferFeeBasisPoints: currentFee.transferFeeBasisPoints,
    transferFeeEpoch: currentFee.epoch,
    amounts,
  }
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  rpc: RPC_URL,
  targetsUsd: ['0.03', '0.06', '0.10', '0.30', '0.50'],
  weightsBasisPoints: [8000, 1500, 400, 90, 10],
  initialization: {
    network: 'mainnet-beta',
    programId: PROGRAM_ID,
    authority: DEPLOYER,
    treasury: MAINNET_TREASURY,
    usdcMint: MAINNET_USDC_MINT,
    packPriceBaseUnits: '100000',
    rewardWeightsBasisPoints: REWARD_WEIGHTS_BPS,
  },
  matrix,
}, null, 2))
