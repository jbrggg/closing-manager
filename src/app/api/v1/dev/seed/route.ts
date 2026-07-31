import { NextResponse } from "next/server";
import { seedDatabase } from "@/lib/seed";
import { requireApiSession } from "@/lib/auth/guard";

export async function POST() {
  const auth = await requireApiSession("MANAGE_DEMO_DATA");
  if (auth.failed) return auth.response;

  await seedDatabase();
  return NextResponse.json({ ok: true });
}
