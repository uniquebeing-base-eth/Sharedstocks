use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111");

const MAX_TIERS: usize = 5;
const BASIS_POINTS: u64 = 10_000;

#[program]
pub mod sharedstocks {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, tiers: [RewardTier; MAX_TIERS]) -> Result<()> {
        require!(tiers.iter().map(|tier| tier.weight as u64).sum::<u64>() == BASIS_POINTS, ErrorCode::InvalidTierWeights);
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.next_pack_id = 1;
        config.tiers = tiers;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn update_config(ctx: Context<UpdateConfig>, tiers: [RewardTier; MAX_TIERS]) -> Result<()> {
        require!(tiers.iter().map(|tier| tier.weight as u64).sum::<u64>() == BASIS_POINTS, ErrorCode::InvalidTierWeights);
        ctx.accounts.config.tiers = tiers;
        Ok(())
    }

    pub fn mint_pack(ctx: Context<MintPack>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let pack = &mut ctx.accounts.pack;
        pack.id = config.next_pack_id;
        pack.owner = ctx.accounts.owner.key();
        pack.status = PackStatus::Unopened;
        pack.bump = ctx.bumps.pack;
        config.next_pack_id = config.next_pack_id.checked_add(1).ok_or(ErrorCode::CounterOverflow)?;
        Ok(())
    }

    pub fn gift_pack(ctx: Context<GiftPack>, recipient: Pubkey) -> Result<()> {
        let pack = &mut ctx.accounts.pack;
        require!(pack.status == PackStatus::Unopened, ErrorCode::PackNotTransferable);
        require!(pack.owner == ctx.accounts.sender.key(), ErrorCode::NotPackOwner);
        pack.owner = recipient;
        Ok(())
    }

    pub fn request_open(ctx: Context<RequestOpen>, randomness_request: Pubkey) -> Result<()> {
        let pack = &mut ctx.accounts.pack;
        require!(pack.owner == ctx.accounts.owner.key(), ErrorCode::NotPackOwner);
        require!(pack.status == PackStatus::Unopened, ErrorCode::PackAlreadyOpened);
        pack.status = PackStatus::RandomnessPending;
        pack.randomness_request = Some(randomness_request);
        Ok(())
    }

    // Called by the configured randomness callback authority after verification.
    pub fn fulfill_randomness(ctx: Context<FulfillRandomness>, randomness: [u8; 32]) -> Result<()> {
        let pack = &mut ctx.accounts.pack;
        require!(pack.status == PackStatus::RandomnessPending, ErrorCode::RandomnessNotPending);
        let config = &ctx.accounts.config;
        let roll = u16::from_le_bytes([randomness[0], randomness[1]]) as u64 % BASIS_POINTS;
        let mut cursor = 0u64;
        let mut selected = 0u8;
        for (index, tier) in config.tiers.iter().enumerate() {
            cursor += tier.weight as u64;
            if roll < cursor { selected = index as u8; break; }
        }
        pack.status = PackStatus::Allocated;
        pack.reward_tier = Some(selected);
        pack.randomness = Some(randomness);
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let pack = &mut ctx.accounts.pack;
        require!(pack.owner == ctx.accounts.owner.key(), ErrorCode::NotPackOwner);
        require!(pack.status == PackStatus::Allocated, ErrorCode::RewardNotReady);
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
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct MintPack<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = owner, space = 8 + Pack::SPACE, seeds = [b"pack", config.next_pack_id.to_le_bytes().as_ref()], bump)]
    pub pack: Account<'info, Pack>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GiftPack<'info> {
    #[account(mut)]
    pub pack: Account<'info, Pack>,
    pub sender: Signer<'info>,
}

#[derive(Accounts)]
pub struct RequestOpen<'info> {
    #[account(mut)]
    pub pack: Account<'info, Pack>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct FulfillRandomness<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub pack: Account<'info, Pack>,
    pub callback_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub pack: Account<'info, Pack>,
    pub owner: Signer<'info>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub next_pack_id: u64,
    pub tiers: [RewardTier; MAX_TIERS],
    pub bump: u8,
}
impl Config { const SPACE: usize = 32 + 8 + (1 + 2 + 8) * MAX_TIERS + 1; }

#[account]
pub struct Pack {
    pub id: u64,
    pub owner: Pubkey,
    pub status: PackStatus,
    pub randomness_request: Option<Pubkey>,
    pub randomness: Option<[u8; 32]>,
    pub reward_tier: Option<u8>,
    pub bump: u8,
}
impl Pack { const SPACE: usize = 8 + 32 + 1 + 33 + 33 + 2 + 1; }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub struct RewardTier { pub weight: u16, pub minimum_cents: u64, pub maximum_cents: u64 }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PackStatus { Unopened, RandomnessPending, Allocated, Claimed }

#[error_code]
pub enum ErrorCode {
    #[msg("Reward tier weights must sum to 10,000 basis points.")] InvalidTierWeights,
    #[msg("Only unopened packs can be gifted.")] PackNotTransferable,
    #[msg("The signer does not own this pack.")] NotPackOwner,
    #[msg("This pack has already been opened.")] PackAlreadyOpened,
    #[msg("Randomness is not pending for this pack.")] RandomnessNotPending,
    #[msg("The reward is not ready to claim.")] RewardNotReady,
    #[msg("Pack id counter overflowed.")] CounterOverflow,
}
