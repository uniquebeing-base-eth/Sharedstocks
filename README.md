# Sharedstocks
Give a piece of the future. Buy stocks pack, open them yourself or gift unopened packs to someone you care about. 
 prompt:

 SharedStocks — Complete Solana Implementation Specification

1. Product

Build SharedStocks, a Solana application where users buy, gift, and open digital stock packs containing randomized allocations of PreStocks tokenized stocks.

Core positioning:

Give a piece of the future.

The pack itself is the product being purchased and gifted.

The user is not guaranteed a $0.10 stock return from a $0.10 pack. The $0.10 is the pack purchase price. The eventual PreStock allocation is randomized and can be lower or higher, with higher-value allocations becoming increasingly rare.

Only eligible PreStocks assets may be used for the reward system.

⸻

2. Most Important Architecture Principle

Everything important must be on-chain.

There must be no SharedStocks backend/database responsible for:

* pack ownership
* gifting
* randomness
* stock selection
* reward amount
* allocation
* claim eligibility
* claim status

The blockchain is the source of truth.

The frontend is only an interface for reading blockchain state and submitting transactions.

The PreStocks API may be used by the frontend as a read-only information/discovery source for things such as:

* company name
* symbol
* description
* image
* displayed price
* other public metadata

The PreStocks API must NOT be used as the source of truth for:

* pack ownership
* allocations
* claims
* randomness
* balances
* gift ownership

⸻

3. Recommended Solana Architecture

Use:

* Rust
* Anchor
* Solana
* SPL Token / Token-2022 as appropriate for the actual PreStocks assets
* Solana wallet adapter
* React + TypeScript frontend
* Tailwind CSS
* direct RPC reads/writes
* a Solana-compatible verifiable randomness mechanism

Do NOT port the previous Solidity contract directly.

Build a purpose-designed Solana program.

There should be one primary SharedStocks Anchor program containing the business logic.

Do not create a completely separate custom “NFT contract.”

The pack should be represented using Solana’s existing NFT/token infrastructure, while the SharedStocks program controls the rules governing the pack.

Conceptually:

                    SHAREDSTOCKS PROGRAM
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
      Pack NFTs         Randomness       Distribution
          │                 │                 │
      Ownership          Result          Allocation
          │                                   │
       Gifting                            PreStocks
          │                                   │
          └─────────────────┬─────────────────┘
                            │
                          Claim

⸻

4. Pack NFT Model

Every unopened SharedStock should represent a unique pack.

Example:

SharedStocks Pack #1842
Owner: Bob
Status: UNOPENED

The NFT represents the user’s right to open that specific pack.

The pack can be transferred while unopened.

Once opened, it must no longer be transferable as an unopened gift.

Possible lifecycle:

UNOPENED
   │
   ├── transfer/gift
   │
   ↓
UNOPENED
   │
   ↓
OPENED
   │
   ↓
ALLOCATION CREATED
   │
   ↓
CLAIMED
   │
   ↓
CONSUMED/BURNED

Use the simplest secure representation possible.

If normal NFTs are sufficiently efficient for the expected hackathon volume, use them.

If batch quantities such as 100–200 packs make individual NFT creation prohibitively expensive, evaluate compressed/digital-asset approaches, but do not sacrifice the core ownership/gifting semantics.

⸻

5. User Flow

Buy

User connects a Solana wallet.

User selects quantity:

1
10
20
50
100
200

Price:

$0.10 per pack

Examples:

1 = $0.10
10 = $1.00
20 = $2.00
50 = $5.00
100 = $10.00
200 = $20.00

User confirms the transaction.

The program:

1. verifies payment
2. receives the correct USDC amount
3. creates/mints the corresponding SharedStocks packs
4. assigns ownership to the buyer

The resulting ownership must be verifiable directly on Solana.

No backend database should be updated.

⸻

6. Gifting

A user can gift an unopened pack to another Solana address.

Frontend:

My Packs
Pack #1842
[Open] [Gift]

Gift flow:

Recipient Solana address
        ↓
Confirm
        ↓
gift_pack()
        ↓
Pack NFT ownership transferred

Example:

Before:
Pack #1842
Owner: Alice
Status: UNOPENED
After:
Pack #1842
Owner: Bob
Status: UNOPENED

No backend is needed.

The blockchain itself records the new owner.

Important security rule

Only unopened packs can be gifted.

The program must reject:

OPENED → gift
CLAIMED → gift
CONSUMED → gift

⸻

7. Gift Links

Support an optional social gift-link experience.

Example:

sharedstocks.app/gift/<pack-id>

The URL is only a convenience/discovery mechanism.

It must NEVER grant ownership.

When the recipient opens the URL:

1. SharedStocks asks them to connect their wallet.
2. Frontend checks the blockchain.
3. The program/state confirms whether that wallet owns the specified pack.
4. If yes, display the gift.

Example UI:

🎁 You received a Stock Pack
Someone sent you a piece of the future.

[Open Pack]

If the connected wallet does not own the pack, do not allow opening.

Never trust the URL itself.

⸻

8. Opening a Pack

When the owner clicks:

Open Pack

submit the opening transaction.

The program must verify:

caller == pack owner
pack.status == UNOPENED

If either fails, reject the transaction.

The frontend must never choose:

* stock
* stock amount
* reward tier
* randomness

⸻

9. On-Chain / Verifiable Randomness

This is one of the most important parts of the application.

DO NOT use:

Math.random()

Do not use:

* browser randomness
* frontend-generated random numbers
* backend-generated random numbers
* server APIs
* user-supplied random numbers
* predictable timestamps as randomness

The randomness must come from a verifiable Solana-compatible randomness mechanism.

Before implementation, verify the current Solana/Anchor integration and security model of the chosen randomness provider/primitive using its official documentation.

The final result must be verifiable and recorded on-chain.

⸻

10. Random Reward Model

We do NOT want equal probability for every reward.

Most packs should produce relatively small allocations.

Higher-value allocations should become increasingly rare.

Initial target distribution:

COMMON
$0.02–$0.05
~80%
UNCOMMON
$0.05–$0.10
~15%
RARE
$0.10–$0.25
~4%
ULTRA RARE
$0.25–$0.50
~0.9%
JACKPOT
$0.50+
~0.1%

These are initial configuration values.

Make the reward configuration adjustable by the authorized admin/configuration authority without changing the core program.

The probabilities must sum to 100%.

⸻

11. Two-Stage Randomization

Prefer a two-stage model.

Stage 1 — Select reward tier

Use the verifiable random value to select:

Common
Uncommon
Rare
Ultra Rare
Jackpot

according to the configured probabilities.

Example:

0–7999       Common
8000–9499    Uncommon
9500–9899    Rare
9900–9989    Ultra Rare
9990–9999    Jackpot

This is only an example representation; implement safely with integer arithmetic and configurable weights.

Stage 2 — Select reward

Use additional randomness/derived randomness to select:

* eligible PreStock
* allocation amount within the tier

The final result must be deterministic from the verified randomness and on-chain configuration.

The frontend must never influence the result.

⸻

12. Reward Economics

The $0.10 pack price is NOT a guaranteed $0.10 return.

Do NOT advertise:

Buy $0.10 and receive $0.10 of stock.

Do NOT guarantee:

* minimum value
* profit
* equal value
* return of principal
* guaranteed stock value

The actual experience is probabilistic.

Example:

A user could open ten packs and receive:

$0.03 OpenAI
$0.04 SpaceX
$0.02 Anduril
$0.05 Anthropic
$0.03 Neuralink
$0.07 OpenAI
$0.04 SpaceX
$0.13 Anthropic
$0.03 Anduril
$0.02 OpenAI

A much larger reward should be genuinely rare.

⸻

13. Important Price Consideration

Do not make the smart contract dependent on a live API price to determine whether something is “$0.05” or “$0.25.”

The reward system should use configured allocation amounts/units and deterministic on-chain rules.

If USD-denominated display values are required, treat them as frontend presentation.

The contract should ultimately deal with actual token amounts/decimals.

This prevents the reward logic from depending on an external centralized price API.

⸻

14. Eligible PreStocks

Only PreStocks assets are allowed.

Do not integrate unrelated pre-IPO token projects.

Create an on-chain configuration for eligible PreStocks.

For example:

StockConfig
mint
symbol
enabled
tier
allocation configuration

The exact current PreStocks mint addresses must be verified before deployment.

Do not hardcode stale addresses from old documentation or previous conversations.

The program should allow the authorized admin to configure eligible PreStocks.

Example:

OpenAI
SpaceX
Anthropic
Anduril
Neuralink
...

Only assets explicitly configured by the program should be eligible for SharedStocks rewards.

⸻

15. PreStock Vaults

SharedStocks needs program-controlled token vaults containing the actual PreStocks that can be claimed.

Conceptually:

SharedStocks
     │
     ├── OpenAI Vault
     ├── SpaceX Vault
     ├── Anthropic Vault
     ├── Anduril Vault
     └── Neuralink Vault

Admin/funding authority can fund these vaults with eligible PreStock tokens.

Before supporting claims, verify technically that:

* PreStocks tokens are transferable
* their token standard is supported
* program-controlled token accounts can hold them
* normal SPL/token transfers are sufficient
* there are no transfer restrictions requiring a special PreStocks instruction

Do not assume the API proves transferability.

⸻

16. Allocation Account

When a pack is opened, create an on-chain allocation record.

Example:

Allocation #1842
Pack: 1842
Recipient: Bob
Stock Mint: <PreStock mint>
Amount: <token amount>
Tier: COMMON
Claimed: false

This becomes the source of truth for what Bob is entitled to claim.

The frontend reads this account.

⸻

17. Claim

Bob clicks:

Claim Stock

The program verifies:

allocation exists
allocation.recipient == caller
allocation.claimed == false
vault has enough tokens

Then:

SharedStocks vault
        ↓
Bob's token account

Transfer the allocated PreStock tokens.

After a successful transfer:

allocation.claimed = true

Prevent double claiming.

There should be no additional SharedStocks claim fee.

The user only pays the normal Solana transaction/network cost.

⸻

18. Pack Consumption

After the reward has been successfully claimed, the pack should be considered consumed.

Depending on the chosen NFT implementation:

* burn the pack NFT, or
* permanently mark it as consumed

The user must never be able to:

open → claim → open again

or:

open → transfer as unopened

⸻

19. Batch Opening

Support batch opening if practical.

For example:

Open 10 Packs

The program should process each pack safely.

Do not make the frontend play 10 huge animations.

Instead show:

🎉 10 packs opened

Then summarize:

5 Common
3 Uncommon
1 Rare
1 Ultra Rare

and list the allocations.

Batch opening must still use valid randomness for each pack.

Do not reuse one random result for every pack.

⸻

20. Portfolio

Portfolio should be a simple ownership view.

Show:

Your PreStocks
OpenAI
$X.XX
SpaceX
$X.XX
Anthropic
$X.XX

Where possible, derive actual holdings from the user’s wallet/on-chain balances.

Do not create a centralized portfolio database.

PreStocks API can provide metadata and informational price data for display.

⸻

21. Discover / PreStocks Information

Create a simple discovery section:

Explore PreStocks

Show:

* company image
* company name
* symbol
* displayed price
* short description

Use the PreStocks API as a read-only informational source.

This is not ownership state.

If the API is unavailable, the core SharedStocks ownership/claim system should still remain conceptually independent.

⸻

22. Program Configuration

Create an admin/configuration account containing things such as:

pack_price
USDC_mint
admin_authority
paused
reward_tier_weights
eligible_stock_configs

Admin instructions should include only necessary controls:

initialize()
set_pack_price()
add_stock()
remove/disable_stock()
configure_reward_tier()
fund_stock_vault()
pause()
unpause()

The admin must NOT have arbitrary ability to rewrite a user’s:

* pack ownership
* allocation
* claim status

Avoid privileged backdoors.

⸻

23. Security Requirements

Test all of these.

Ownership

A user cannot open another user’s pack.

Double opening

A pack cannot be opened twice.

Double claim

An allocation cannot be claimed twice.

Gift restrictions

Opened/claimed packs cannot be gifted.

Recipient spoofing

A user cannot claim another user’s allocation.

Randomness manipulation

Users cannot select or influence the reward through frontend parameters.

Payment

A buyer cannot mint packs without paying the correct USDC amount.

Arithmetic

Prevent integer overflow/underflow and incorrect decimal handling.

Vault

Cannot claim more tokens than the vault owns.

Mint validation

Only configured PreStock mints can be distributed.

PDA validation

All PDA/token-account relationships must be validated.

Replay

Instructions must not be replayable to create duplicate rewards.

Admin

Admin-only instructions must properly validate authority.

Pause

If the system is paused, purchases/opening/claiming behavior should follow the explicitly defined pause policy.

⸻

24. Frontend Design

Build a polished consumer application.

Do NOT make it look like a traditional DeFi dashboard.

Style:

* white background
* purple primary accent
* clean typography
* generous whitespace
* rounded buttons
* subtle borders
* subtle shadows
* mobile-first
* simple navigation
* no neon
* no shiny 3D
* no excessive animations
* no dense data tables

Pack colors can vary:

* purple
* blue
* red
* orange

These colors are purely visual and must NOT imply rarity unless we explicitly decide to expose rarity visually later.

⸻

25. Home Page

Headline:

Give a piece of the future.

Supporting copy:

Buy stock packs, open them yourself, or gift unopened packs to someone you care about.

Show:

$0.10 per pack
Powered by PreStocks

Primary:

Get Stock Packs

Secondary:

My Portfolio

Explain the basic flow:

Buy
 ↓
Open or Gift
 ↓
Receive a PreStock

⸻

26. My Packs

Show:

My Packs
12 unopened packs

Each pack can show:

SharedStock Pack
#1842
[Open]
[Gift]

Allow batch selection.

⸻

27. Gift UI

Simple form:

Send this pack to
Solana address
[________________]
[Send Gift]

After confirmation:

🎁 Gift sent

Provide optional share link:

sharedstocks.app/gift/1842

Again, the URL does not control ownership.

⸻

28. Reveal Experience

Do not create an enormous slot-machine animation.

Keep it quick and elegant.

After the transaction confirms:

🎉 You received

$0.034 of OpenAI

Show:

* company image
* name
* symbol
* allocation
* short company description

Actions:

Claim Stock

Learn More

The result should only appear after the on-chain state confirms the allocation.

⸻

29. Claim Experience

When claiming:

Claiming your PreStock...

Submit the transaction.

After confirmation:

Stock claimed

Then show:

OpenAI
$0.034

and provide a link/action to view it in the user’s wallet/explorer if appropriate.

⸻

30. No Backend

Do NOT introduce:

* Supabase
* Firebase
* Postgres
* MongoDB
* custom allocation API
* centralized gift database
* centralized randomness service
* backend wallet ownership database

The only external read-only source permitted for informational purposes is the PreStocks API.

Everything involving actual ownership/value entitlement must be blockchain-derived.

⸻

31. Why Solana

The implementation should take advantage of Solana’s strengths:

* low transaction costs
* fast confirmations
* token-native ecosystem
* easy wallet transfers
* on-chain ownership
* composability
* NFT/digital asset infrastructure

The product should feel like a normal consumer application, not a complicated crypto protocol.

⸻

32. End-to-End Acceptance Test

The finished application must support this exact flow:

Step 1

Connect Wallet A.

Step 2

Buy 10 SharedStocks packs.

Pay:

10 × $0.10 = $1 USDC

Step 3

Verify on-chain that Wallet A owns 10 unopened packs.

Step 4

Gift 2 packs to Wallet B.

Step 5

Verify on-chain:

Wallet A = 8 unopened packs
Wallet B = 2 unopened packs

Step 6

Connect Wallet B.

SharedStocks detects the 2 packs.

Step 7

Wallet B opens one.

Step 8

Verifiable randomness determines:

Reward tier
PreStock
Allocation

Step 9

Allocation is written on-chain.

Step 10

Frontend displays:

You received $0.034 of OpenAI.

Step 11

Wallet B claims.

Step 12

PreStock tokens arrive in Wallet B.

Step 13

Allocation becomes:

claimed = true

Step 14

The pack becomes consumed/unavailable.

Step 15

Wallet B’s portfolio reflects the PreStock holding.

Every important step must be independently verifiable on Solana.

⸻

33. Final Architecture

The final mental model should be:

                    SHAREDSTOCKS
                         │
                  $0.10 PACK
                         │
                         ▼
                    PACK NFT
                         │
              ┌──────────┴──────────┐
              │                     │
             KEEP                 GIFT
              │                     │
              │                     ▼
              │                 RECIPIENT
              │                     │
              └──────────┬──────────┘
                         │
                         ▼
                       OPEN
                         │
                         ▼
              VERIFIABLE RANDOMNESS
                         │
                         ▼
                  REWARD TIER
                         │
                         ▼
                  PRESTOCK SELECT
                         │
                         ▼
                  ALLOCATION
                         │
                         ▼
                      CLAIM
                         │
                         ▼
                 PRESTOCK TOKENS
                         │
                         ▼
                     PORTFOLIO

Core rule

The pack is the NFT.

The NFT represents the unopened giftable stock pack.

Opening consumes the pack and creates an on-chain PreStock allocation.

The allocation is determined by verifiable randomness.

The PreStock is claimed from an on-chain program-controlled vault.

The blockchain is the source of truth.

No centralized backend should be required for the core ownership, gifting, randomness, allocation, or claiming flow.
