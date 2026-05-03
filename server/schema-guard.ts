import { sql } from "drizzle-orm";
import { db } from "./db";

const REQUIRED_TABLES = [
  "coach_adjustment_proposals",
  "coach_adjustment_events",
  "coach_adjustment_event_items",
  "strava_session_links",
  "ride_insights",
  "plan_realign_events",
] as const;

const REQUIRED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: "sessions", column: "adjusted_by_coach" },
  { table: "sessions", column: "adjusted_by_coach_at" },
  { table: "sessions", column: "last_coach_adjustment_event_id" },
  { table: "sessions", column: "completed_strava_activity_id" },
  { table: "sessions", column: "completion_match_score" },
];

async function tableExists(tableName: string): Promise<boolean> {
  const result = await db.execute(sql`
    select exists(
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = ${tableName}
    ) as exists
  `);
  const row = (result as any).rows?.[0];
  return row?.exists === true;
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const result = await db.execute(sql`
    select exists(
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = ${tableName}
        and column_name = ${columnName}
    ) as exists
  `);
  const row = (result as any).rows?.[0];
  return row?.exists === true;
}

export async function verifySchemaOrThrow(): Promise<void> {
  const missingTables: string[] = [];
  const missingColumns: Array<{ table: string; column: string }> = [];

  for (const table of REQUIRED_TABLES) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await tableExists(table);
    if (!exists) {
      missingTables.push(table);
    }
  }

  for (const item of REQUIRED_COLUMNS) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await columnExists(item.table, item.column);
    if (!exists) {
      missingColumns.push(item);
    }
  }

  if (missingTables.length === 0 && missingColumns.length === 0) {
    return;
  }

  const tablePart =
    missingTables.length > 0
      ? `missing tables: ${missingTables.join(", ")}`
      : "";
  const columnPart =
    missingColumns.length > 0
      ? `missing columns: ${missingColumns.map((item) => `${item.table}.${item.column}`).join(", ")}`
      : "";
  const detail = [tablePart, columnPart].filter(Boolean).join("; ");

  throw new Error(
    `[schema-check] Database schema is out of date (${detail}). Run migrations before starting the app.`,
  );
}
