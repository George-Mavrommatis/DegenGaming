// DegenGamingFrontend/src/layout/Layout.tsx
// Ensure this file matches the one I provided exactly.

import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from '../components/Header';
import Footer from '../components/Footer';
import SocialPanel from '../components/SocialPanel';

const Layout: React.FC = () => {
  const [isSocialPanelOpen, setIsSocialPanelOpen] = useState(false);

  const toggleSocialPanel = () => {
    setIsSocialPanelOpen(!isSocialPanelOpen);
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900 text-white font-rajdhani">
      <Header />
      <main className="flex-grow">
        <Outlet />
      </main>
      <Footer />

      {/* Persistent Button for Social Panel */}
      <button
        className="fixed bottom-8 right-8 bg-purple-600 hover:bg-purple-700 text-white rounded-full p-4 shadow-xl z-40 transition-transform transform hover:scale-110 focus:outline-none focus:ring-4 focus:ring-purple-300 focus:ring-opacity-75"
        onClick={toggleSocialPanel}
        aria-label="Open Social Panel"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9a1 1 0 100-2 1 1 0 000 2zm7-2a1 1 0 10-2 0 1 1 0 002 0zm-7 4a1 1 0 100-2 1 1 0 000 2zm7-2a1 1 0 10-2 0 1 1 0 002 0z" clipRule="evenodd" />
        </svg>
      </button>

      {/* SocialPanel Modal/Overlay */}
      <SocialPanel isOpen={isSocialPanelOpen} onClose={toggleSocialPanel} />
    </div>
  );
};

export default Layout;