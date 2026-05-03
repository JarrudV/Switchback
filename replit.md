# Overview

This is a **cycling/fitness training tracker** application ("PeakReady") built as a full-stack TypeScript project. It helps users follow a structured training plan leading up to a goal event (like a cycling race or mountain ride). The app tracks weekly training sessions, body metrics (weight, resting HR, fatigue), bike service/maintenance items, goal event countdown, and **Strava ride data**. It features a dark space-themed dashboard with glassmorphism panels, neon gradients, and a mobile-friendly tab-based navigation. Includes a conversational **AI Coach** ("Peak") and AI-powered plan generation via Google Gemini.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend

- **Framework**: React 18 with TypeScript (non-RSC, client-side only)
- **Build tool**: Vite with `@vitejs/plugin-react`
- **UI components**: shadcn/ui (new-york style) built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (dark mode by default, custom color palette with cyan primary and purple accent). Theme mode (dark/light) and accent color are persisted server-side via app_settings.
- **State management**: TanStack React Query for server state; local React state for UI
- **Charts**: Recharts for data visualization (weight trends, etc.)
- **Navigation**: Tab-based SPA (no router library) with 5 tabs: Dashboard, Plan, Coach, Stats, More (Events, Bike, Strava sub-views)
- **Path aliases**: `@/` maps to `client/src/`, `@shared/` maps to `shared/`

## Backend

- **Runtime**: Node.js with Express 5
- **Language**: TypeScript, executed via `tsx` in development
- **API pattern**: RESTful JSON API under `/api/` prefix
- **Key endpoints**:
  - `GET/PATCH /api/sessions` — training sessions
  - `GET/POST /api/metrics` — body/fitness metrics
  - `GET/POST/PATCH /api/service-items` — bike maintenance tracking
  - `GET/POST/PUT /api/goal` — goal event management
  - `GET/PUT /api/settings/:key` — app settings (like active week, theme)
  - `GET/POST /api/notifications` — in-app notifications
  - `GET/PUT /api/reminder-settings` — push reminder configuration
  - `POST /api/push/subscribe` — push subscription registration
  - `GET/POST /api/coach/chat` — AI coach conversation
  - `GET /api/insights/latest-ride` — latest Strava ride insights
- **Dev server**: Vite dev server middleware served through Express (HMR via WebSocket)
- **Production**: Vite builds static files to `dist/public`, esbuild bundles server to `dist/index.cjs`
- **Schema guard**: `server/schema-guard.ts` — verifies required tables/columns exist at startup and throws if migrations are out of date

## Authentication

- **Mechanism**: Firebase Auth (Google sign-in + email/password). Firebase ID tokens sent as `Authorization: Bearer <token>` on every API request.
- **Server verification**: `server/auth.ts` — verifies Firebase ID tokens via `firebase-admin` SDK. Requires `FIREBASE_SERVICE_ACCOUNT_KEY` env var in production.
- **Dev bypass**: When `AUTH_BYPASS=true` env var is set (or Firebase admin env vars are missing), all requests are authenticated as a single mock dev user (`dev-user`). Set automatically in the Replit dev environment.
- **Client SDK**: `client/src/lib/firebase.ts` — initializes Firebase client SDK only when `VITE_FIREBASE_*` env vars are present. Gracefully stubs out when not configured (dev bypass mode).
- **Auth hook**: `client/src/hooks/use-auth.ts` — wraps Firebase `onAuthStateChanged` and `/api/auth/user` query. Falls back to direct API call (no token) when Firebase not configured.
- **User storage**: `server/auth-storage.ts` — stores user profiles in `users` table, upserts on every verified token.
- **Login page**: `client/src/pages/login.tsx` — Google sign-in and email/password form using Firebase Auth.

## Data Layer

- **Database**: PostgreSQL (required, connection via `DATABASE_URL` env var)
- **ORM**: Drizzle ORM with `drizzle-zod` for schema validation
- **Schema location**: `shared/schema.ts` (shared between client and server)
- **Migration tool**: `drizzle-kit push` (push-based schema sync) + raw SQL migration files in `migrations/`
- **Tables**:
  - `sessions` — training sessions with week number, type, description, minutes, zone, completion status, RPE, scheduled/completed dates, Strava link fields, coach adjustment fields
  - `metrics` — daily body metrics (weight, resting HR, ride minutes, long ride km, fatigue, notes). Unique per (userId, date).
  - `service_items` — bike maintenance items with status tracking (Planned/Done), optional due date
  - `goal_events` — goal event with name, date, distance, elevation, location
  - `strava_activities` — synced Strava ride data (distance, time, elevation, HR, power, etc.)
  - `app_settings` — key-value settings store (theme, active week, subscription tier, Strava tokens, etc.)
  - `push_subscriptions` — Web Push subscription endpoints per user
  - `reminder_settings` — per-user push notification reminder preferences
  - `in_app_notifications` — in-app notification inbox items
  - `notification_dispatches` — deduplication log for sent notifications
  - `coach_adjustment_proposals` — AI coach session adjustment proposals (pending/applied/cancelled/expired)
  - `coach_adjustment_events` — audit log of applied coach adjustments
  - `coach_adjustment_event_items` — per-session detail of each coach adjustment
  - `strava_session_links` — matched pairs of Strava activities and training sessions
  - `ride_insights` — AI-generated ride analysis and coaching insights
  - `plan_realign_events` — audit log of training plan date shifts
  - `users` — user profiles (id, email, firstName, lastName, profileImageUrl, age)
  - `auth_sessions` — Express session store (connect-pg-simple)
- **Storage pattern**: `IStorage` interface in `server/storage.ts` with `DatabaseStorage` implementation using Drizzle. Per-user data isolation via `userId` on all tables. Legacy data tagged `__legacy__` is automatically claimed by the first authenticated user.

## Build System

- **Dev**: `tsx --env-file=.env.local server/index.ts` runs the full-stack dev server
- **Build**: Custom `script/build.ts` that runs Vite build for client and esbuild for server
- **Server bundling**: Allowlisted dependencies bundled into server build; others externalized
- **Railway**: `railway.toml` + `script/start-railway.mjs` for Railway.app deployment

## Key Design Decisions

1. **Shared schema**: `shared/` contains Drizzle table definitions and Zod schemas used by both client and server
2. **No client-side router**: Tab-based SPA state management, all views in `client/src/pages/`
3. **Dark-first theme**: CSS variables in `index.css` define the dark color scheme; light mode toggled via `.light` class
4. **Multi-user isolation**: All tables have `userId` column. Data seeded with `__legacy__` default; claimed by the first real user via `claimLegacyRowsForUser()` in storage.
5. **Strava integration**: OAuth flow with token refresh. Syncs ride activities. Service in `server/strava.ts`, panel UI in `client/src/components/strava-panel.tsx`. Activities are matched to training sessions via confidence scoring.
6. **Workout library**: 17 detailed workout templates with markdown instructions in `server/workout-library.ts`
7. **AI Plan Builder**: Google Gemini for personalized plan generation. 3-step form in `client/src/components/ai-plan-builder.tsx`, generator in `server/ai-plan-generator.ts`
8. **AI Coach**: Conversational coach ("Peak") using Gemini. Can propose session adjustments. Coach page at `client/src/pages/coach.tsx`
9. **Push Notifications**: Web Push via `web-push`. Service worker at `client/public/sw.js`. Reminders via `node-cron` in `server/reminders.ts`
10. **Ride Analysis**: AI-powered analysis of Strava rides in `server/ride-analysis.ts`, generating insights stored in `ride_insights` table
11. **Auth bypass**: Dev environment uses `AUTH_BYPASS=true` (auto-detected when Firebase admin creds missing). Single mock user with all data.
12. **New rider onboarding**: First-time flow shown when `onboardingSeenV1` setting is null

# External Dependencies

- **PostgreSQL**: Required database, connected via `DATABASE_URL`. Uses `pg` driver with connection pooling via `connect-pg-simple`
- **firebase**: Client-side Firebase SDK for Google/email auth
- **firebase-admin**: Server-side Firebase token verification (production only)
- **web-push**: Web Push notification delivery (requires VAPID keys in production)
- **node-cron**: Scheduled reminder jobs
- **luxon**: Date/time utilities for reminder scheduling
- **Google Fonts**: DM Sans, Fira Code, Geist Mono, Architects Daughter loaded via Google Fonts CDN
- **Recharts**: Client-side charting for metrics visualization
- **date-fns**: Date manipulation utilities
- **@google/genai**: Google Gemini AI SDK for AI coach and plan generation
- **Replit plugins** (dev only): `@replit/vite-plugin-runtime-error-modal`, cartographer, dev-banner
