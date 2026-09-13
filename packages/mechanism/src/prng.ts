import { concatHex, hexToBigInt, keccak256, numberToHex, sha256, stringToHex, type Hex } from "viem";

const UINT256_RANGE = 1n << 256n;

export function seedFromText(value: string): Hex {
  return keccak256(stringToHex(value));
}

export class DeterministicRandom {
  private counter = 0n;

  constructor(private readonly seed: Hex) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(seed)) {
      throw new TypeError("DeterministicRandom requires a bytes32 seed");
    }
  }

  nextUint256(): bigint {
    const value = sha256(concatHex([this.seed, numberToHex(this.counter, { size: 32 })]));
    this.counter += 1n;
    return hexToBigInt(value);
  }

  nextBigInt(upperExclusive: bigint): bigint {
    if (upperExclusive <= 0n || upperExclusive > UINT256_RANGE) {
      throw new RangeError("upperExclusive must be between 1 and 2^256");
    }
    const acceptedRange = UINT256_RANGE - (UINT256_RANGE % upperExclusive);
    for (;;) {
      const value = this.nextUint256();
      if (value < acceptedRange) return value % upperExclusive;
    }
  }

  nextInt(upperExclusive: number): number {
    if (!Number.isSafeInteger(upperExclusive) || upperExclusive <= 0) {
      throw new RangeError("upperExclusive must be a positive safe integer");
    }
    return Number(this.nextBigInt(BigInt(upperExclusive)));
  }

  shuffle<T>(values: readonly T[]): T[] {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = this.nextInt(index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
    }
    return shuffled;
  }
}
