use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("11111111111111111111111111111111");

const MAX_TIERS: usize = 5;
const MAX_ASSETS: usize = 32;
const BASIS_POINTS: u64 = 10_000;
const USDC_DECIMALS: u8 = 6;

#[program]
pub mod sharedstocks {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        usdc_mint: Pubkey,
        treasury: Pubkey,
        randomness_oracle: Pubkey,
        pack_price: u64,
        tiers: [RewardTier; MAX_TIERS],
    ) -> Result<()> {
        require!(
            tiers.iter().map(|tier| tier.weight as u64).sum::<u64>() == BASIS_POINTS,
            ErrorCode::InvalidTierWeights
        );

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.usdc_mint = usdc_mint;
        config.treasury = treasury;
        config.randomness_oracle = randomness_oracle;
        config.pack_price = pack_price;
        config.paused = false;
        config.next_pack_id = 1;
        config.current_randomness = [0; 32];
        config.reward_tiers = tiers;
        config.asset_mints = [Pubkey::default(); MAX_ASSETS];
        config.asset_enabled = [false; MAX_ASSETS];
        config.asset_inventory = [0; MAX_ASSETS];
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

    pub fn add_eligible_asset(
        ctx: Context<AdminOnly>,
        mint: Pubkey,
        inventory: u64,
    ) -> Result<()> {
        require!(inventory > 0, ErrorCode::InvalidInventory);
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
        config.asset_inventory[position] = inventory;
        Ok(())
    }

    pub fn enable_asset(ctx: Context<AdminOnly>, mint: Pubkey) -> Result<()> {
        let position = find_asset(ctx.accounts.config.asset_mints, mint)?;
        ctx.accounts.config.asset_enabled[position] = true;
        Ok(())
    }

    pub fn disable_asset(ctx: Context<AdminOnly>, mint: Pubkey) -> Result<()> {
        let position = find_asset(ctx.accounts.config.asset_mints, mint)?;
        ctx.accounts.config.asset_enabled[position] = false;
        Ok(())
    }

    pub fn set_asset_inventory(ctx: Context<AdminOnly>, mint: Pubkey, inventory: u64) -> Result<()> {
        let position = find_asset(ctx.accounts.config.asset_mints, mint)?;
        ctx.accounts.config.asset_inventory[position] = inventory;
        Ok(())
    }

    pub fn submit_randomness(
        ctx: Context<SubmitRandomness>,
        randomness: [u8; 32],
    ) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.config.randomness_oracle,
            ErrorCode::UnauthorizedRandomness
        );
        ctx.accounts.config.current_randomness = randomness;
        Ok(())
    }

    pub fn buy_packs(ctx: Context<BuyPacks>, quantity: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::ProgramPaused);
        require!(quantity > 0, ErrorCode::InvalidQuantity);

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

        let pack = &mut ctx.accounts.pack;
        pack.id = ctx.accounts.config.next_pack_id;
        pack.owner = ctx.accounts.buyer.key();
        pack.quantity = quantity;
        pack.status = PackStatus::Unopened;
        pack.selection_mint = None;
        pack.selection_amount = 0;
        pack.randomness = [0; 32];
        pack.claimed = false;
        pack.bump = 0;

        ctx.accounts.config.next_pack_id = ctx
            .accounts
            .config
            .next_pack_id
            .checked_add(1)
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
        require!(config.current_randomness != [0; 32], ErrorCode::RandomnessUnavailable);

        let selected = select_asset(config, config.current_randomness).ok_or(ErrorCode::NoAvailableAssets)?;
        let tier = select_reward_tier(config.reward_tiers, config.current_randomness)
            .ok_or(ErrorCode::NoRewardTierConfigured)?;

        pack.status = PackStatus::Opened;
        pack.randomness = config.current_randomness;
        pack.selection_mint = Some(selected.mint);
        pack.selection_amount = tier.amount_base;

        let allocation = &mut ctx.accounts.allocation;
        allocation.pack_id = pack.id;
        allocation.owner = pack.owner;
        allocation.asset_mint = selected.mint;
        allocation.amount = tier.amount_base;
        allocation.claimed = false;
        allocation.bump = 0;

        Ok(())
    }

    pub fn claim_allocation(ctx: Context<ClaimAllocation>, pack_id: u64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let allocation = &mut ctx.accounts.allocation;
        let pack = &mut ctx.accounts.pack;

        require!(pack.id == pack_id, ErrorCode::PackIdMismatch);
        require!(allocation.pack_id == pack_id, ErrorCode::PackIdMismatch);
        require!(allocation.owner == ctx.accounts.owner.key(), ErrorCode::NotPackOwner);
        require!(!allocation.claimed, ErrorCode::AllocationAlreadyClaimed);
        require!(pack.owner == ctx.accounts.owner.key(), ErrorCode::NotPackOwner);

        let asset_index = find_asset(config.asset_mints, allocation.asset_mint)?;
        require!(config.asset_enabled[asset_index], ErrorCode::AssetDisabled);
        require!(config.asset_inventory[asset_index] >= allocation.amount, ErrorCode::InsufficientAssetInventory);

        let bump = derive_vault_bump(ctx.program_id, allocation.asset_mint)?;
        let signer_seeds = [
            b"vault".as_ref(),
            allocation.asset_mint.as_ref(),
            std::slice::from_ref(&bump),
        ];

        let ix = spl_token::instruction::transfer_checked(
            &ctx.accounts.token_program.key(),
            &ctx.accounts.asset_vault_ata.key(),
            &ctx.accounts.asset_mint.key(),
            &ctx.accounts.user_ata.key(),
            &ctx.accounts.vault_authority.key(),
            &[],
            allocation.amount,
            ctx.accounts.asset_mint.decimals,
        )?;

        invoke_signed(
            &ix,
            &[
                ctx.accounts.asset_vault_ata.to_account_info(),
                ctx.accounts.asset_mint.to_account_info(),
                ctx.accounts.user_ata.to_account_info(),
                ctx.accounts.vault_authority.to_account_info(),
            ],
            &[&signer_seeds],
        )?;

        config.asset_inventory[asset_index] = config
            .asset_inventory[asset_index]
            .checked_sub(allocation.amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

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
    #[account(init, payer = buyer, space = 8 + Pack::SPACE)]
    pub pack: Account<'info, Pack>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub user_usdc_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub treasury_usdc_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GiftPack<'info> {
    #[account(mut)]
    pub pack: Account<'info, Pack>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct SubmitRandomness<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UnpackPack<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub pack: Account<'info, Pack>,
    #[account(init, payer = owner, space = 8 + Allocation::SPACE)]
    pub allocation: Account<'info, Allocation>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimAllocation<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub pack: Account<'info, Pack>,
    #[account(mut)]
    pub allocation: Account<'info, Allocation>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub asset_mint: Account<'info, Mint>,
    #[account(mut)]
    pub asset_vault_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_ata: Account<'info, TokenAccount>,
    /// CHECK: This is a PDA authority derived from the mint and owned by this program.
    #[account(mut)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub treasury: Pubkey,
    pub randomness_oracle: Pubkey,
    pub pack_price: u64,
    pub next_pack_id: u64,
    pub paused: bool,
    pub current_randomness: [u8; 32],
    pub reward_tiers: [RewardTier; MAX_TIERS],
    pub asset_mints: [Pubkey; MAX_ASSETS],
    pub asset_enabled: [bool; MAX_ASSETS],
    pub asset_inventory: [u64; MAX_ASSETS],
    pub asset_count: u8,
    pub bump: u8,
}

impl Config {
    pub const SPACE: usize = 32 + 32 + 32 + 32 + 8 + 8 + 1 + 32 + (RewardTier::SPACE * MAX_TIERS) + (32 * MAX_ASSETS) + (1 * MAX_ASSETS) + (8 * MAX_ASSETS) + 1 + 1;
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
    pub claimed: bool,
    pub bump: u8,
}

impl Pack {
    pub const SPACE: usize = 8 + 32 + 8 + 1 + (1 + 32) + 8 + 32 + 1 + 1;
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
    pub amount_base: u64,
}

impl RewardTier {
    pub const SPACE: usize = 2 + 8;
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
    #[msg("Not enough USDC balance to complete the purchase.")] InsufficientUsdc,
    #[msg("The configured reward asset inventory is full.")] AssetLimitReached,
    #[msg("The provided inventory value is invalid.")] InvalidInventory,
    #[msg("The allocation has already been claimed.")] AllocationAlreadyClaimed,
    #[msg("There is not enough funding to claim this allocation.")] InsufficientAssetInventory,
    #[msg("The requested quantity is invalid.")] InvalidQuantity,
    #[msg("Arithmetic overflow or underflow.")] ArithmeticOverflow,
    #[msg("Counter overflow reached.")] CounterOverflow,
    #[msg("Unauthorized randomness authority.")] UnauthorizedRandomness,
    #[msg("The signer is not the configured admin.")] UnauthorizedAuthority,
    #[msg("The provided asset mint is not eligible.")] AssetNotFound,
    #[msg("Asset inventory not available.")] AssetInventoryNotAvailable,
}

fn find_asset(asset_mints: [Pubkey; MAX_ASSETS], mint: Pubkey) -> Result<usize> {
    asset_mints
        .iter()
        .position(|candidate| *candidate == mint)
        .ok_or(ErrorCode::AssetNotFound.into())
}

fn derive_vault_bump(program_id: &Pubkey, mint: Pubkey) -> Result<u8> {
    let (vault, bump) = Pubkey::find_program_address(&[b"vault", mint.as_ref()], program_id);
    let _ = vault;
    Ok(bump)
}

fn select_reward_tier(tiers: [RewardTier; MAX_TIERS], randomness: [u8; 32]) -> Option<RewardTier> {
    let total_weight: u64 = tiers.iter().map(|tier| tier.weight as u64).sum();
    if total_weight == 0 {
        return None;
    }

    let roll = u64::from(randomness[0])
        .wrapping_add(u64::from(randomness[1]))
        .wrapping_add(u64::from(randomness[2]))
        % total_weight;

    let mut cursor = 0u64;
    for tier in tiers {
        cursor += tier.weight as u64;
        if roll < cursor {
            return Some(tier);
        }
    }

    tiers.last().copied()
}

fn select_asset(config: &Config, randomness: [u8; 32]) -> Option<AssetChoice> {
    let mut choices = Vec::new();
    for index in 0..config.asset_count as usize {
        if config.asset_enabled[index] && config.asset_inventory[index] > 0 {
            choices.push((config.asset_mints[index], config.asset_inventory[index]));
        }
    }

    if choices.is_empty() {
        return None;
    }

    let total_inventory: u64 = choices.iter().map(|(_, inventory)| *inventory).sum();
    let roll = u64::from(randomness[3])
        .wrapping_add(u64::from(randomness[4]))
        .wrapping_add(u64::from(randomness[5]))
        % total_inventory;

    let mut cursor = 0u64;
    for (mint, inventory) in &choices {
        cursor += *inventory;
        if roll < cursor {
            return Some(AssetChoice {
                mint: *mint,
                inventory: *inventory,
            });
        }
    }

    choices.last().map(|(mint, inventory)| AssetChoice {
        mint: *mint,
        inventory: *inventory,
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AssetChoice {
    pub mint: Pubkey,
    pub inventory: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reward_tier_selector_uses_configured_weights() {
        let tiers = [
            RewardTier { weight: 8000, amount_base: 4000000 },
            RewardTier { weight: 1500, amount_base: 10000000 },
            RewardTier { weight: 400, amount_base: 25000000 },
            RewardTier { weight: 90, amount_base: 100000000 },
            RewardTier { weight: 10, amount_base: 500000000 },
        ];

        let selected = select_reward_tier(tiers, [0; 32]).unwrap();
        assert_eq!(selected.amount_base, 4_000_000);
    }

    #[test]
    fn asset_selector_prefers_configured_available_mints() {
        let mut config = Config {
            authority: Pubkey::new_unique(),
            usdc_mint: Pubkey::new_unique(),
            treasury: Pubkey::new_unique(),
            randomness_oracle: Pubkey::new_unique(),
            pack_price: 100_000,
            next_pack_id: 1,
            paused: false,
            current_randomness: [1, 2, 3, 4, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            reward_tiers: [
                RewardTier { weight: 8000, amount_base: 4_000_000 },
                RewardTier { weight: 1500, amount_base: 10_000_000 },
                RewardTier { weight: 400, amount_base: 25_000_000 },
                RewardTier { weight: 90, amount_base: 100_000_000 },
                RewardTier { weight: 10, amount_base: 500_000_000 },
            ],
            asset_mints: [Pubkey::new_unique(); MAX_ASSETS],
            asset_enabled: [false; MAX_ASSETS],
            asset_inventory: [0; MAX_ASSETS],
            asset_count: 2,
            bump: 255,
        };

        config.asset_mints[0] = Pubkey::new_unique();
        config.asset_mints[1] = Pubkey::new_unique();
        config.asset_enabled[0] = true;
        config.asset_enabled[1] = true;
        config.asset_inventory[0] = 8;
        config.asset_inventory[1] = 2;

        let selected = select_asset(&config, [1, 2, 3, 4, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).unwrap();
        assert!(selected.inventory > 0);
        assert!(config.asset_enabled[0] || config.asset_enabled[1]);
    }
}
