import { PrivyClient, type User, type VerifyAccessTokenResponse } from "@privy-io/node";
import type { ApiEnv } from "../config/env.js";

export interface PrivyAuthResult {
  token: VerifyAccessTokenResponse;
  user: User;
}

export class PrivyAuthService {
  private readonly client: PrivyClient | undefined;

  constructor(private readonly env: Pick<ApiEnv, "PRIVY_APP_ID" | "PRIVY_APP_SECRET" | "PRIVY_VERIFICATION_KEY">) {
    if (env.PRIVY_APP_ID && env.PRIVY_APP_SECRET) {
      this.client = new PrivyClient({
        appId: env.PRIVY_APP_ID,
        appSecret: env.PRIVY_APP_SECRET,
        jwtVerificationKey: env.PRIVY_VERIFICATION_KEY
      });
    }
  }

  async verifyAccessToken(accessToken: string): Promise<PrivyAuthResult> {
    if (!this.env.PRIVY_APP_ID || !this.client) {
      throw new Error("Privy is not configured");
    }

    const token = await this.client.utils().auth().verifyAccessToken(accessToken);
    const user = await this.client.users()._get(token.user_id);
    return { token, user };
  }
}
