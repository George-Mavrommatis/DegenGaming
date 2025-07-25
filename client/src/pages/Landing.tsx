import { useRef, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import OnboardingCarousel from "../components/OnboardingCarousel";
import Footer from "../components/Footer";
import { toast } from "react-toastify";
import { solanaWalletLogin } from "../utilities/solanaWalletLogin";
import { useProfile } from "../context/ProfileContext";

export default function Landing() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const loginRef = useRef<HTMLDivElement>(null);
  const [loadingSignIn, setLoadingSignIn] = useState(false);
  const { isAuthenticated, loading: profileLoading } = useProfile();

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  const handleGetStarted = () => {
    if (loginRef.current) {
      loginRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  const performSolanaSignIn = useCallback(async () => {
    if (!wallet.connected || !wallet.publicKey || isAuthenticated) {
      return;
    }
    if (loadingSignIn) {
      return;
    }

    setLoadingSignIn(true);
    try {
      await solanaWalletLogin(wallet);
      toast.success("Signed in! Welcome.");
      navigate("/home");
    } catch (err: any) {
      console.error("Solana sign-in failed:", err);
      if (
        !err.message?.includes("Wallet not found") &&
        !err.message?.includes("User rejected the request")
      ) {
        toast.error("Sign-in failed: " + (err.message || "Please try again."));
      } else {
        toast.info("Wallet connection was cancelled or failed.");
      }
    } finally {
      setLoadingSignIn(false);
    }
  }, [
    wallet,
    isAuthenticated,
    loadingSignIn,
    navigate
  ]);

  useEffect(() => {
    if (
      wallet.connected &&
      wallet.publicKey &&
      !isAuthenticated &&
      !loadingSignIn &&
      !profileLoading
    ) {
      performSolanaSignIn();
    }
  }, [
    wallet.connected,
    wallet.publicKey,
    isAuthenticated,
    loadingSignIn,
    profileLoading,
    performSolanaSignIn
  ]);

  return (
    <>
      {/* Hero/Main Section */}
      <section className="relative flex flex-col items-center justify-center min-h-[70vh] pt-24 pb-32 w-full bg-gradient-to-b from-black via-fuchsia-950/60 to-zinc-900 overflow-hidden">
        {/* Layer 2: Large transparent GIF logo in the background */}
        <img
          src="/dglogo.gif"
          alt="Degen Gaming Logo Animation"
          aria-hidden
          className="pointer-events-none select-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-0"
          style={{
            width: "65vw",
            maxWidth: 800,
            minWidth: 320,
            opacity: 0.25,
            filter: "blur(0.5px)",
            objectFit: "contain",
          }}
        />
        {/* Main content (z-10) */}
        <div className="relative z-10 flex flex-col items-center w-full">
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
                  border: "2px solid rgb(0, 0, 0)",
                }}
              >
                Go to Home
              </button>
            </div>
          ) : (
            <>
              <div ref={loginRef} tabIndex={-1} className="mb-8">
                <WalletMultiButton />
              </div>
              <button
                className="!bg-pink-600 !text-black !px-8 !py-4 !rounded-lg text-xl font-bold shadow-xl !hover:bg-orange-500 !transition !border-2 !border-black"
                style={{
                  color: "white",
                  background: "#FF53B9",
                  border: "2px solid rgb(0, 0, 0)",
                }}
                onClick={performSolanaSignIn}
                disabled={
                  loadingSignIn ||
                  wallet.connecting ||
                  profileLoading ||
                  !wallet.connected
                }
              >
                {loadingSignIn
                  ? "Signing In..."
                  : wallet.connected
                  ? "Continue to Game"
                  : "Connect Wallet First"}
              </button>
            </>
          )}
          {/* Spacer for carousel */}
          <div style={{ marginTop: "5rem" }}>
            <OnboardingCarousel onGetStarted={handleGetStarted} />
          </div>
        </div>
      </section>

      {/* Section with Logo Background */}
      <section
        className="relative flex flex-col items-center justify-start min-h-[50vh] pt-24 pb-12 w-full"
        style={{
          background: `url('/logo.png') center/18rem no-repeat, linear-gradient(to bottom, #15171d, #7c3aed11 50%, #232946 100%)`,
        }}
      >
        <div className="absolute inset-0 bg-black/60" />
        <h1 className="relative z-10 text-[#FFD93B] text-3xl sm:text-5xl uppercase font-orbitron font-extrabold mb-4 drop-shadow-md tracking-widest text-center">
          We are here to build Degen Games for Web3!
        </h1>
      </section>

      <Footer />
    </>
  );
}