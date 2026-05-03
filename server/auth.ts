import type { Express, RequestHandler } from "express";
import { getApps, initializeApp, cert, getApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { z } from "zod";
import { authStorage } from "./auth-storage";

const AUTH_BYPASS_ENABLED =
  process.env.AUTH_BYPASS === "true" ||
  (process.env.NODE_ENV !== "production" &&
    !process.env.FIREBASE_SERVICE_ACCOUNT_JSON &&
    !process.env.FIREBASE_PROJECT_ID);

let hasWarnedAuthBypass = false;
const warnAuthBypass = () => {
  if (hasWarnedAuthBypass) return;
  hasWarnedAuthBypass = true;
  console.warn(
    "[auth] AUTH_BYPASS is enabled. Requests are authenticated as a single mock user.",
  );
};

function getBypassClaims() {
  return {
    sub: process.env.AUTH_BYPASS_USER_ID ?? "dev-user",
    email: process.env.AUTH_BYPASS_EMAIL ?? "dev@example.com",
    first_name: process.env.AUTH_BYPASS_FIRST_NAME ?? "Dev",
    last_name: process.env.AUTH_BYPASS_LAST_NAME ?? "User",
    profile_image_url: process.env.AUTH_BYPASS_PROFILE_IMAGE_URL,
  };
}

function parseName(displayName?: string | null) {
  if (!displayName) {
    return { firstName: null, lastName: null };
  }
  const parts = displayName.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}

function getFirebaseCredentialsFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
    };
  }

  if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    return {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Railway env values usually encode newlines as literal \n.
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }

  throw new Error(
    "Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.",
  );
}

function getFirebaseAuth() {
  if (!getApps().length) {
    const credentials = getFirebaseCredentialsFromEnv();
    initializeApp({
      credential: cert({
        projectId: credentials.projectId,
        clientEmail: credentials.clientEmail,
        privateKey: credentials.privateKey,
      }),
    });
  }
  return getAuth(getApp());
}

async function upsertUserFromDecodedToken(decoded: DecodedIdToken) {
  const { firstName, lastName } = parseName(decoded.name);
  await authStorage.upsertUser({
    id: decoded.uid,
    email: decoded.email ?? null,
    firstName,
    lastName,
    profileImageUrl: decoded.picture ?? null,
  });
}

function claimsFromDecodedToken(decoded: DecodedIdToken) {
  const { firstName, lastName } = parseName(decoded.name);
  return {
    sub: decoded.uid,
    email: decoded.email ?? null,
    first_name: firstName,
    last_name: lastName,
    profile_image_url: decoded.picture ?? null,
  };
}

export async function setupAuth(_app: Express) {
  if (AUTH_BYPASS_ENABLED) {
    warnAuthBypass();
    return;
  }
  getFirebaseAuth();
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  if (AUTH_BYPASS_ENABLED) {
    warnAuthBypass();
    const claims = getBypassClaims();
    await authStorage.upsertUser({
      id: claims.sub,
      email: claims.email ?? null,
      firstName: claims.first_name ?? null,
      lastName: claims.last_name ?? null,
      profileImageUrl: claims.profile_image_url ?? null,
    });
    (req as any).user = {
      claims,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
    };
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const idToken = authHeader.slice(7);
  let decoded: DecodedIdToken;

  try {
    decoded = await getFirebaseAuth().verifyIdToken(idToken, true);
  } catch (err: any) {
    console.error("[auth] Token verification failed:", err);
    return res.status(401).json({ message: "Unauthorized", details: err?.message });
  }

  try {
    await upsertUserFromDecodedToken(decoded);
    (req as any).user = {
      claims: claimsFromDecodedToken(decoded),
      expires_at: decoded.exp,
    };
    return next();
  } catch (err: any) {
    console.error("[auth] DB upsert failed after token verification:", err);
    return res.status(500).json({ message: "Authentication profile sync failed", details: err?.message });
  }
};

export function registerAuthRoutes(app: Express): void {
  const updateProfileSchema = z.object({
    age: z.number().int().min(13).max(100).optional(),
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
  });

  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.put("/api/auth/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const parsed = updateProfileSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid profile payload" });
      }

      const updated = await authStorage.updateUserProfile(userId, parsed.data);
      if (!updated) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating user profile:", error);
      res.status(500).json({ message: "Failed to update user profile" });
    }
  });

  // Client-side logout is handled by Firebase Auth; this endpoint is a safe no-op.
  app.get("/api/logout", (_req, res) => {
    res.status(200).json({ success: true });
  });
}
