// src/firebase/firebaseConfig.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth"; // ✅ 1. Import getAuth



// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAIwxSX2J2Rk6kebsuETFYUzaItdPNXADc",
  authDomain: "ggweb3.firebaseapp.com",
  projectId: "ggweb3",
  storageBucket: "ggweb3.firebasestorage.app",
  messagingSenderId: "22921995728",
  appId: "1:22921995728:web:861b967995c87de64145d5",
  measurementId: "G-BV5CGT7YX6"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// ✅ 2. Initialize each service and export it
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app); // This creates and exports the auth instance for your whole app
