// src/solana/solanaWalletLogin.ts

import {
  signInWithCustomToken,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { auth } from "../firebase/firebaseConfig";

// Use full URL in dev, relative in prod
const apiUrl =
  import.meta.env.PROD
    ? "/verify-wallet"
    : "http://localhost:4000/verify-wallet"; // This resolves to the correct full URL or relative path

// Add a type for wallet for clarity (Phantom/Wallet Standard)
type SolanaWallet = {
  publicKey: { toString: () => string };
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  connect: () => Promise<void>;
  connected: boolean;
};

export async function solanaWalletLogin(
  wallet: SolanaWallet,
  onStatus?: (msg: string) => void
) {
  try {
    onStatus?.("Connecting wallet...");
    if (!wallet.connected) {
      await wallet.connect();
    }
    const address = wallet.publicKey.toString();
    const nonce = (Math.random() * 1e18).toString();
    const message = `Sign in to Degen Gaming with this one-time code: ${nonce}`;
    onStatus?.("Requesting signature...");
    const signed = await wallet.signMessage(new TextEncoder().encode(message));
    const signature = btoa(String.fromCharCode(...signed));

    onStatus?.("Verifying signature...");
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, signedMessage: signature, nonce }),
    });
    const data = await res.json();

    if (!data.customToken) throw new Error(data.error || "No customToken in response");

    await setPersistence(auth, browserLocalPersistence);
    onStatus?.("Logging in...");
    // This is the key: signInWithCustomToken will trigger onAuthStateChanged in ProfileContext
    // which will then ensure the profile, set isOnline, and emit setUid to the backend.
    await signInWithCustomToken(auth, data.customToken);

    onStatus?.("Login successful!");
  } catch (err: any) {
    onStatus?.("Login failed: " + (err?.message || err));
    console.error("solanaWalletLogin error:", err);
    throw err;
  }
}