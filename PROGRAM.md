# SharedStocks program

The `programs/sharedstocks` Anchor program is the on-chain ownership and lifecycle boundary for packs. It intentionally stores pack ownership, status, randomness request/result, and selected reward tier on-chain.

Before deployment, replace the placeholder program id and wire `fulfill_randomness` to the chosen Solana verifiable randomness provider. The frontend must never supply the random value, stock, tier, or allocation.

Build with:

```sh
source "$HOME/.cargo/env"
cargo check -p sharedstocks
```
