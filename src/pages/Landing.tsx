import { useRef, useState, useEffect } from "react"; // Add useEffect
import { useNavigate } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import OnboardingCarousel from "../components/OnboardingCarousel";
import Footer from "../components/Footer";
import { toast } from "react-toastify";
import { solanaWalletLogin } from "../utilities/solanaWalletLogin";
import { useProfile } from "../context/ProfileContext"; // Import useProfile

export default function Landing() {
  const wallet = useWallet(); // wallet context includes: connected, connecting, publicKey, signMessage, etc.
  const navigate = useNavigate();
  const loginRef = useRef<HTMLDivElement>(null); // Specify type for useRef
  const [loadingSignIn, setLoadingSignIn] = useState(false); // Renamed to avoid conflict with ProfileContext's loading
  const { isAuthenticated, loading: profileLoading } = useProfile(); // Get auth state and loading from ProfileContext

  const handleGetStarted = () => {
    if (loginRef.current) {
      loginRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      // No need for focus on div, it's not typically focusable without tabindex.
    }
  };

  const performSolanaSignIn = async () => {
    // Only proceed if wallet is connected and not already authenticated with Firebase
    if (!wallet.connected || !wallet.publicKey || isAuthenticated) {
      return;
    }
    
    // Prevents re-triggering if already in process
    if (loadingSignIn) {
      return;
    }

    setLoadingSignIn(true);
    try {
      // Pass the entire wallet object (which contains publicKey, signMessage)
      await solanaWalletLogin(wallet); 
      toast.success("Signed in! Welcome.");
      navigate("/home"); // Navigate to home ONLY on successful sign-in
    } catch (err: any) {
      console.error("Solana sign-in failed:", err);
      // Only show error if it's not a common user cancellation (e.g., wallet closed)
      if (!err.message?.includes("Wallet not found") && !err.message?.includes("User rejected the request")) {
        toast.error("Sign-in failed: " + (err.message || "Please try again."));
      } else {
        toast.info("Wallet connection was cancelled or failed.");
      }
    } finally {
      setLoadingSignIn(false);
    }
  };

  // Effect to automatically trigger sign-in when wallet connects
  useEffect(() => {
    // Only attempt auto-sign-in if:
    // 1. Wallet is connected
    // 2. We have a public key
    // 3. We are not already authenticated with Firebase
    // 4. We are not currently in the process of signing in
    // 5. The profile context itself is not still loading auth state
    if (wallet.connected && wallet.publicKey && !isAuthenticated && !loadingSignIn && !profileLoading) {
      console.log("Wallet connected, attempting auto sign-in with Firebase...");
      performSolanaSignIn();
    }
  }, [
    wallet.connected,
    wallet.publicKey,
    isAuthenticated,
    loadingSignIn,
    profileLoading,
    performSolanaSignIn // Include the callback in dependencies
  ]);

  return (
    <>
      {/* Hero/Main Section */}
      <section className="flex flex-col items-center justify-center min-h-[70vh] pt-24 pb-32 w-full bg-gradient-to-b from-black via-fuchsia-950/60 to-zinc-900">
        <h1 className="text-[#FFD93B] text-4xl sm:text-5xl uppercase font-orbitron font-extrabold mb-8 drop-shadow-md tracking-widest text-center">
          Welcome to Degen Gaming!
        </h1>
        {isAuthenticated ? (
          <div className="text-white text-center">
            <p className="text-xl mb-4">You are logged in!</p>
            <button
              onClick={() => navigate("/home")}
              className="!bg-pink-600 !text-black !px-8 !py-4 !rounded-lg text-xl font-bold shadow-xl !hover:bg-orange-500 !transition !border-2 !border-black"
              style={{
                color: "white",
                background: "#FF53B9",
                border: "2px solidrgb(0, 0, 0)",
              }}
            >
              Go to Home
            </button>
          </div>
        ) : (
          <>
            <div ref={loginRef} tabIndex={-1} className="mb-8">
              <WalletMultiButton
                className="!bg-pink-600 !text-black !px-8 !py-4 !rounded-lg text-xl font-bold shadow-xl !hover:bg-orange-500 !transition !border-2 !border-black"
                style={{
                  color: "white",
                  background: "#FF53B9",
                  border: "2px solidrgb(0, 0, 0)",
                }}
              />
            </div>
            <button
              className="!bg-pink-600 !text-black !px-8 !py-4 !rounded-lg text-xl font-bold shadow-xl !hover:bg-orange-500 !transition !border-2 !border-black"
              style={{
                color: "white",
                background: "#FF53B9",
                border: "2px solidrgb(0, 0, 0)",
              }}
              // The button will now explicitly trigger sign-in if wallet is connected
              // or prompt user to connect.
              onClick={performSolanaSignIn}
              disabled={loadingSignIn || wallet.connecting || profileLoading} // Disable if already loading, connecting, or profile is loading
            >
              {loadingSignIn
                ? "Signing In..."
                : wallet.connected
                ? "Continue to Game"
                : "Connect Wallet First"}
            </button>
          </>
        )}
        <OnboardingCarousel onGetStarted={handleGetStarted} />
      </section>

      {/* Section with Logo Background */}
      <section
        className="relative flex flex-col items-center justify-start min-h-[50vh] pt-24 pb-12 w-full"
        style={{
          background: `url('/logo.png') center/18rem no-repeat, linear-gradient(to bottom, #15171d, #7c3aed11 50%, #232946 100%)`,
        }}
      >
        {/* Overlay for contrast */}
        <div className="absolute inset-0 bg-black/60" />
        <h1 className="relative z-10 text-[#FFD93B] text-3xl sm:text-5xl uppercase font-orbitron font-extrabold mb-4 drop-shadow-md tracking-widest text-center">
          We are here to build Degen Games for Web3!
        </h1>
      </section>

      <Footer />
    </>
  );
}