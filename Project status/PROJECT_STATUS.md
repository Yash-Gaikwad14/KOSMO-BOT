# Project Status – Kosmo Discord Community

## Current Phase
- **Phase 1 – Server Foundation & Security** – *Planned / Ready to Execute*
  - Create blank Discord server named **"Kosmo Community"**
  - Enable Community features (Announcement channels, Welcome Screen)
  - Set Verification level to **Medium** (5 min Discord age)
  - Enable **Explicit Media Content Filter** for all members

## Recent Changes
- Removed the **Payments / Stripe** section from the technology stack because the project does not involve any payment processing at this time.

## Next Steps
- Execute Phase 1 actions on Discord.
- Begin Phase 2 (Bot scaffolding, role system, moderation, community features).
- Keep the status documents updated as work progress.

## Phase 2 – Third‑Party Bot Integration
### Carl‑bot (Infrastructure & Moderation)
- Set up `#get-roles` with reaction role builder (💻 → Tech & Engineering).
- Auto‑Mod: delete messages containing `http://` or `https://` in `#general-chat`; DM warning.
- Logging channel `#mod-logs` for deletions, joins/leaves.

### Economy & Leveling (Arcane & UnbelievaBoat)
- **Arcane**: XP → **Karma**; Level 10 auto‑assigns “High‑Karma User” role (boosts LLM limits).
- **UnbelievaBoat**: currency → **Sparks**.
- `/daily` allowances: 500 Sparks for `Kosmosian`; 2,000 Sparks for `High‑Karma User`.
- Casino games (`/slots`, `/roulette`) restricted to `#the-casino`.

### Ticket Tool (Support & Feedback)
- “Create Ticket” button in `#contact-support`; spawns private channels under hidden `🛠️ ACTIVE TICKETS`.

### InviteTracker (Referral Engine)
- Track invites; monthly leaderboard in `#referral-leaderboard`; top user receives **Compiles**.

## Phase 3 – Next Steps (placeholder)
- Define Phase 3 objectives and initial tasks.
