import { PrivyClient, type User, type VerifyAccessTokenResponse } from "@privy-io/node";
import type { ApiEnv } from "../config/env.js";

export interface PrivyAuthResult {
  token: VerifyAccessTokenResponse;
  user: User;
}

const USER_CACHE_MS = 15_000;
const USER_CACHE_LIMIT = 1_000;

export class PrivyAuthService {
  private readonly client: PrivyClient | undefined;
  // A page load sends several API requests at once; each used to fetch the same
  // Privy user over HTTP. Share one in-flight lookup, and reuse it briefly for
  // requests that do not read linked accounts (the token is still verified every time).
  private readonly users = new Map<string, { user: Promise<User>; fetchedAt: number }>();

  constructor(private readonly env: Pick<ApiEnv, "PRIVY_APP_ID" | "PRIVY_APP_SECRET" | "PRIVY_VERIFICATION_KEY">) {
    if (env.PRIVY_APP_ID && env.PRIVY_APP_SECRET) {
      this.client = new PrivyClient({
        appId: env.PRIVY_APP_ID,
        appSecret: env.PRIVY_APP_SECRET,
        jwtVerificationKey: env.PRIVY_VERIFICATION_KEY
      });
    }
  }

  /**
   * @param fresh  Require a lookup that started after this request arrived
   *               (identity routes, so newly linked accounts show at once).
   */
  async verifyAccessToken(accessToken: string, { fresh = false }: { fresh?: boolean } = {}): Promise<PrivyAuthResult> {
    if (!this.env.PRIVY_APP_ID || !this.client) {
      throw new Error("Privy is not configured");
    }

    const startedAt = Date.now();
    const token = await this.client.utils().auth().verifyAccessToken(accessToken);
    const user = await this.lookupUser(token.user_id, fresh ? startedAt : startedAt - USER_CACHE_MS);
    return { token, user };
  }

  private lookupUser(userId: string, notBefore: number): Promise<User> {
    const cached = this.users.get(userId);
    if (cached && cached.fetchedAt >= notBefore) return cached.user;
    const fetchedAt = Date.now();
    const user = this.client!.users()._get(userId);
    this.users.set(userId, { user, fetchedAt });
    user.catch(() => { if (this.users.get(userId)?.user === user) this.users.delete(userId); });
    if (this.users.size > USER_CACHE_LIMIT) this.users.delete(this.users.keys().next().value!);
    return user;
  }
}
