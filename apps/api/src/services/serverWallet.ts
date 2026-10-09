import { keccak256, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { createMonadPublicClient, loadChainConfig } from "@take/chain";
import type { ApiEnv } from "../config/env.js";

export type ServerWalletCall = { to: Address; data: Hex; chainId: number };
export type SignedServerTransaction = { hash: Hex; serialized: Hex; from: Address; nonce: number };

/**
 * The dedicated TAKE server wallet. The key only lives in FINALIZER_PRIVATE_KEY;
 * nothing here logs, returns or serializes it.
 */
export class ServerWallet {
  private constructor(
    private readonly account: PrivateKeyAccount,
    readonly client: PublicClient,
    readonly chainId: number
  ) {}

  static fromEnv(env: ApiEnv, client?: PublicClient): ServerWallet | null {
    if (!env.FINALIZER_PRIVATE_KEY) return null;
    const config = loadChainConfig({
      MONAD_NETWORK: env.MONAD_NETWORK,
      MONAD_TESTNET_RPC_URL: env.MONAD_TESTNET_RPC_URL,
      MONAD_MAINNET_RPC_URL: env.MONAD_MAINNET_RPC_URL,
      TAKE_CAMPAIGN_MANAGER_ADDRESS: env.TAKE_CAMPAIGN_MANAGER_ADDRESS
    });
    return new ServerWallet(
      privateKeyToAccount(env.FINALIZER_PRIVATE_KEY as Hex),
      client ?? createMonadPublicClient(config, { timeout: 15_000, retryCount: 1 }),
      config.chainId
    );
  }

  get address(): Address {
    return this.account.address;
  }

  /** Signs locally so the hash is known (and can be recorded) before broadcast. */
  async sign(call: ServerWalletCall): Promise<SignedServerTransaction> {
    if (call.chainId !== this.chainId) throw new Error("Server wallet chain does not match the prepared transaction");
    const [nonce, gasEstimate, fees] = await Promise.all([
      this.client.getTransactionCount({ address: this.account.address, blockTag: "pending" }),
      this.client.estimateGas({ account: this.account.address, to: call.to, data: call.data }),
      this.client.estimateFeesPerGas()
    ]);
    // Monad bills the gas limit, so keep the margin small.
    const gas = (gasEstimate * 12n) / 10n;
    const serialized = await this.account.signTransaction({
      type: "eip1559",
      chainId: call.chainId,
      to: call.to,
      data: call.data,
      value: 0n,
      nonce,
      gas,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas
    });
    return { hash: keccak256(serialized), serialized, from: this.account.address, nonce };
  }

  async broadcast(signed: SignedServerTransaction) {
    try {
      await this.client.sendRawTransaction({ serializedTransaction: signed.serialized });
    } catch (error) {
      // Re-broadcasting an already known transaction is fine.
      const text = error instanceof Error ? error.message.toLowerCase() : "";
      if (!text.includes("already known") && !text.includes("already imported")) throw error;
    }
    return this.client.waitForTransactionReceipt({ hash: signed.hash, timeout: 25_000, pollingInterval: 500 })
      .catch(() => null);
  }

  async balance() {
    return this.client.getBalance({ address: this.account.address });
  }
}
