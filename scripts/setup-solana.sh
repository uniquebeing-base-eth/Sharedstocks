#!/usr/bin/env bash
set -euo pipefail

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi

source "$HOME/.cargo/env"

if ! command -v solana >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSfL https://release.anza.xyz/stable/install | sh
fi

export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

if ! command -v avm >/dev/null 2>&1; then
  cargo install --git https://github.com/coral-xyz/anchor avm --locked
fi

if ! avm list | grep -qx '0.30.1'; then
  avm install 0.30.1
fi

avm use 0.30.1
solana config set --url https://api.mainnet-beta.solana.com

printf '\nInstalled toolchain:\n'
rustc --version
solana --version
anchor --version