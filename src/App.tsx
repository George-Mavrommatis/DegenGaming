// src/App.tsx
import { useMemo , useEffect} from "react";
import { BrowserRouter as Router, Routes, Route, useLocation } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import SocialPanel from "./components/SocialPanel";
import Navbar from "./components/Navbar";
import Landing from "./pages/Landing";
import Home from "./pages/Home";
import Profile from "./pages/Profile";
import Games from "./pages/Games";
import Leaderboards from "./pages/Leaderboards";
import GameHistory from './pages/GameHistory';
import { ProfileProvider } from "./context/ProfileContext";
import ProtectedRoute from "./routes/ProtectedRoute";

// GAME IMPORTS
import WegenRace from "../src/games/Picker/WegenRace/wegenRace"; // ✅ Corrected import path
import WackAWegen from './games/Arcade/WackAWegen/WackAWegen';

// SOLANA WALLET ADAPTERS
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import "@solana/wallet-adapter-react-ui/styles.css";

import { updateDoc, doc } from "firebase/firestore";
import { db } from "./firebase/firebaseConfig";
import { useFirebaseUser } from "./firebase/userProfile";

import Modal from "react-modal";
Modal.setAppElement("#root");

function Layout({ children }: { children: JSX.Element }) {
  const location = useLocation();
  const showNavbar = location.pathname !== "/";
  const { connected } = useWallet();
  const showSocialPanel = connected && location.pathname !== "/";
  const NAVBAR_HEIGHT = 80;

  return (
    <div className="bg-black min-h-screen w-full">
      {showSocialPanel && <SocialPanel />}
      {showNavbar && <Navbar />}
      <main
        className="w-full bg-black min-h-screen"
        style={{ paddingTop: showNavbar ? NAVBAR_HEIGHT : 0 }}
      >
        {children}
      </main>
    </div>
  );
}

export default function App() {
  const endpoint = useMemo(() => "https://mainnet.helius-rpc.com/?api-key=e66bcdec-83f7-4c5d-b7d6-808ad9570652", []);  
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );
  
  const { user } = useFirebaseUser();
  useEffect(() => {
    if (!user) return;
    updateDoc(doc(db, "users", user.uid), {
      lastSeen: new Date().toISOString()
    });
    const interval = setInterval(() => {
      updateDoc(doc(db, "users", user.uid), {
        lastSeen: new Date().toISOString()
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [user?.uid]);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <ProfileProvider>
            <Router>
              <Layout>
                <Routes>
                  {/* Public Route */}
                  <Route path="/" element={<Landing />} />

                  {/* Protected Routes Wrapper */}
                  <Route element={<ProtectedRoute />}>
                    <Route path="/home" element={<Home />} />
                    <Route path="/profile" element={<Profile />} />
                    <Route path="/profile/history" element={<GameHistory />} />
                    <Route path="/games" element={<Games />} />
                    <Route path="/leaderboards" element={<Leaderboards />} />

                    {/* Game Routes that require login */}
                    <Route path="/games/wegenrace" element={<WegenRace />} />
                    <Route path="/games/wackawegen" element={<WackAWegen />} />
                  </Route>
                </Routes>
              </Layout>
            </Router>
          </ProfileProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}