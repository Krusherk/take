# Where TAKE is

Written 2026-10-06. This is the working record of the demo, the product, and what is still open. It does not include keys, tokens, or private RPC URLs.

GitHub `main` matches `66b28ff`. Local leftovers that are not part of the product are `apps/web/tsconfig.tsbuildinfo` and the untracked `crackp/` folder.

## Done

The demo can be created and signed by the organizer, without seeding the database.

- Expired campaigns can no longer be published or activated. Monad rejects an end time that is already past, and the app now rejects that before the signature. Commit `b92cf4e`.
- An organizer can create a campaign from Organize. The form is three steps: describe the opportunity, choose who can give and who can receive, then sign twice. The first signature publishes the campaign. The second opens nominations. After the second signature, a campaign with an open window shows as live in Explore. Commit `c68f204`.
- TAKE Demo is that campaign. It is campaign 4 on the Monad testnet manager, and it was activated. People on its roster can give one TAKE.
- A give to rumey, reference `6b68eb02`, was accepted on Monad. The receipt was then recorded: the nomination is confirmed and the edge is valid and finalized. The screen had paused on “Confirming on Monad…” because status waited on a slow receipt check, and a failed poll could send the giver back to confirm a TAKE that was already sent.
- That pause is fixed in `9054ad1`. Receipt calls time out instead of hanging. A signed give stays on the pending screen. The copy moves to “Transaction confirmed. Recording your TAKE…” while the record is written. A refresh of the new client can resume a give that already has a transaction hash. The progress bar keeps moving.
- Campaign, Explore, and Signal were rewritten so they read as a poster and a person instead of a stack of counters. Commit `e3927de`. A campaign page is one poster, three short lines about who can give, who can receive, and what stays visible, and one side card for your own TAKE. Explore is a stack of posters. The numbered index is gone. The handoff artwork no longer prints COMMUNITY, WHO?, and ONE TAKE when nobody has been chosen.
- Signal was still an empty headline for the person who received a TAKE, because it only listed TAKEs they had given. `66b28ff` leads with who backed you: two faces, their name, and the campaign, on a black and lime board.
- The web and API typechecks passed for these changes. The web test suite passed on the give-flow and Organize work. No dev server was left running. The pilot database was not seeded.

## In progress

- Vercel has to finish deploying `66b28ff` before Signal, Explore, and the campaign page match what is on `main`. A hard refresh of an old bundle still shows the previous screen.
- Giving a TAKE still depends on the receipt fast path. The historical indexer cursor was far behind the live chain, so it does not catch a new give on its own. The status request reconciles that receipt directly.
- GitHub pushes work for this repo, and the commits above are on `origin/main`. A lasting `gh` login is not saved on this machine. The next push needs a login or another one-time credential. The personal access token that was pasted in chat was not stored in git config. Revoke it.
- Signing still happens in the organizer’s or giver’s wallet. Nothing in this work signs a transaction on their behalf.

## Not done

- The new screens have not been clicked through in a browser from this session. Typecheck and unit tests passed. A live visual pass of Signal, Explore, campaign, Organize, and the give flow is still outstanding.
- People who have not signed up cannot be judged for pre-eligibility from the Organize form. The form only lists people who already have a TAKE account, and a giver must have a connected wallet before the campaign is created. The mechanism can name an external identity, such as an X account, before that person joins, and it can score wallet history, Discord, social history, or reviewed work. That fuller path is not what the simple create form runs. A stranger with no X account, wallet, Discord, or recorded work still has nothing to evaluate.
- No post-campaign outcome has been evaluated. Signal can say who backed whom. “What happened after” stays on “waiting” until a campaign is finalized and someone records an evaluation against a locked plan.
- The indexer cursor was not moved forward. Future gives still depend on the receipt reconciler rather than the historical scan.
- Gas sponsorship is off. If a wallet prompt asks for gas, that TAKE wallet needs a little Monad testnet MON.
- Explore and the campaign page got one layout pass. If they still feel sparse after `66b28ff` is live, they have not had the same poster treatment Signal just got for the person who was backed.
- Takes, Activity, and Profile still use the older ledger and activity rows. They were not part of the last visual pass.
- A newcomer or appeal path is hidden when someone was never in the candidate group. The side card explains that they cannot give. There is no way, in the current create flow, to add them after the roster is locked.
- Mechanism V2 is not approved and is rejected on purpose. Discord install, allocation, and randomness exist in the protocol and are not part of the demo’s create form.
