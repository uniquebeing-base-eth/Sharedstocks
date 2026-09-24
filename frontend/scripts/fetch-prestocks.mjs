import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const API_URL = 'https://prestocks.com/api/prestocks'
const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), '../public/prestocks.json')

const response = await fetch(API_URL)
if (!response.ok) {
  throw new Error(`PreStocks returned ${response.status}`)
}

const payload = await response.json()
if (!Array.isArray(payload)) {
  throw new Error('PreStocks returned an unexpected response')
}

await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
console.log(`Fetched ${payload.length} PreStocks into public/prestocks.json`)
