# TAKE

**You have one TAKE. Who deserves it?**

TAKE is a social allocation product for scarce opportunities.

A project might have:

- 5 creator program spots
- 10 whitelist spots
- 3 grants
- limited beta access
- event tickets
- game items
- scholarships
- community rewards

Usually, the organization decides both the rules and who gets selected.

With TAKE, the organization still decides the rules — but the community helps decide the people.

> **The organization decides the rules.  
> The community decides the people.**

---

## The idea

Imagine a community has 5 spots in a new creator program.

The project defines who is eligible to participate.

Every eligible participant gets exactly **one TAKE**.

They cannot use it on themselves.

They have to give it to someone else they believe deserves the opportunity.

For example:

**Kubo → Sarah**

means Kubo used their TAKE to nominate Sarah.

That nomination is recorded on Monad.

Simple.

No points to farm.  
No paying for more votes.  
No self-claiming.  
No follower count multiplying your influence.

One eligible person gets one TAKE.

---

## Why build this?

A lot of valuable opportunities online are distributed in ways that aren't very social.

Applications are judged privately.

Whitelists become engagement farms.

First-come-first-served rewards whoever is fastest.

Popularity contests reward whoever already has the most attention.

We wanted to try something different:

> What if getting an opportunity could start with another person choosing you?

There is a very different feeling between:

**"I claimed a spot."**

and:

**"Someone thought I deserved the spot."**

That's the interaction TAKE is built around.

---

## How a TAKE campaign works

### 1. An organization creates an opportunity

The organizer defines:

- what people are receiving
- how many spots exist
- who can participate
- who can receive a TAKE
- when the campaign starts and ends

Before the campaign launches, these rules and participant sets are locked.

---

### 2. TAKE determines eligibility

Not every campaign needs the same eligibility rules.

A builder program might care about different evidence from a creator program or community reward.

TAKE currently supports an evidence-based eligibility system using things like:

- persistent TAKE identity
- connected social accounts
- wallet history, where TAKE can read it (the automated onchain history check currently reports evidence unavailable)
- community membership
- Discord join date and roles when configured
- campaign allowlists
- manually reviewed evidence
- predefined newcomer paths (supported in the engine; not yet enabled in the create flow)

The important part is that eligibility does **not** change voting power.

Once two people are eligible, they both get exactly one TAKE.

---

### 3. Everyone gets one TAKE

An eligible participant sees:

> **YOU HAVE ONE TAKE.  
> WHO DESERVES IT?**

They select someone from the campaign's recipient roster.

Self-nomination is not allowed.

The participant's wallet signs the real nomination transaction on Monad.

---

### 4. TAKE verifies the nomination

A TAKE is not considered successful just because the wallet popup disappeared.

TAKE waits for:

1. the transaction to confirm on Monad
2. the expected `TakeGiven` event
3. TAKE to process the event (the indexer, or receipt reconciliation when the indexer is slow)
4. the nomination to become a valid canonical edge

Only then does the UI show:

**TAKE GIVEN**

---

### 5. The campaign is allocated and finalized

After the campaign closes, TAKE runs the locked allocation rules.

The resulting allocation is stored and its result hash can be finalized through the campaign contract.

The goal is for the campaign rules, nominations and final result to be inspectable rather than relying on an organizer silently changing the result afterwards.

---

## A concrete example

A Monad community wants to give **10 builder spots**.

There are 100 eligible community members and 30 possible recipients.

Each eligible participant receives one TAKE.

You might choose:

**you → @sarah**

Someone else might choose:

**@mike → @tobi**

Another:

**@anna → @sarah**

At the end of the campaign, those nominations form a social graph around the opportunity.

The interesting object isn't a point balance.

It's:

> **person → person → opportunity**

---

## Built on Monad

TAKE uses Monad for the parts of a campaign that benefit from public, verifiable execution.

The current contract handles:

- campaign creation
- campaign activation
- identity registration
- giving a TAKE
- campaign closure
- allocation result commitment
- finalization

The core participant transaction is:

```solidity
giveTake(
    campaignId,
    giverProtocolIdentityKey,
    recipientIdentityKey,
    nominatorProof,
    recipientProof
)
```

A successful nomination emits a `TakeGiven` event.

TAKE then indexes that event and turns it into the canonical nomination record used by the product.

---

## Why some of TAKE is offchain

Not everything belongs onchain.

Things like:

- social identities
- Discord evidence
- eligibility reviews
- appeals
- organization setup
- campaign descriptions
- private evidence

are handled by the application.

The blockchain is used for the campaign commitments and nomination events where verifiability matters.

This keeps the user experience social while putting the important campaign actions on Monad underneath.

---

## Eligibility without giving powerful users more votes

One of the harder parts of TAKE is preventing valuable campaigns from immediately becoming farming targets.

Our current approach separates two questions.

### Eligibility

Does this person meet the campaign’s requirements?

This can use multiple kinds of evidence depending on the campaign.

### Integrity

Is there evidence that this participation is manufactured or coordinated?

Those are deliberately separate.

Someone being friends with another participant or belonging to the same community is not automatically suspicious.

We care more about repeated advantageous behavior over time.

For example:

- repeated reciprocal nominations
- nomination cycles
- the same group repeatedly benefiting each other
- unusual synchronized activity
- repeated coordination across campaigns

These observations are currently used as evidence and research signals.

They do not secretly multiply or reduce someone’s TAKE.

---

## Eligibility and anti-gaming

Status labels: **live** = usable in the create flow today; **engine** = built in the eligibility engine, not yet enabled in the create flow; **planned** = designed, not built.

### The Eligibility Evidence Stack

A campaign decides who is eligible from several kinds of existing evidence, preferring established history over activity created to farm a campaign:

| Evidence | Status |
|---|---|
| Join link / sign-ups, organizer can remove people | live |
| Campaign allowlists and member lists (X handles or wallets) | live |
| X account age | live when the X API is configured |
| Monad wallet / onchain activity | engine (the automated check currently reports evidence unavailable) |
| Community participation: Discord join date and roles | engine (needs the Discord bot configured) |
| GitHub / building history | engine |
| Manual evidence review | engine |
| Newcomer path (alternative qualification) | engine |
| Appeals | engine |

Where TAKE has no evidence, it shows **NO DATA** instead of inventing a score.

### A threshold, never a weight

Eligibility is a gate per campaign. Passing it gives you exactly one TAKE; more evidence never gives you more TAKEs. One eligible person = one TAKE.

### Integrity is separate

Integrity observations are separate from both eligibility and allocation. Operators see:

- mutual TAKEs (direct reciprocity), short cycles and timing bursts: **live** (computed on the nomination graph)
- coalitions, timing synchronisation across groups, cross-campaign coordination: **planned**

> **Social closeness is context. Repeated advantageous coordination is evidence.**

Observations are for investigation. They never secretly change anyone's weight.

### Locked onchain

The rules and the giver and recipient rosters are locked and hashed onchain before anyone gives. The contract blocks giving to yourself, giving twice, and givers who are not on the locked list.

---

## Newcomers

A system based entirely on historical evidence would naturally favor people who have been in crypto for years.

We don’t want that either.

Campaigns can define alternative qualification paths for newcomers or people whose evidence is incomplete.

They can submit evidence or request review against rules that were declared before the campaign. (Newcomer paths and appeals are supported in the engine; not yet enabled in the create flow.)

The organizer cannot simply give somebody arbitrary bonus points because they like them.

Once the final participant roster is locked, it stays locked for that campaign.

---

## Current allocation

TAKE currently uses a simple unique-support mechanism as the experimental baseline.

Every valid selector contributes one unit of support.

We have tested other approaches, including thresholds, capped support and randomized mechanisms.

None of them gave us enough confidence to claim that problems like popularity and coordinated groups are solved.

So we don’t make that claim.

This version is intentionally simple while we test TAKE with real communities.

---

## What TAKE does not claim to solve

There are still open problems.

### Popularity

Giving everyone equal nomination power does not mean every recipient receives equal attention.

Someone who is already well-known may naturally receive more TAKEs.

We are still researching this.

### Sybil resistance

TAKE can make participation harder to manufacture through persistent identities and historical evidence.

That is not the same thing as proving one human equals one account.

We don’t claim complete Sybil resistance.

### Coordination

Repeated coordination can be observed, but distinguishing a genuine close community from manipulation is difficult.

We currently prefer exposing evidence over pretending we have a perfect fraud score.

---

## Where TAKE could go next

A TAKE creates a historical recommendation:

> who backed whom, for what opportunity, and when

That becomes interesting after multiple campaigns.

For example:

Someone may repeatedly identify strong builders before they become widely known.

Someone else might have a strong history of finding creators.

This could eventually become a separate curation or recommendation reputation layer that other protocols can use.

The important distinction is:

**reputation would be information, not extra voting power.**

A person with a strong historical reputation would still get one TAKE in a campaign where everyone else gets one TAKE.

For now, we’re focused on making the core allocation experience work with real people.

---

## Tech stack

### Frontend

- React
- Vite
- TypeScript
- Privy for authentication and embedded wallets

### Backend

- Fastify
- TypeScript
- Drizzle ORM
- Supabase Postgres

### Blockchain

- Monad testnet
- Solidity / Foundry
- TakeCampaignManager
- viem

### Indexing

- QuickNode RPC
- custom event indexer
- receipt reconciliation
- canonical nomination-edge processing

### Eligibility / allocation

- campaign-specific eligibility policies
- Merkle-based selector and recipient snapshots
- deterministic allocation artifacts
- drand for verifiable randomness where required

## Architecture

```text
                       ORGANIZER
                           │
                           ▼
                  Create opportunity
                           │
                           ▼
                 Eligibility + rosters
                           │
                           ▼
                    Lock campaign
                           │
                           ▼
                 Publish to Monad
                           │
                           ▼
                    Activate campaign
                           │
                           ▼

    PARTICIPANT ── one TAKE ──► RECIPIENT
                           │
                           ▼
                     giveTake()
                           │
                           ▼
                       MONAD
                           │
                     TakeGiven
                           │
                           ▼
                       INDEXER
                           │
                           ▼
                Canonical nomination
                           │
                           ▼
                    Campaign closes
                           │
                           ▼
                      Allocation
                           │
                           ▼
                  Final result hash
```

---

## Try it

- Live app: https://takemetropolis.vercel.app (Monad testnet). Sign in with X; TAKE creates an embedded wallet for you.
- Join link flow: open a campaign's join link (`/join/<code>`), tap **Sign in with X to join**, then **Join as giver**. TAKE tops up your wallet with a little testnet MON for gas. When sign-ups close you get a notification; open the campaign, pick someone and give.
- Organizers: **Organize** creates a campaign (opportunity, sign-ups or fixed lists, optional member list, end time, and an optional check after the TAKE).
- Judges: without a join link, open **TAKE Demo** from Explore: https://takemetropolis.vercel.app/campaign/30e8b781-9143-4b84-8905-eadf13b92029. Its lists were locked before you signed in, so you can inspect it but not give there. The full walkthrough is at https://takemetropolis.vercel.app/how-it-works.

## Verify onchain

- Contract: [`0xc3A0178B31D8844455c49988736d51A2336056e5`](https://testnet.monadvision.com/address/0xc3A0178B31D8844455c49988736d51A2336056e5) (`TakeCampaignManager`, Monad testnet, chain 10143)
- Source verified on Sourcify (exact match): https://repo.sourcify.dev/10143/0xc3A0178B31D8844455c49988736d51A2336056e5
- Rebuild a campaign's rules hash from the public artifact and compare it with Monad:

```bash
git clone https://github.com/Krusherk/take && cd take
pnpm install
pnpm verify:rules 30e8b781-9143-4b84-8905-eadf13b92029
```

## Links

- Live app: https://takemetropolis.vercel.app
- API: https://take-api-sand.vercel.app (`GET /health`, `GET /campaigns`, `GET /proof/campaigns`)
- Contract: https://testnet.monadvision.com/address/0xc3A0178B31D8844455c49988736d51A2336056e5
- Demo video: `<DEMO VIDEO LINK>`
- Pitch video: `<PITCH VIDEO LINK>`

**Status:** campaigns publish, open and record TAKEs on Monad testnet today. Close, allocation and result-hash finalization run automatically after a campaign ends; the TAKE Demo campaign ends 13 Oct 2026 and its result has not been finalized onchain yet.
