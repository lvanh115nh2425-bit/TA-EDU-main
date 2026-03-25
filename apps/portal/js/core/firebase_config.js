const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCyvnLfIQ5iosFafZhCriPipDYVyVjSXr4",
  authDomain: "ta-edu-01.firebaseapp.com",
  projectId: "ta-edu-01",
  storageBucket: "ta-edu-01.firebasestorage.app",
  messagingSenderId: "309479852838",
  appId: "1:309479852838:web:7fa489a5becfd9c19b8fe7",
  measurementId: "G-FT18DWWLYV"
};

function readRuntimeConfig() {
  const fromWindow = typeof window !== "undefined" ? window.__TAEDU_FIREBASE_CONFIG__ : null;
  if (fromWindow && typeof fromWindow === "object") {
    return { ...DEFAULT_FIREBASE_CONFIG, ...fromWindow };
  }
  return DEFAULT_FIREBASE_CONFIG;
}

const firebaseConfig = readRuntimeConfig();

if (typeof window !== "undefined") {
  window.__TAEDU_FIREBASE_CONFIG__ = firebaseConfig;
}

export { firebaseConfig, DEFAULT_FIREBASE_CONFIG };
