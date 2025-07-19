// src/main.tsx

// ADD THESE TWO LINES AT THE TOP
import { Buffer } from 'buffer';
window.Buffer = Buffer;

// --- The rest of your file ---
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);