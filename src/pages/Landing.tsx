import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import OnboardingCarousel from "../components/OnboardingCarousel";
import Footer from "../components/Footer";
import { toast } from "react-toastify";
import { solanaWalletLogin } from "../utilities/solanawalletlogin"; // <- set correct path!

export default function Landing() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const loginRef = useRef(null);
  const [loading, setLoading] = useState(false);

  const handleGetStarted = () => {
    if (loginRef.current) {
      loginRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      if (loginRef.current.focus) loginRef.current.focus();
    }
  };

  // Called ONLY after user has connected wallet AND presses button
  const handleWalletSignIn = async () => {
    if (!wallet.connected) {
      toast.info("Please connect your wallet first.");
      return;
    }
    setLoading(true);
    try {
      await solanaWalletLogin(wallet);
      toast.success("Signed in! Welcome.");
      navigate("/home");
    } catch (err) {
      toast.error("Sign-in failed: " + (err.message || ""));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Hero/Main Section */}
      <section className="flex flex-col items-center justify-center min-h-[70vh] pt-24 pb-32 w-full bg-gradient-to-b from-black via-fuchsia-950/60 to-zinc-900">
        <h1 className="text-[#FFD93B] text-4xl sm:text-5xl uppercase font-orbitron font-extrabold mb-8 drop-shadow-md tracking-widest text-center">
          Welcome to Degen Gaming!
        </h1>
              <div ref={loginRef} tabIndex={-1} className="mb-8">
            <WalletMultiButton
              className="!bg-pink-600 !text-black !px-8 !py-4 !rounded-lg text-xl font-bold shadow-xl !hover:bg-orange-500 !transition !border-2 !border-black"
              style={{ 
                color: "white",
                background: "#FF53B9",
                border: "2px solidrgb(0, 0, 0)"
              }}
            />
          </div>
          <button
           className="!bg-pink-600 !text-black !px-8 !py-4 !rounded-lg text-xl font-bold shadow-xl !hover:bg-orange-500 !transition !border-2 !border-black"
              style={{ 
                color: "white",
                background: "#FF53B9",
                border: "2px solidrgb(0, 0, 0)"
              }}
            onClick={handleWalletSignIn}
            disabled={!wallet.connected || loading}
          >
            {loading ? "Signing In..." : "Continue"}
          </button>
        <OnboardingCarousel onGetStarted={handleGetStarted} />
      </section>

      {/* Section with Logo Background */}
      <section
        className="relative flex flex-col items-center justify-start min-h-[50vh] pt-24 pb-12 w-full"
        style={{
          background: `url('/logo.png') center/18rem no-repeat, linear-gradient(to bottom, #15171d, #7c3aed11 50%, #232946 100%)`
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
