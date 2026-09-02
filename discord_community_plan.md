# Kosmo Discord Community Architecture Plan (v2)

This master plan details the roles, channels, and the **psychological engagement loops** (gamification, dopamine hooks, and retention strategies) that will make the Kosmo server highly active. All internal terminology (e.g., "Intent Compiler") has been removed for external use.

## 1. Gamification & Dopamine Loops (The "Casino" Strategy)
To keep users proactively engaged without ruining their reputation metrics, we use a strict **Three-Tier Economy**:

1.  **Kosmo Karma (Reputation & Status):** Like Reddit Karma, this is a pure measure of a user's value. It is earned by chatting, helping others, and getting "upvoted". **It can never be gambled or lost.** 
    *   *Utility:* High Karma automatically unlocks higher LLM API rate limits (e.g., hitting 5,000 Karma permanently upgrades you from 5 to 20 interactions/hour). It also dictates your daily allowance of the gambling currency.
2.  **Sparks (The Casino Chips):** This is the liquid gambling currency. 
    *   *How to get it:* Users run a `/daily` command. The higher their **Karma**, the more Sparks they get in their daily allowance.
    *   *Utility:* Sparks are taken to `#the-casino` for `/slots` and `/coinflip`. They can also be spent in the Reward Shop for cosmetic name colors. If you lose all your Sparks, your Karma remains untouched, preserving your credibility.
3.  **Compiles (The Ultimate Prize):** These are literal, actual "Compiles" that can be used inside the Kosmo web application. Handed out manually for extremely high-value actions (submitting accepted bug reports, providing core feedback, or winning referral tournaments).

## 2. Comprehensive Role Hierarchy (Highest to Lowest)
Strictly ordered to prevent permission conflicts. A bot cannot manage roles above itself.

### Staff & Utility
1. **Kosmo Founder:** Full Admin. Distinct color.
2. **Team Kosmo:** Full Admin. Core employees.
3. **Kosmo Bot (The Architect):** Needs `ADMINISTRATOR` to build the server and manage economies. Must be placed here to manage all roles below it.
4. **Moderator:** Can kick, ban, manage messages, and timeout users.

### Premium & VIP
5. **Kosmo VIP:** Invited partners, influencers, or investors.
6. **Kosmo Max:** Verified top-tier subscribers. Gets maximum perks and exclusive voice access.
7. **Kosmo Pro:** Verified paid subscribers.

### Engagement & Rewards (Dynamic Roles)
8. **Feedback Champion:** Assigned for high-value feedback. Unlocks real giveaways.
9. **Top Inviter:** Automated role for the #1 referrer of the month.
10. **High Roller / Level 50+:** Cosmetic roles awarded by the economy bot for extreme engagement.

### Domain Roles & Guilds (The Two-Tier System)
Instead of cluttering the server with 50 specific job roles, we use a two-tier system:
11. **The Broad "Guilds" (Self-Assigned during onboarding):** e.g., `Tech & Engineering`, `Business & Strategy`, `Academia & Education`, `Law & Compliance`, `Creative & Design`. These unlock access to specific category channels.
12. **Hyper-Specific Roles (Assigned by the AI Bot):** Users can tag the bot in chat (e.g., "@KosmoBot I am a React Native Developer"). The LLM parses this and automatically creates/assigns a cosmetic `React Native Developer` role to the user. This is used for profile flair and highly targeted pinging, without cluttering the main permission hierarchy.

### Base Level
12. **Kosmosian:** The default member role.

## 3. Channel Architecture & Permission Matrix

### 📌 INFORMATION (Read-Only)
- `#start-here`: Mission statement, rules.
- `#announcements`: Product updates.
- `#get-roles`: Reaction-role dashboard to pick domains.

### 🌐 THE KOSMOVERSE (General Access)
- `#general-chat`: Main discussion.
- `#introductions`: Where new users say hi.
- `#kosmo-recipes`: Sharing prompt structures, workflows, and best practices.
- `#showcase`: "Look what I built with Kosmo."

### 🕹️ THE ARCADE (Subtle Engagement & Dopamine)
- `#daily-rewards`: Where users run their `/daily` streak commands.
- `#the-casino`: Where the gambling bot lives (slots, coinflips, risking "Compiles").
- `#referral-leaderboard`: Automated updates on who invited the most people.
- `#count-to-infinity`: pure subtle engagement. Users just count up one by one. If someone messes up, it resets to zero.
- `#daily-poll`: A new question every day to spark debate.

### 🎯 GUILD DISCUSSIONS (Role-Gated)
*Channels unlock based on the broad "Guild" role chosen during onboarding.*
- `#tech-and-engineering`: Visible to Tech & Engineering guild.
- `#business-and-strategy`: Visible to Business & Strategy guild (Founders, PMs).
- `#academia-and-research`: Visible to Academia guild (Students, Teachers).
- `#legal-and-policy`: Visible to Law & Compliance guild.
- `#creatives-lounge`: Visible to Creative & Design guild.

### 💡 FEEDBACK & SUPPORT
- `#feature-requests`: Open forum.
- `#bug-reports`: Open forum.
- `#contact-support`: **Read-Only.** Users click a "Create Ticket" button here to spawn a private support thread.
- `#champions-lounge`: **Locked.** Only `Feedback Champion`, VIPs, and Staff. Used for exclusive merch giveaways.

### 🛠️ ACTIVE TICKETS (Hidden Category)
*Permissions: Entire category is completely hidden from the public. Only Staff and the specific user who opened the ticket can see channels in here.*
- `#ticket-[username]`: Dynamically created when a user clicks the "Create Ticket" button. The AI bot acts as the Level 1 support agent here, attempting to resolve the query before pinging human staff. Includes a "Close Ticket" button to archive the chat.

### 💎 KOSMO PRO & MAX (Premium Gated)
- `#pro-lounge`: **Locked.** Only `Kosmo Pro`, `Kosmo Max` and Staff.
- `#max-exclusive`: **Locked.** Only `Kosmo Max` and Staff. Highest tier networking.
- `#priority-support`: **Locked.** Direct line to Team Kosmo.

### 🎙️ VOICE & STAGES (Ongoing Engagement)
- `🎧 Lofi Study Lounge`: 24/7 quiet working channel with a music bot.
- `💬 Open Watercooler`: Casual drop-in chat.
- `🎙️ Weekly Founder AMA`: Stage channel for structured Q&A.
- `💎 Max Mastermind`: Voice channel locked to Kosmo Max.

### 🛑 INTERNAL (Staff Only)
- `#team-chat`: General team discussion.
- `#mod-logs`: Where the bot logs deleted messages, kicks, and bans.

## 4. Server Rules & Moderation Policies
To maintain a high-signal, low-noise community, strict rules govern where links and promotions can be shared.

### Link & Promotion Policy
- **Allowed (Encouraged):** Sharing links to your Kosmo creations, prompts, or workflows in `#showcase` and `#kosmo-recipes`.
- **Forbidden:** Dropping external links, self-promos, or unsolicited DMs in `#general-chat`, `#start-here`, or domain-specific chats.
- **Auto-Mod:** The bot will automatically delete any message containing `http://` or `https://` in restricted channels and issue a warning to the user.

### Information Channels
- **#announcements & #start-here:** These are strictly **read-only** for all users. Only `Kosmo Founder` and `Team Kosmo` can post here to ensure critical updates are never buried by chat.

### The Strike System
- 1st Offense (Link in general): Auto-delete message + bot warning in DMs.
- 2nd Offense: 10-minute timeout.
- 3rd Offense: Permanent ban. Moderators can override or manually apply strikes via a `/strike @user` command.

## 5. Fallbacks, Edge Cases & Security
1. **API Rate Limiting (Server Build):** The bot must use a queue system (e.g., 2-second delays) when creating these 30+ channels to avoid Discord API bans.
2. **Role Hierarchy Errors:** The bot must verify its own role is above `Moderator` before attempting to assign or create roles.
3. **Spam/Raid Protection:** Discord Verification Level set to "Medium" (registered > 5 mins). The economy bot must have spam-detection so users don't spam `#general-chat` just to earn currency.
4. **Idempotency (Safe Re-runs):** If the bot crashes during setup, running the setup command again will only create *missing* channels, preventing duplicates.

## 6. AI Bot Technical Guardrails & Privacy
To protect API tokens and ensure users can chat privately with the LLM without cluttering public channels, the Kosmo Bot will implement the following systems:

### Proactive Community Invocations (Icebreakers)
The bot shouldn't just wait to be tagged; it must proactively activate the community and demonstrate its capabilities (while staying within token limits).
- **The New User Icebreaker:** When a user posts their first message in `#introductions`, the KosmoBot will automatically reply: *"Welcome to Kosmo, [Name]! If you ever need help, just tag me. Or, if you're feeling brave, tag me and ask for a roast."*
- **The Lull Breaker:** If `#general-chat` has been completely dead for 4 hours during daytime hours, the bot can autonomously drop a thought-provoking (but Kosmo-related) question or a witty comment to spark conversation.

### Private 1-on-1 LLM Chat (Private Threads)
- Instead of having lengthy conversations in `#general-chat`, users can trigger the bot via a slash command (e.g., `/chat` or clicking a "Talk to Kosmo" button).
- The bot instantly spawns a **Private Thread**. 
- *Permissions:* This thread is entirely hidden. Only the specific user, the Bot, and Server Administrators can see it. 
- *Lifecycle:* The thread automatically archives and locks itself after 24 hours of inactivity, keeping the server clean.

### Token Protection & Tiered Rate Limiting
To ensure the community functions smoothly without burning LLM tokens, we split the bot's functions into two categories:
1. **Utility Functions (Unlimited):** Standard bot actions like role assignment, welcome messages, support ticket creation, and moderation have extremely high global limits. They do not use LLM tokens and are unrestricted for users.
2. **LLM Personality Interactions (Tiered Limits):** When a user explicitly tags `@KosmoBot` to ask a question, generate an intent, or get roasted, it burns API tokens. This is strictly rate-limited based on their Discord role and their earned Karma:
   - **Kosmosians (Free):** 5 LLM interactions per hour (Can be upgraded via Karma shop).
   - **High-Karma Users:** Up to 20 LLM interactions per hour (Earned by active community engagement).
   - **Kosmo Pro:** 50 LLM interactions per hour.
   - **Kosmo Max:** 200 LLM interactions per hour.
   - *If a user hits their limit, the bot replies with a hardcoded message suggesting they either upgrade to Pro or go earn some Karma in the chat to buy more limits.*
- **Trigger Lock:** The bot will **never** read or evaluate regular chat messages unless explicitly tagged (`@KosmoBot`) or invoked via a slash command.
- **Topical Guardrails:** The System Prompt will strictly enforce boundaries. The bot will be instructed: *"You are the Kosmo community assistant. You are not a free general-purpose AI. If a user asks you to write code, do their homework, or answer general trivia, you must sarcastically decline and remind them this is not a ChatGPT terminal."*
- **Abuse Auto-Timeout:** If a user hits the rate limit and maliciously spams the bot to trigger the hardcoded limit message, the bot will automatically apply a 10-minute Discord Timeout to the user.
