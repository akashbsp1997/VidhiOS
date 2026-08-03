// app/api/legal/forums/route.js
// GET -> the full forum/court catalog (reference data, not per-user).
import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { legalForums } from "../../../../db/schema.js";
import { getSessionUserId } from "../../../../lib/supabase/server.js";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const rows = await db.select().from(legalForums).orderBy(asc(legalForums.name));
    return NextResponse.json({ forums: rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
