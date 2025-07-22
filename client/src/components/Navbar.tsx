import { Link, useLocation, useNavigate } from "react-router-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useEffect, useState, useRef, useMemo } from "react";
import { useProfile } from "../context/ProfileContext";
import { FaBars, FaTimes } from "react-icons/fa";
import { auth, db } from "../firebase/firebaseConfig";
import { doc, updateDoc } from "firebase/firestore";

function shortAddress(addr) {
  if (!addr) return "";
  return addr.slice(0, 4) + "..." + addr.slice(-4);
}

const DEFAULT_AVATAR = "/placeholder-avatar.png";

export default function Navbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { disconnect, connecting, disconnecting } = useWallet();
  const [isMobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isProfileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const { profile, loading } = useProfile();

  const navItems = [
    { to: "/home", label: "Home" },
    { to: "/games", label: "Games" },
    { to: "/leaderboards", label: "Leaderboards" },
    { to: "/profile", label: "Profile" }
  ];
  const { displayName, displayAvatar, isLoggedIn } = useMemo(() => {
    const loggedIn = !!profile;
    if (!loggedIn) return { displayName: "", displayAvatar: DEFAULT_AVATAR, isLoggedIn: false };
    const name = profile.username || shortAddress(profile.wallet);
    return { displayName: name, displayAvatar: profile.avatarUrl || DEFAULT_AVATAR, isLoggedIn: true };
  }, [profile]);

  const handleDisconnect = async () => {
    setProfileDropdownOpen(false);
    setMobileMenuOpen(false);
    const user = auth.currentUser;
    if (user) {
      try {
        await updateDoc(doc(db, "users", user.uid), {
          isOnline: false,
          lastLogout: new Date().toISOString()
        });
      } catch (e) {
        console.error("Failed to set user offline:", e);
      }
    }
    await auth.signOut();
    if (disconnect) await disconnect();
    navigate('/');
  };

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setProfileDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  useEffect(() => {
    setMobileMenuOpen(false);
    setProfileDropdownOpen(false);
  }, [pathname]);

  const WalletButtonComponent = () => (
    (connecting || disconnecting || loading) ? (
      <button className="uppercase bg-gray-700 text-gray-400 font-black px-5 py-3 rounded shadow text-base animate-pulse" disabled>
        ...
      </button>
    ) : (
      <WalletMultiButton className="!uppercase !bg-black !bg-gradient-to-tr !from-orange-600 !to-yellow-400 !text-white !font-black !px-4 sm:!px-6 !py-2 sm:!py-3 !rounded-full !shadow-lg !hover:!bg-yellow-400 !hover:!text-black !transition-all !text-base sm:!text-lg" style={{ fontFamily: "Orbitron, Montserrat, sans-serif" }} />
    )
  );

  return (
    <>
      <header className="fixed top-0 left-0 w-full z-50 bg-gradient-to-b from-[#19181C] via-[#181824] to-[#150d00] shadow-2xl border-b border-gray-900 h-24 flex items-center">
        <nav className="w-full max-w-[1600px] mx-auto flex items-center justify-between h-full px-6">
          {/* Logo */}
          <Link to="/" aria-label="Home" className="flex-shrink-0 flex items-center" style={{ width: "5rem" }}>
            <img src="/small-logo.png" alt="Logo" className="h-16 w-16 object-contain select-none animate-scaleIn" />
          </Link>
          {/* Nav Center */}
          <div className="flex-1 flex items-center justify-center">
            <div className="hidden md:flex items-center space-x-10">
              {navItems.map(item => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`
                    font-orbitron text-base font-black tracking-wide uppercase px-2 py-1 rounded-lg relative z-10
                    transition-all duration-150
                    bg-clip-text text-transparent
                    bg-gradient-to-r
                    from-[#FFA600] via-[#FFD24C] to-[#B87900]
                    ${pathname === item.to ?
                      "scale-110 shadow-lg after:content-[''] after:block after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[3px] after:bg-gradient-to-r after:from-[#FFA600] after:to-[#FFD24C] rounded after:rounded "
                      : "hover:scale-105 hover:text-yellow-300 opacity-80"}
                  `}
                  style={{
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent'
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          {/* Account/Profile/Wallet */}
          <div className="hidden md:flex items-center gap-4">
            {isLoggedIn ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setProfileDropdownOpen((o) => !o)}
                  className="flex items-center gap-2 pl-2 pr-4 py-1 bg-[#1a1d22]/70 rounded-full border-2 border-[#FFD24C] hover:border-[#FFA600] shadow-xl transition-all group ring-0 outline-none"
                >
                  <span className="inline-block relative">
                    <img src={displayAvatar} alt="avatar" className="w-10 h-10 rounded-full border-2 border-[#FFA600] object-cover shadow" />
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-400 border border-white ring-2 ring-[#19181C]" />
                  </span>
                  <span className="font-extrabold text-[1.1rem] text-white max-w-[120px] truncate drop-shadow-sm transition-all group-hover:text-[#FFD24C]">{displayName}</span>
                  <svg className={`ml-2 transition ${isProfileDropdownOpen ? "rotate-180" : ""}`} width="18" height="18" fill="currentColor"><path d="M5 7l4 4 4-4" stroke="#FFD24C" strokeWidth="2" fill="none" /></svg>
                </button>
                {isProfileDropdownOpen && (
                  <div className="absolute right-0 mt-2 min-w-[180px] bg-[#181820] text-white shadow-2xl rounded-lg border border-gray-800 ring-1 ring-yellow-500/30 overflow-hidden animate-fadeInUp z-50">
                    <Link to="/profile" className="block w-full text-left px-5 py-3 text-sm font-semibold hover:bg-gradient-to-r hover:from-yellow-700 hover:to-orange-700 hover:text-white transition-colors">
                      Profile
                    </Link>
                    <button
                      onClick={handleDisconnect}
                      className="w-full text-left px-5 py-3 text-sm font-bold text-red-400 hover:bg-red-700 hover:text-white transition-colors"
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <WalletButtonComponent />
            )}
          </div>
          {/* Hamburger */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden text-yellow-400 hover:text-yellow-200 text-2xl p-2 ml-2 transition"
            aria-label="Open mobile menu"
          >
            <FaBars />
          </button>
        </nav>
      </header>
      {/* Mobile Menu */}
      <div className={`fixed inset-0 z-[100] bg-black/80 backdrop-blur transition-opacity duration-300 pointer-events-none select-none ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto select-auto' : 'opacity-0'}`}>
        <div className={`absolute top-0 right-0 h-full w-full max-w-xs bg-[#19181c] shadow-2xl transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="p-8 flex flex-col h-full">
            <div className="flex justify-between items-center mb-8">
              <span style={{ background: 'linear-gradient(90deg,#FFD24C,#FFA600,#FFD24C)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }} className="font-orbitron text-2xl font-black">
                Menu
              </span>
              <button onClick={() => setMobileMenuOpen(false)} className="text-[#FFA600] hover:text-[#FFD24C] text-3xl focus:outline-none">
                <FaTimes />
              </button>
            </div>
            {isLoggedIn ? (
              <div className="flex flex-col items-center mb-8 pb-8 border-b border-gray-700">
                <img
                  src={displayAvatar}
                  alt="avatar"
                  className="w-20 h-20 rounded-full border-4 border-[#FFA600] object-cover mb-3 shadow-lg"
                />
                <span className="text-white font-extrabold text-xl mb-3">{displayName}</span>
                <button
                  onClick={handleDisconnect}
                  className="w-32 py-3 mt-2 rounded-lg font-orbitron text-md bg-gradient-to-r from-[#ee4444] to-[#ffaeae] hover:from-red-800 hover:to-[#ffaeae] text-white font-black shadow transition-colors"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="mb-8 pb-8 border-b border-gray-700">
                <WalletButtonComponent />
              </div>
            )}
            <nav className="flex flex-col gap-y-5 w-full items-center mt-5">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`
                    w-full text-center py-3 rounded-lg font-orbitron text-lg font-black uppercase
                    bg-clip-text text-transparent
                    bg-gradient-to-r from-[#FFA600] via-[#FFD24C] to-[#B87900]
                    transition-all
                    ${pathname === item.to ? 'shadow-xl scale-105 bg-[#251115] text-white' : 'hover:bg-gray-800/60'}
                  `}
                  style={{
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent'
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>
      {/* Spacing for fixed nav */}
      <div className="h-24 w-full" />
    </>
  );
}
