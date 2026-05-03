import { spawn } from "node:child_process";

function runCommand(command, args, env = process.env) {
  const executable =
    process.platform === "win32" && command === "npm" ? "npm.cmd" : command;

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: "inherit",
      env,
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${executable} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function validateRuntimeEnv() {
  const missing = [];
  if (!process.env.DATABASE_URL) {
    missing.push("DATABASE_URL");
  }

  if (process.env.AUTH_BYPASS !== "true") {
    const hasFirebaseAdminJson = !!process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const hasFirebaseAdminParts =
      !!process.env.FIREBASE_PROJECT_ID &&
      !!process.env.FIREBASE_CLIENT_EMAIL &&
      !!process.env.FIREBASE_PRIVATE_KEY;

    if (!hasFirebaseAdminJson && !hasFirebaseAdminParts) {
      missing.push(
        "Firebase Admin credentials (set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY)"
      );
    }

    const firebaseClientVars = [
      "VITE_FIREBASE_API_KEY",
      "VITE_FIREBASE_AUTH_DOMAIN",
      "VITE_FIREBASE_PROJECT_ID",
      "VITE_FIREBASE_APP_ID",
    ];
    for (const key of firebaseClientVars) {
      if (!process.env[key]) {
        missing.push(key);
      }
    }
  }

  if (missing.length === 0) {
    return;
  }

  console.error("[deploy] Missing required environment variables:");
  for (const key of missing) {
    console.error(`[deploy] - ${key}`);
  }
  process.exit(1);
}

async function main() {
  validateRuntimeEnv();

  const skipMigrations = process.env.SKIP_DB_PUSH_ON_START === "true";
  if (!process.env.DATABASE_URL) {
    console.error("[deploy] DATABASE_URL is required before startup.");
    process.exit(1);
  }

  if (skipMigrations) {
    console.warn("[deploy] WARNING: skipping migrations because SKIP_DB_PUSH_ON_START=true.");
  } else {
    console.log("[deploy] Running migrations (drizzle-kit push)...");
    await runCommand("npm", ["run", "db:push"]);
    console.log("[deploy] Migrations completed.");
  }

  console.log("[deploy] Starting application...");
  await runCommand("node", ["dist/index.cjs"], {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "production",
  });
}

main().catch((error) => {
  console.error("[deploy] Startup failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
