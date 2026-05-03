import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseConfigured = !!(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

let _auth: ReturnType<typeof getAuth> | null = null;
let _googleProvider: GoogleAuthProvider | null = null;

if (firebaseConfigured) {
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig as Required<typeof firebaseConfig>);
  _auth = getAuth(app);
  _googleProvider = new GoogleAuthProvider();
  _googleProvider.setCustomParameters({ prompt: "select_account" });
}

export const firebaseAuth = _auth;
export const googleProvider = _googleProvider;

export async function getFirebaseIdToken(): Promise<string | null> {
  if (!_auth?.currentUser) return null;
  return _auth.currentUser.getIdToken();
}
