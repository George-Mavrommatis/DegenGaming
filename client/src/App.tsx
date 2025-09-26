import { Routes, Route, useLocation } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import React, { useState } from "react";
import SocialPanel from "./components/SocialPanel";
import Navbar from "./components/Navbar";
import Landing from "./pages/Landing";
import Home from "./pages/Home";
import Profile from "./pages/Profile";
import Games from "./pages/Games";
import Leaderboards from "./pages/Leaderboards";
import GameHistory from './pages/GameHistory';
import ProtectedRoute from "./routes/ProtectedRoute";
import DegenRace from "../src/games/Picker/DegenRace/DegenRace";
import WhackADegen from './games/Arcade/WhackADegen/WhackADegen';
import Modal from "react-modal";
import UserActivityTracker from "./components/activityTracker";
Modal.setAppElement("#root");

const NAVBAR_HEIGHT = 80;

function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const showNavbar = location.pathname !== "/";
  return (
    <div className="bg-black min-h-screen w-full font-[WegensFont]">
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
  const [socialOpen, setSocialOpen] = useState(false);
  const location = useLocation();
  const { connected } = useWallet();

  // Show SocialPanel and button on all pages except landing
  const showSocialPanel = connected && location.pathname !== "/";

  return (
    <React.Fragment>
      <Layout>
        <UserActivityTracker />
        <Routes>
          {/* Public Route */}
          <Route path="/" element={<Landing />} />
          {/* Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/home" element={<Home />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/history" element={<GameHistory />} />
            <Route path="/games" element={<Games />} />
            <Route path="/leaderboards" element={<Leaderboards />} />
            {/* Game Routes that require login */}
            <Route path="/games/degenrace" element={<DegenRace />} />
            <Route path="/games/whackadegen" element={<WhackADegen />} />
          </Route>
        </Routes>
      </Layout>

      {/* Floating Social Toggle Button */}
      {showSocialPanel && (
      <button
        aria-label="Open Social Panel"
        onClick={() => setSocialOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-20 h-20 rounded-full bg-gradient-to-tr from-orange-500 to-yellow-400 text-white shadow-2xl hover:scale-110 transition flex items-center justify-center border-4 border-yellow-300 font-[WegensFont]"
        style={{ fontSize: 38, boxShadow: "0 8px 32px rgba(255,140,0,0.15)" }}
      >
        {/* Social/chat/friends icon */}
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
          <circle cx="7.5" cy="8" r="2.2" fill="#fff" />
          <circle cx="12" cy="8" r="2.2" fill="#fff" />
          <circle cx="16.5" cy="8" r="2.2" fill="#fff" />
          <ellipse cx="12" cy="15" rx="8" ry="5" stroke="#fff" strokeWidth="2"/>
        </svg>
      </button>
    )}

      {/* Social Panel overlay */}
      <SocialPanel isOpen={socialOpen && showSocialPanel} onClose={() => setSocialOpen(false)} />
    </React.Fragment>
  );
}