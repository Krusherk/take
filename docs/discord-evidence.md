# Discord Community Evidence

## What TAKE Reads

For a known candidate with a verified Privy Discord subject, TAKE may query one configured organizer guild for:

- whether the user is a member;
- role IDs;
- `joined_at`;
- pending membership state.

TAKE does not request or read messages, channels, DMs, reactions, friend lists, or activity history. Discord account creation time is derived locally from the immutable Snowflake ID.

## Dashboard Setup

1. Create one Discord application and bot for TAKE.
2. Set `DISCORD_APPLICATION_ID` and `DISCORD_BOT_TOKEN` in the API secret environment.
3. Add the exact OAuth redirect in Discord and set `DISCORD_INSTALL_REDIRECT_URI` to the same API callback, for example `https://api.take.example/integrations/discord/callback`.
4. Set a long random `DISCORD_INSTALL_STATE_SECRET` used only to sign ten-minute install state.
5. Enable the OAuth2 code-grant install flow for the configured redirect.
6. An organization owner/admin opens TAKE's install URL and chooses a guild where they have Discord's Manage Guild permission.

The generated URL requests only `bot applications.commands`, zero bot permissions, server integration type, explicit consent, and signed state. The callback does not persist a Discord user token. It verifies that the configured TAKE bot can fetch the selected guild before recording the installation.

## Collection Behavior

TAKE calls `GET /guilds/{guild.id}/members/{user.id}` for known candidates with bounded concurrency.

- `200`: snapshot roles, `joined_at`, pending state, retrieval time, and provenance.
- `404`: verified non-membership (`FAIL` when membership is required).
- `429` or `5xx`: retry with bounded backoff, then `UNKNOWN` if unavailable.
- `401`, `403`, missing installation, or invalid payload: `UNKNOWN`, blocking lock.

The application bot token remains a deployment secret. The database stores guild metadata, installation status, health time, and error code only.

Official references: [Discord Guild Member](https://docs.discord.com/developers/resources/guild#guild-member-object) and [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2).
