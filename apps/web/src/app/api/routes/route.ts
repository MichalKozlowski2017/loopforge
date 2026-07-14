import { NextResponse } from "next/server";

const HISTORY_DISABLED_MESSAGE =
  "Historia tras jest przechowywana lokalnie w tej przeglądarce.";

export async function GET() {
  return NextResponse.json({ error: HISTORY_DISABLED_MESSAGE }, { status: 403 });
}
