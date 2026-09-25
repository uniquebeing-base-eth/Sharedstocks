use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};
use anchor_lang::accounts::interface::Interface;
use anchor_lang::accounts::interface_account::InterfaceAccount;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use anchor_spl::token_2022_extensions::{self, TransferCheckedWithFee};
use anchor_spl::token_interface::{get_mint_extension_data, Mint as InterfaceMint, TokenAccount as InterfaceTokenAccount, TokenInterface};
use spl_token_2022::extension::{transfer_fee::TransferFeeConfig, StateWithExtensions};
use spl_token_2022::state::Account as Token2022Account;

declare_id!("4R3qUUWRrsoMs3zwLh6Nfc6iCQNERmpYspZVRwomB3Pk");

const MAX_TIERS: usize = 5;
const MAX_ASSETS: usize = 7;
const MAX_PACKS_PER_PURCHASE: u64 = 100;
const BASIS_POINTS: u64 = 10_000;
const USDC_DECIMALS: u8 = 6;
const MAINNET_USDC_MINT: Pubkey = pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const MAINNET_TREASURY: Pubkey = pubkey!("Cg5jju2XcxFvX8zU6JsFHFg2vMz23chXX1iz4dbB2v6r");
const SWITCHBOARD_ON_DEMAND_MAINNET: Pubkey = pubkey!("SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv");
const SWITCHBOARD_RANDOMNESS_DISCRIMINATOR: [u8; 8] = [10, 66, 229, 135, 220, 239, 217, 114];

#[program]
pub mod sharedstocks {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        usdc_mint: Pubkey,
        treasury: Pubkey,
        pack_price: u64,
        tiers: [RewardTier; MAX_TIERS],
    ) -> Result<()> {
        require_keys_eq!(usdc_mint, MAINNET_USDC_MINT, ErrorCode::InvalidUsdcMint);
        require_keys_eq!(treasury, MAINNET_TREASURY, ErrorCode::InvalidTreasury);
        require!(
            tiers.iter().map(|tier| tier.weight as u64).sum::<u64>() == BASIS_POINTS,
            ErrorCode::InvalidTierWeights
        );

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.usdc_mint = usdc_mint;
        config.treasury = treasury;
        config.pack_price = pack_price;
        config.paused = false;
        config.next_pack_id = 1;
        config.reward_tiers = tiers;
        config.asset_mints = [Pubkey::default(); MAX_ASSETS];
        config.asset_vaults = [Pubkey::default(); MAX_ASSETS];
        config.asset_enabled = [false; MAX_ASSETS];
        config.asset_reward_amounts = [[0; MAX_TIERS]; MAX_ASSETS];
        config.asset_count = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn update_pack_price(ctx: Context<AdminOnly>, pack_price: u64) -> Result<()> {
        ctx.accounts.config.pack_price = pack_price;
        Ok(())
    }

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.config.paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.config.paused = false;
        Ok(())
    }

    pub fn update_reward_tiers(ctx: Context<AdminOnly>, tiers: [RewardTier; MAX_TIERS]) -> Result<()> {
        require!(
            tiers.iter().map(|tier| tier.weight as u64).sum::<u64>() == BASIS_POINTS,
            ErrorCode::InvalidTierWeights
        );
        ctx.accounts.config.reward_tiers = tiers;
        Ok(())
    }

    pub fn add_eligible_asset(ctx: Context<AdminOnly>, mint: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;

        let position = match config.asset_mints.iter().position(|existing| *existing == mint) {
            Some(index) => index,
            None => {
                let next_index = config.asset_count as usize;
                require!(next_index < MAX_ASSETS, ErrorCode::AssetLimitReached);
                config.asset_count += 1;
                next_index
            }
        };

        config.asset_mints[position] = mint;
        config.asset_enabled[position] = true;
        Ok(())
    }

    pub fn enable_asset(ctx: Context<AdminOnly>, mint: Pubkey) -> Result<()> {
        let position = find_asset(&ctx.accounts.config.asset_mints, mint)?;
        ctx.accounts.config.asset_enabled[position] = true;
        Ok(())
    }

    pub fn disable_asset(ctx: Context<AdminOnly>, mint: Pubkey) -> Result<()> {
        let position = find_asset(&ctx.accounts.config.asset_mints, mint)?;
        ctx.accounts.config.asset_enabled[position] = false;
        Ok(())
    }

    pub fn set_asset_reward_amounts(
        ctx: Context<AdminOnly>,
        mint: Pubkey,
        amounts: [u64; MAX_TIERS],
    ) -> Result<()> {
        require!(amounts.iter().all(|amount| *amount > 0), ErrorCode::InvalidRewardAmounts);
        let position = find_asset(&ctx.accounts.config.asset_mints, mint)?;
        ctx.accounts.config.asset_reward_amounts[position] = amounts;
        Ok(())
    }

    pub fn set_asset_vault(ctx: Context<AdminOnly>, mint: Pubkey, vault: Pubkey) -> Result<()> {
        let position = find_asset(&ctx.accounts.config.asset_mints, mint)?;
        require_keys_neq!(vault, Pubkey::default(), ErrorCode::InvalidAssetVault);
        ctx.accounts.config.asset_vaults[position] = vault;
        Ok(())
    }

    pub fn buy_packs<'info>(ctx: Context<'_, '_, '_, 'info, BuyPacks<'info>>, quantity: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramPaused);
        require!(quantity > 0 && quantity <= MAX_PACKS_PER_PURCHASE, ErrorCode::InvalidQuantity);
        require!(ctx.remaining_accounts.len() == quantity as usize, ErrorCode::InvalidPackAccounts);
        require_keys_eq!(
            *ctx.accounts.randomness_account.owner,
            SWITCHBOARD_ON_DEMAND_MAINNET,
            ErrorCode::InvalidRandomnessAccount
        );
        let randomness_data = parse_switchboard_randomness(&ctx.accounts.randomness_account.data.borrow())?;
        require!(randomness_data.reveal_slot == 0, ErrorCode::RandomnessAlreadyRevealed);

        let total_cost = quantity
            .checked_mul(ctx.accounts.config.pack_price)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        require!(
            ctx.accounts.user_usdc_ata.mint == ctx.accounts.config.usdc_mint,
            ErrorCode::InvalidUsdcMint
        );
        require!(
            ctx.accounts.treasury_usdc_ata.mint == ctx.accounts.config.usdc_mint,
            ErrorCode::InvalidUsdcMint
        );
        require!(
            ctx.accounts.user_usdc_ata.amount >= total_cost,
            ErrorCode::InsufficientUsdc
        );

        let transfer = TransferChecked {
            from: ctx.accounts.user_usdc_ata.to_account_info(),
            mint: ctx.accounts.usdc_mint.to_account_info(),
            to: ctx.accounts.treasury_usdc_ata.to_account_info(),
            authority: ctx.accounts.buyer.to_account_info(),
        };

        let cpi = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            transfer,
        );
        token::transfer_checked(cpi, total_cost, USDC_DECIMALS)?;

        let rent = Rent::get()?;
        let pack_space = 8 + Pack::SPACE;
        let pack_lamports = rent.minimum_balance(pack_space);
        for (offset, pack_account) in ctx.remaining_accounts.iter().enumerate() {
            let pack_id = ctx.accounts.config.next_pack_id
                .checked_add(offset as u64)
                .ok_or(ErrorCode::CounterOverflow)?;
            let pack_id_bytes = pack_id.to_le_bytes();
            let (pack_key, pack_bump) = Pubkey::find_program_address(
                &[b"pack", pack_id_bytes.as_ref()],
                &crate::ID,
            );
            require_keys_eq!(pack_account.key(), pack_key, ErrorCode::InvalidPackAccounts);
            require_keys_eq!(*pack_account.owner, anchor_lang::system_program::ID, ErrorCode::InvalidPackAccounts);
            require!(pack_account.data_is_empty(), ErrorCode::InvalidPackAccounts);

            let create_account = system_instruction::create_account(
                &ctx.accounts.buyer.key(),
                &pack_key,
                pack_lamports,
                pack_space as u64,
                &crate::ID,
            );
            invoke_signed(
                &create_account,
                &[
                    ctx.accounts.buyer.to_account_info(),
                    pack_account.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[&[b"pack", pack_id_bytes.as_ref(), &[pack_bump]]],
            )?;

            let pack = Pack {
                id: pack_id,
                owner: ctx.accounts.buyer.key(),
                quantity: 1,
                status: PackStatus::Unopened,
                selection_mint: None,
                selection_amount: 0,
                randomness: [0; 32],
                randomness_account: ctx.accounts.randomness_account.key(),
                claimed: false,
                bump: pack_bump,
            };
            let mut data = pack_account.try_borrow_mut_data()?;
            let mut serialized = &mut data[..];
            pack.try_serialize(&mut serialized)?;
        }

        ctx.accounts.config.next_pack_id = ctx.accounts.config.next_pack_id
            .checked_add(quantity)
            .ok_or(ErrorCode::CounterOverflow)?;

        Ok(())
    }

    pub fn gift_pack(ctx: Context<GiftPack>, pack_id: u64, recipient: Pubkey) -> Result<()> {
        let pack = &mut ctx.accounts.pack;
        require!(pack.id == pack_id, ErrorCode::PackIdMismatch);
        require!(pack.owner == ctx.accounts.owner.key(), ErrorCode::NotPackOwner);
        require!(pack.status == PackStatus::Unopened, ErrorCode::PackNotTransferable);

        pack.owner = recipient;
        Ok(())
    }

    pub fn unpack_pack(ctx: Context<UnpackPack>, pack_id: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        let pack = &mut ctx.accounts.pack;

        require!(pack.id == pack_id, ErrorCode::PackIdMismatch);
        require!(pack.owner == ctx.accounts.owner.key(), ErrorCode::NotPackOwner);
        require!(pack.status == PackStatus::Unopened, ErrorCode::PackAlreadyOpened);
        require_keys_eq!(
            pack.randomness_account,
            ctx.accounts.randomness_account.key(),
            ErrorCode::RandomnessAccountMismatch
        );
        require_keys_eq!(
            *ctx.accounts.randomness_account.owner,
            SWITCHBOARD_ON_DEMAND_MAINNET,
            ErrorCode::InvalidRandomnessAccount
        );
        let randomness_data = parse_switchboard_randomness(&ctx.accounts.randomness_account.data.borrow())?;
        require!(randomness_data.reveal_slot == Clock::get()?.slot, ErrorCode::RandomnessUnavailable);
        let randomness = randomness_data.value;

        let tier_index = select_reward_tier(config.reward_tiers, randomness)
            .ok_or(ErrorCode::NoRewardTierConfigured)?;
        let selected = select_funded_asset(config, randomness, tier_index, &ctx.remaining_accounts)?;
        let asset_index = find_asset(&config.asset_mints, selected.mint)?;
        let allocation_amount = config.asset_reward_amounts[asset_index][tier_index];
        require!(allocation_amount > 0, ErrorCode::NoRewardAmountConfigured);
        require!(ctx.accounts.asset_mint.key() == selected.mint, ErrorCode::AssetNotFound);
        require_keys_eq!(
            ctx.accounts.asset_vault_ata.key(),
            config.asset_vaults[asset_index],
            ErrorCode::InvalidAssetVault
        );
        let gross_amount = reward_gross_amount(
            &ctx.accounts.asset_mint.to_account_info(),
            allocation_amount,
        )?;
        require!(ctx.accounts.asset_vault_ata.amount >= gross_amount, ErrorCode::InsufficientAssetInventory);

        pack.status = PackStatus::Opened;
        pack.randomness = randomness;
        pack.selection_mint = Some(selected.mint);
        pack.selection_amount = allocation_amount;

        let allocation = &mut ctx.accounts.allocation;
        allocation.pack_id = pack.id;
        allocation.owner = pack.owner;
        allocation.asset_mint = selected.mint;
        allocation.amount = allocation_amount;
        allocation.claimed = false;
        allocation.bump = ctx.bumps.allocation;

        Ok(())
    }

    pub fn claim_allocation(ctx: Context<ClaimAllocation>, pack_id: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        let allocation = &mut ctx.accounts.allocation;
        let pack = &mut ctx.accounts.pack;

        require!(pack.id == pack_id, ErrorCode::PackIdMismatch);
        require!(allocation.pack_id == pack_id, ErrorCode::PackIdMismatch);
        require!(allocation.owner == ctx.accounts.owner.key(), ErrorCode::NotPackOwner);
        require!(!allocation.claimed, ErrorCode::AllocationAlreadyClaimed);
        require!(pack.owner == ctx.accounts.owner.key(), ErrorCode::NotPackOwner);

        let asset_index = find_asset(&config.asset_mints, allocation.asset_mint)?;
        require!(config.asset_enabled[asset_index], ErrorCode::AssetDisabled);
        require_keys_eq!(
            ctx.accounts.asset_vault_ata.key(),
            config.asset_vaults[asset_index],
            ErrorCode::InvalidAssetVault
        );
        let transfer_fee_config = get_mint_extension_data::<TransferFeeConfig>(
            &ctx.accounts.asset_mint.to_account_info(),
        )
        .map_err(|_| error!(ErrorCode::InvalidTransferFeeConfig))?;
        let transfer_fee = transfer_fee_config.get_epoch_fee(Clock::get()?.epoch);
        let gross_amount = transfer_fee
            .calculate_pre_fee_amount(allocation.amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        let transfer_fee_amount = transfer_fee
            .calculate_fee(gross_amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;
        require!(
            gross_amount
                .checked_sub(transfer_fee_amount)
                .ok_or(ErrorCode::ArithmeticOverflow)?
                == allocation.amount,
            ErrorCode::InvalidTransferFeeConfig
        );
        require!(ctx.accounts.asset_vault_ata.amount >= gross_amount, ErrorCode::InsufficientAssetInventory);

        let signer_seeds: &[&[u8]] = &[
            b"vault",
            allocation.asset_mint.as_ref(),
            &[ctx.bumps.vault_authority],
        ];
        let transfer = TransferCheckedWithFee {
            token_program_id: ctx.accounts.token_program.to_account_info(),
            source: ctx.accounts.asset_vault_ata.to_account_info(),
            mint: ctx.accounts.asset_mint.to_account_info(),
            destination: ctx.accounts.user_ata.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        token_2022_extensions::transfer_checked_with_fee(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer,
                &[signer_seeds],
            ),
            gross_amount,
            ctx.accounts.asset_mint.decimals,
            transfer_fee_amount,
        )?;

        allocation.claimed = true;
        pack.claimed = true;
        pack.status = PackStatus::Claimed;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = authority, space = 8 + Config::SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(constraint = config.authority == authority.key() @ ErrorCode::UnauthorizedAuthority)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct BuyPacks<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = buyer, space = 8 + Pack::SPACE, seeds = [b"pack", config.next_pack_id.to_le_bytes().as_ref()], bump)]
    pub pack: Account<'info, Pack>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub user_usdc_ata: Account<'info, TokenAccount>,
    #[account(mut, constraint = treasury_usdc_ata.owner == config.treasury @ ErrorCode::InvalidTreasury)]
    pub treasury_usdc_ata: Account<'info, TokenAccount>,
    #[account(mut, constraint = usdc_mint.key() == config.usdc_mint @ ErrorCode::InvalidUsdcMint)]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    /// CHECK: Validated against the deployed Switchboard On-Demand mainnet program in the instruction.
    pub randomness_account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GiftPack<'info> {
    #[account(mut, seeds = [b"pack", pack.id.to_le_bytes().as_ref()], bump = pack.bump)]
    pub pack: Account<'info, Pack>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct UnpackPack<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"pack", pack.id.to_le_bytes().as_ref()], bump = pack.bump)]
    pub pack: Account<'info, Pack>,
    #[account(init, payer = owner, space = 8 + Allocation::SPACE, seeds = [b"allocation", pack.key().as_ref()], bump)]
    pub allocation: Account<'info, Allocation>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(constraint = allocation.asset_mint == Pubkey::default() @ ErrorCode::AssetNotFound)]
    pub asset_mint: InterfaceAccount<'info, InterfaceMint>,
    #[account(
        constraint = asset_vault_ata.mint == asset_mint.key() @ ErrorCode::InvalidAssetVault,
        constraint = asset_vault_ata.owner == vault_authority.key() @ ErrorCode::InvalidAssetVault,
    )]
    pub asset_vault_ata: InterfaceAccount<'info, InterfaceTokenAccount>,
    #[account(seeds = [b"vault", asset_mint.key().as_ref()], bump)]
    /// CHECK: PDA authority for the Token-2022 reward vault.
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: The account is validated against the deployed Switchboard On-Demand mainnet program.
    pub randomness_account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimAllocation<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"pack", pack.id.to_le_bytes().as_ref()], bump = pack.bump)]
    pub pack: Account<'info, Pack>,
    #[account(mut, seeds = [b"allocation", pack.key().as_ref()], bump = allocation.bump)]
    pub allocation: Account<'info, Allocation>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(constraint = asset_mint.key() == allocation.asset_mint @ ErrorCode::AssetNotFound)]
    pub asset_mint: InterfaceAccount<'info, InterfaceMint>,
    #[account(
        mut,
        constraint = asset_vault_ata.mint == asset_mint.key() @ ErrorCode::InvalidAssetVault,
        constraint = asset_vault_ata.owner == vault_authority.key() @ ErrorCode::InvalidAssetVault,
    )]
    pub asset_vault_ata: InterfaceAccount<'info, InterfaceTokenAccount>,
    #[account(mut, constraint = user_ata.mint == asset_mint.key() @ ErrorCode::InvalidUserTokenAccount)]
    pub user_ata: InterfaceAccount<'info, InterfaceTokenAccount>,
    #[account(seeds = [b"vault", asset_mint.key().as_ref()], bump)]
    /// CHECK: This is a PDA authority derived from the mint and owned by this program.
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub treasury: Pubkey,
    pub pack_price: u64,
    pub next_pack_id: u64,
    pub paused: bool,
    pub reward_tiers: [RewardTier; MAX_TIERS],
    pub asset_mints: [Pubkey; MAX_ASSETS],
    pub asset_vaults: [Pubkey; MAX_ASSETS],
    pub asset_enabled: [bool; MAX_ASSETS],
    pub asset_reward_amounts: [[u64; MAX_TIERS]; MAX_ASSETS],
    pub asset_count: u8,
    pub bump: u8,
}

impl Config {
    pub const SPACE: usize = 32 + 32 + 32 + 8 + 8 + 1 + (RewardTier::SPACE * MAX_TIERS) + (32 * MAX_ASSETS) + (32 * MAX_ASSETS) + (1 * MAX_ASSETS) + (8 * MAX_TIERS * MAX_ASSETS) + 1 + 1;
}

#[account]
pub struct Pack {
    pub id: u64,
    pub owner: Pubkey,
    pub quantity: u64,
    pub status: PackStatus,
    pub selection_mint: Option<Pubkey>,
    pub selection_amount: u64,
    pub randomness: [u8; 32],
    pub randomness_account: Pubkey,
    pub claimed: bool,
    pub bump: u8,
}

impl Pack {
    pub const SPACE: usize = 8 + 32 + 8 + 1 + (1 + 32) + 8 + 32 + 32 + 1 + 1;
}

#[account]
pub struct Allocation {
    pub pack_id: u64,
    pub owner: Pubkey,
    pub asset_mint: Pubkey,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl Allocation {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Default)]
pub struct RewardTier {
    pub weight: u16,
}

impl RewardTier {
    pub const SPACE: usize = 2;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PackStatus {
    Unopened = 0,
    Opened = 1,
    Claimed = 2,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Reward tier weights must sum to 10,000 basis points.")] InvalidTierWeights,
    #[msg("Only unopened packs can be gifted.")] PackNotTransferable,
    #[msg("The signer does not own this pack.")] NotPackOwner,
    #[msg("This pack has already been opened.")] PackAlreadyOpened,
    #[msg("This pack id does not match the provided account.")] PackIdMismatch,
    #[msg("Randomness is not available to resolve the pack.")] RandomnessUnavailable,
    #[msg("No eligible and funded PreStocks asset is available.")] NoAvailableAssets,
    #[msg("No reward tier is configured.")] NoRewardTierConfigured,
    #[msg("The asset is not currently enabled.")] AssetDisabled,
    #[msg("The program is paused.")] ProgramPaused,
    #[msg("Incorrect USDC mint.")] InvalidUsdcMint,
    #[msg("The configured treasury is invalid.")] InvalidTreasury,
    #[msg("Not enough USDC balance to complete the purchase.")] InsufficientUsdc,
    #[msg("The configured reward asset inventory is full.")] AssetLimitReached,
    #[msg("Every reward tier must have a positive token amount.")] InvalidRewardAmounts,
    #[msg("No reward amount is configured for this asset and tier.")] NoRewardAmountConfigured,
    #[msg("The allocation has already been claimed.")] AllocationAlreadyClaimed,
    #[msg("There is not enough funding to claim this allocation.")] InsufficientAssetInventory,
    #[msg("The requested quantity is invalid.")] InvalidQuantity,
    #[msg("The supplied pack PDA accounts are invalid or do not match the requested quantity.")] InvalidPackAccounts,
    #[msg("Arithmetic overflow or underflow.")] ArithmeticOverflow,
    #[msg("Counter overflow reached.")] CounterOverflow,
    #[msg("The signer is not the configured admin.")] UnauthorizedAuthority,
    #[msg("The provided asset mint is not eligible.")] AssetNotFound,
    #[msg("Asset inventory not available.")] AssetInventoryNotAvailable,
    #[msg("The reward vault is not controlled by the program or does not match the mint.")] InvalidAssetVault,
    #[msg("The recipient token account does not match the reward mint.")] InvalidUserTokenAccount,
    #[msg("The reward mint does not expose a valid Token-2022 transfer-fee configuration.")] InvalidTransferFeeConfig,
    #[msg("The randomness account is not a valid Switchboard On-Demand mainnet account.")] InvalidRandomnessAccount,
    #[msg("The selected Switchboard randomness account has already been revealed.")] RandomnessAlreadyRevealed,
    #[msg("The randomness account does not match the one committed at purchase.")] RandomnessAccountMismatch,
}

fn find_asset(asset_mints: &[Pubkey; MAX_ASSETS], mint: Pubkey) -> Result<usize> {
    asset_mints
        .iter()
        .position(|candidate| *candidate == mint)
        .ok_or(ErrorCode::AssetNotFound.into())
}

struct SwitchboardRandomness {
    reveal_slot: u64,
    value: [u8; 32],
}

fn parse_switchboard_randomness(data: &[u8]) -> Result<SwitchboardRandomness> {
    const REVEAL_SLOT_OFFSET: usize = 144;
    const VALUE_OFFSET: usize = 152;
    const ACCOUNT_SIZE: usize = 408;

    require!(data.len() >= ACCOUNT_SIZE, ErrorCode::InvalidRandomnessAccount);
    require!(
        data[..SWITCHBOARD_RANDOMNESS_DISCRIMINATOR.len()] == SWITCHBOARD_RANDOMNESS_DISCRIMINATOR,
        ErrorCode::InvalidRandomnessAccount
    );

    let reveal_slot = u64::from_le_bytes(
        data[REVEAL_SLOT_OFFSET..REVEAL_SLOT_OFFSET + 8]
            .try_into()
            .map_err(|_| error!(ErrorCode::InvalidRandomnessAccount))?,
    );
    let mut value = [0u8; 32];
    value.copy_from_slice(&data[VALUE_OFFSET..VALUE_OFFSET + 32]);
    Ok(SwitchboardRandomness { reveal_slot, value })
}

fn select_reward_tier(tiers: [RewardTier; MAX_TIERS], randomness: [u8; 32]) -> Option<usize> {
    let total_weight: u64 = tiers.iter().map(|tier| tier.weight as u64).sum();
    if total_weight == 0 {
        return None;
    }

    let roll = u64::from(randomness[0])
        .wrapping_add(u64::from(randomness[1]))
        .wrapping_add(u64::from(randomness[2]))
        % total_weight;

    let mut cursor = 0u64;
    for (index, tier) in tiers.iter().enumerate() {
        cursor += tier.weight as u64;
        if roll < cursor {
            return Some(index);
        }
    }

    Some(MAX_TIERS - 1)
}

fn select_asset(config: &Config, randomness: [u8; 32]) -> Option<AssetChoice> {
    let enabled: Vec<Pubkey> = config.asset_mints[..config.asset_count as usize]
        .iter()
        .zip(config.asset_enabled[..config.asset_count as usize].iter())
        .filter_map(|(mint, enabled)| enabled.then_some(*mint))
        .collect();
    if enabled.is_empty() {
        return None;
    }
    let roll = u64::from(randomness[3])
        .wrapping_add(u64::from(randomness[4]))
        .wrapping_add(u64::from(randomness[5]))
        % enabled.len() as u64;
    Some(AssetChoice { mint: enabled[roll as usize] })
}

fn select_funded_asset(
    config: &Config,
    randomness: [u8; 32],
    tier_index: usize,
    remaining_accounts: &[AccountInfo],
) -> Result<AssetChoice> {
    let asset_count = config.asset_count as usize;
    require!(
        remaining_accounts.len() >= asset_count.saturating_mul(2),
        ErrorCode::InvalidAssetVault
    );

    let start = if asset_count == 0 {
        0
    } else {
        (u64::from(randomness[3])
            .wrapping_add(u64::from(randomness[4]))
            .wrapping_add(u64::from(randomness[5]))
            % asset_count as u64) as usize
    };

    for offset in 0..asset_count {
        let index = (start + offset) % asset_count;
        if !config.asset_enabled[index] || config.asset_vaults[index] == Pubkey::default() {
            continue;
        }

        let mint_info = &remaining_accounts[index * 2];
        let vault_info = &remaining_accounts[index * 2 + 1];
        if mint_info.key() != config.asset_mints[index]
            || vault_info.key() != config.asset_vaults[index]
        {
            continue;
        }

        let vault_data = vault_info
            .try_borrow_data()
            .map_err(|_| error!(ErrorCode::InvalidAssetVault))?;
        let vault = StateWithExtensions::<Token2022Account>::unpack(&vault_data)
            .map_err(|_| error!(ErrorCode::InvalidAssetVault))?;
        let (vault_authority, _) = Pubkey::find_program_address(
            &[b"vault", mint_info.key().as_ref()],
            &crate::ID,
        );
        if vault.base.mint != mint_info.key() || vault.base.owner != vault_authority {
            continue;
        }

        let gross_amount = reward_gross_amount(mint_info, config.asset_reward_amounts[index][tier_index])?;
        if vault.base.amount >= gross_amount {
            return Ok(AssetChoice { mint: mint_info.key() });
        }
    }

    Err(ErrorCode::NoAvailableAssets.into())
}

fn reward_gross_amount(mint: &AccountInfo<'_>, net_amount: u64) -> Result<u64> {
    let transfer_fee_config = get_mint_extension_data::<TransferFeeConfig>(mint)
        .map_err(|_| error!(ErrorCode::InvalidTransferFeeConfig))?;
    let transfer_fee = transfer_fee_config.get_epoch_fee(Clock::get()?.epoch);
    let gross_amount = transfer_fee
        .calculate_pre_fee_amount(net_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    let fee_amount = transfer_fee
        .calculate_fee(gross_amount)
        .ok_or(ErrorCode::ArithmeticOverflow)?;
    require!(
        gross_amount
            .checked_sub(fee_amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?
            == net_amount,
        ErrorCode::InvalidTransferFeeConfig
    );
    Ok(gross_amount)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AssetChoice {
    pub mint: Pubkey,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reward_tier_selector_uses_configured_weights() {
        let tiers = [
            RewardTier { weight: 8000 },
            RewardTier { weight: 1500 },
            RewardTier { weight: 400 },
            RewardTier { weight: 90 },
            RewardTier { weight: 10 },
        ];

        let selected = select_reward_tier(tiers, [0; 32]).unwrap();
        assert_eq!(selected, 0);
    }

    #[test]
    fn asset_selector_prefers_configured_available_mints() {
        let mut config = Config {
            authority: Pubkey::new_unique(),
            usdc_mint: Pubkey::new_unique(),
            treasury: Pubkey::new_unique(),
            pack_price: 100_000,
            next_pack_id: 1,
            paused: false,
            reward_tiers: [
                RewardTier { weight: 8000 },
                RewardTier { weight: 1500 },
                RewardTier { weight: 400 },
                RewardTier { weight: 90 },
                RewardTier { weight: 10 },
            ],
            asset_mints: [Pubkey::new_unique(); MAX_ASSETS],
            asset_vaults: [Pubkey::default(); MAX_ASSETS],
            asset_enabled: [false; MAX_ASSETS],
            asset_reward_amounts: [[0; MAX_TIERS]; MAX_ASSETS],
            asset_count: 2,
            bump: 255,
        };

        config.asset_mints[0] = Pubkey::new_unique();
        config.asset_mints[1] = Pubkey::new_unique();
        config.asset_enabled[0] = true;
        config.asset_enabled[1] = true;
        let selected = select_asset(&config, [1, 2, 3, 4, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).unwrap();
        assert!(selected.mint == config.asset_mints[0] || selected.mint == config.asset_mints[1]);
    }
}
