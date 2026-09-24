# SharedStocks

Give a piece of the future.

SharedStocks is an open-source Solana application that makes tokenized pre-IPO assets more social, collectible, and giftable.

Users can purchase SharedStock Packs, keep them, gift unopened packs to another Solana wallet, or open them to receive an allocation of an eligible PreStocks asset.

Live: sharedstocks.signalify.xyz
PreStocks: prestocks.com
Built on: Solana


# Overview

Traditional stock interfaces are built around buying and selling.

SharedStocks explores a different interaction model:

Buy a Pack
     ↓
Keep or Gift
     ↓
Open
     ↓
Discover a PreStock
     ↓
Claim & Hold

A SharedStock Pack is an on-chain digital asset that can be transferred before it is opened.

This creates a simple way to give someone a piece of the future without deciding which company they receive beforehand.



# Why SharedStocks?

PreStocks brings tokenized pre-IPO exposure on-chain.

SharedStocks builds a social and collectible experience around it.

The goal is to make discovering and owning PreStocks feel less like using a traditional brokerage interface and more like participating in an open internet-native ownership experience.

PreStocks made private-market exposure tradable. SharedStocks makes it giftable.



# Features

* Purchase SharedStock Packs with USDC
* Own packs directly on Solana
* Gift unopened packs to any Solana wallet
* Open packs to discover eligible PreStocks assets
* Claim received assets directly to your wallet
* View your packs and PreStocks holdings
* Explore available PreStocks
* Connect compatible Solana wallets through wallet-standard discovery
* Fully on-chain ownership and pack state
* No centralized account required



# Architecture

SharedStocks is designed to keep the core application state on Solana.

                         SharedStocks
                              │
             ┌────────────────┴────────────────┐
             │                                 │
          Frontend                          Solana
             │                              Program
             │                                 │
      ┌──────┼──────┐                ┌─────────┼─────────┐
      │      │      │                │         │         │
    Wallet  Packs  Portfolio       Packs      Gifts    Rewards
      │      │      │                │         │         │
      └──────┴──────┘                └─────────┼─────────┘
                                               │
                                           PreStocks

The frontend reads and writes directly to Solana for application state.

PreStocks data may be used for asset discovery and display information, while blockchain state remains the source of truth for SharedStocks ownership.



# Tech Stack

* Solana
* Rust
* Anchor
* TypeScript
* React
* Vite
* Tailwind CSS
* Solana Wallet Standard
* USDC
* PreStocks



# Getting Started

Requirements

* Node.js
* npm, pnpm, or Bun
* Solana CLI
* Anchor CLI
* A compatible Solana wallet

# Clone

git clone https://github.com/uniquebeing-base-eth/sharedstocks.git
cd sharedstocks

Install dependencies

npm install

Or:

bun install

Environment

Create a .env file:

VITE_SOLANA_RPC_URL=YOUR_RPC_URL
VITE_SOLANA_NETWORK=devnet

Use the appropriate RPC and network configuration for the environment you are targeting.

Run the frontend

npm run dev

Or:

bun run dev

The application will be available locally at the Vite development URL.



# Building on SharedStocks

SharedStocks is intended to be more than a hackathon prototype.

The codebase is open for developers who want to build new experiences around the SharedStocks protocol.

Potential extensions include:

* New pack experiences
* Social gifting experiences
* Portfolio applications
* Discovery tools
* PreStocks-powered games
* Community applications
* Automated gifting
* New interfaces for interacting with SharedStock assets

The core idea is simple:

SharedStocks assets should be composable building blocks on Solana.



# Project Structure

sharedstocks/
├── app/              # Frontend application
├── programs/         # Solana programs
├── tests/            # Program tests
├── scripts/          # Development and deployment scripts
├── public/           # Static assets
└── README.md

The exact structure may evolve as development continues.



# On-Chain First

SharedStocks does not rely on a centralized database for core ownership.

The application treats Solana as the source of truth for:

* Pack ownership
* Pack state
* Transfers
* Allocations
* Claims

The frontend is an interface for interacting with the underlying on-chain system.



PreStocks

SharedStocks is built around assets available through the PreStocks ecosystem.

PreStocks provides tokenized exposure to private companies on Solana.

Learn more:

PreStocks
PreStocks Products
PreStocks Ecosystem



# Hackathon

SharedStocks was built for the Stocklana Hackathon, with a focus on the PreStocks bounty.

The project exclusively focuses on PreStocks assets and explores a new way to discover, share, and interact with tokenized pre-IPO assets on Solana.



# Status

SharedStocks is currently in active development.

Live application:

sharedstocks.signalify.xyz



License

This project is open source. See the repository license for details.
