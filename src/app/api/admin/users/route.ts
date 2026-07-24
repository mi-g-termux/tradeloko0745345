// Multi-admin roles (feature #8). Owner/admin can list users and change roles.
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { getServiceClient } from "@/lib/supabase";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";
const VALID: Role[] = ["viewer", "trader", "admin", "owner"];

export async function GET() {
  try { await requireRole("admin"); }
  catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 403 }); }
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });
  const { data } = await db
    .from("app_users").select("id, wallet_address, telegram_username, display_name, role, created_at, last_login_at")
    .order("created_at", { ascending: true });
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(req: Request) {
  let actor;
  try { actor = await requireRole("admin"); }
  catch (err) { return NextResponse.json({ error: (err as Error).message }, { status: 403 }); }
  const db = getServiceClient();
  if (!db) return NextResponse.json({ error: "No database" }, { status: 500 });
  const b = await req.json().catch(() => ({}));
  const userId = String(b.userId ?? "");
  const role = String(b.role ?? "") as Role;
  if (!userId || !VALID.includes(role)) return NextResponse.json({ error: "userId and valid role required" }, { status: 400 });
  if ((role === "admin" || role === "owner") && actor.role !== "owner") {
    return NextResponse.json({ error: "Only an owner can grant admin/owner." }, { status: 403 });
  }
  await db.from("app_users").update({ role, is_admin: role === "admin" || role === "owner" }).eq("id", userId);
  return NextResponse.json({ ok: true });
}
