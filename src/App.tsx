// src/App.tsx
import { Routes, Route, useLocation } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import SocialPanel from "./components/SocialPanel";
import Navbar from "./components/Navbar";
import Landing from "./pages/Landing";
import Home from "./pages/Home";
import Profile from "./pages/Profile";
import Games from "./pages/Games";
import Leaderboards from "./pages/Leaderboards";
import GameHistory from './pages/GameHistory';
import ProtectedRoute from "./routes/ProtectedRoute";

// GAME IMPORTS
import WegenRace from "../src/games/Picker/WegenRace/wegenRace";
import WackAWegen from './games/Arcade/WackAWegen/WackAWegen';

// REMOVE THIS LINE: import { useProfile } from "./context/ProfileContext";
// REMOVE THESE FIREBASE IMPORTS, AS THE LASTSEEN LOGIC IS MOVING
// import { updateDoc, doc } from "firebase/firestore";
// import { db } from "./firebase/firebaseConfig";

import Modal from "react-modal";
Modal.setAppElement("#root");

// NEW COMPONENT TO HANDLE LAST SEEN LOGIC
import UserActivityTracker from "./components/activityTracker"; // Create this new file

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
  return (
    <Layout>
      {/* Render the activity tracker here. It will be a child of ProfileProvider via main.tsx */}
      <UserActivityTracker /> 

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
  );
}