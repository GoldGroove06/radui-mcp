import { NextRequest, NextResponse } from "next/server";
import docsNavigationSections from '@/app/docs/docsNavigationSections';

export async function GET(req: NextRequest ) {
  const list = []
  for (const item of docsNavigationSections[2].items) {
    list.push(item.title)
  }

  return NextResponse.json({ list });
}
