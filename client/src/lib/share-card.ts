import type { Session, StravaActivity } from "@shared/schema";

interface ShareCardOptions {
  session: Session;
  stravaActivity?: StravaActivity | null;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function formatSeconds(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export async function generateWorkoutShareCard({ session, stravaActivity }: ShareCardOptions): Promise<Blob> {
  const width = 1080;
  const height = 1350;
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas context unavailable");
  }

  ctx.scale(scale, scale);

  const bgGradient = ctx.createLinearGradient(0, 0, width, height);
  bgGradient.addColorStop(0, "#0f0c29");
  bgGradient.addColorStop(0.5, "#302b63");
  bgGradient.addColorStop(1, "#24243e");
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(width - 120, 120, 60, width - 120, 120, 300);
  glow.addColorStop(0, "rgba(65, 209, 255, 0.45)");
  glow.addColorStop(1, "rgba(65, 209, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  drawRoundedRect(ctx, 72, 92, width - 144, height - 184, 42);
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#41D1FF";
  ctx.font = "700 34px Inter, system-ui, sans-serif";
  ctx.fillText("PeakReady", 120, 160);

  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.fillText("COMPLETED SESSION", 120, 204);

  ctx.fillStyle = "white";
  ctx.font = "700 56px Inter, system-ui, sans-serif";
  ctx.fillText(session.description, 120, 300, width - 240);

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "500 26px Inter, system-ui, sans-serif";
  ctx.fillText(`${session.day}${session.scheduledDate ? ` • ${session.scheduledDate}` : ""}`, 120, 350);

  const rows: Array<{ label: string; value: string }> = [
    { label: "Duration", value: `${session.minutes} min` },
    { label: "RPE", value: session.rpe ? `${session.rpe}/10` : "n/a" },
  ];

  if (stravaActivity) {
    rows.push(
      { label: "Strava Distance", value: `${(stravaActivity.distance / 1000).toFixed(1)} km` },
      { label: "Strava Elevation", value: `${Math.round(stravaActivity.totalElevationGain || 0)} m` },
      {
        label: "Strava Time",
        value: formatSeconds(stravaActivity.movingTime || stravaActivity.elapsedTime || 0),
      },
    );
  }

  let y = 460;
  for (const row of rows) {
    drawRoundedRect(ctx, 120, y - 42, width - 240, 84, 20);
    ctx.fillStyle = "rgba(12,18,41,0.45)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = "700 20px Inter, system-ui, sans-serif";
    ctx.fillText(row.label.toUpperCase(), 150, y - 4);

    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.font = "700 28px Inter, system-ui, sans-serif";
    ctx.fillText(row.value, width - 410, y, 250);
    y += 108;
  }

  ctx.fillStyle = "rgba(255,255,255,0.66)";
  ctx.font = "500 20px Inter, system-ui, sans-serif";
  ctx.fillText("Built in PeakReady", 120, height - 120);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to generate image"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}
