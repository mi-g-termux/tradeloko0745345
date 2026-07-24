// POST /api/scan/now  — run the auto-scanner immediately (ADMIN ONLY).
// Lets an admin trigger a scan from the dashboard regardless of the schedule.
// Still respects the alert gates inside scanAndAlert().
import { NextResponse } from "next/server";
import { scanAndAlert } from "@/lib/analysis/scanner";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  try {
    const result = await scanAndAlert();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
