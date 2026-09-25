# SharedStocks program

The `programs/sharedstocks` Anchor program is the on-chain ownership and lifecycle boundary for packs. It intentionally stores pack ownership, status, randomness request/result, and selected reward tier on-chain.

Before deployment, use a program keypair whose public key matches `declare_id!` in `programs/sharedstocks/src/lib.rs`. The declared address is currently not deployed on Solana mainnet.

The current source also does not implement a randomness request or fulfillment instruction. Do not publish this program as a production-ready protocol until that flow is implemented and tested against the configured Switchboard On-Demand account. The frontend must never supply the random value, stock, tier, or allocation.

Build with:

```sh
source "$HOME/.cargo/env"
cargo check -p sharedstocks
```

## Mainnet deployment checklist

The repository is configured for Mainnet in `Anchor.toml`. From a machine with Rust, Solana CLI, and Anchor CLI installed:

```sh
source "$HOME/.cargo/env"
solana config set --url https://api.mainnet-beta.solana.com
solana address
solana balance
anchor build
anchor keys list
anchor deploy --provider.cluster Mainnet
anchor account program sharedstocks --provider.cluster Mainnet
```

Before running the deploy command, confirm that the deployer wallet is funded for program-data rent and that the key shown by `anchor keys list` matches the `declare_id!` value. After deployment, verify the program account is executable on mainnet and initialize the config PDA with mainnet USDC, treasury, reward mints, and transfer-fee vaults.
