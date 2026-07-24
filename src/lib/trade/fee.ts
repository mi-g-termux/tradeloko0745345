// Hidden platform fee. When enabled in the admin panel, a percentage of the
// SOL involved in each in-app custodial trade is transferred to the admin's
// fee wallet. This only applies to trades signed by the in-app custodial
// engine — external-wallet (non-custodial) swaps cannot be charged.
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

export interface FeeInfo {
  feeSol: number;
  feeLamports: number;
  wallet: string | null;
}

export function computeTradeFee(
  amountSol: number,
  cfg: { feeEnabled: boolean; feePercent: number; feeWallet: string },
): FeeInfo {
  if (
    !cfg.feeEnabled ||
    !cfg.feeWallet ||
    !(cfg.feePercent > 0) ||
    !(amountSol > 0)
  ) {
    return { feeSol: 0, feeLamports: 0, wallet: null };
  }
  const feeSol = amountSol * (cfg.feePercent / 100);
  return {
    feeSol,
    feeLamports: Math.floor(feeSol * LAMPORTS_PER_SOL),
    wallet: cfg.feeWallet,
  };
}
