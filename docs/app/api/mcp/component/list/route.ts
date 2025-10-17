import { NextRequest, NextResponse } from "next/server";
import docsNavigationSections from '@/app/docs/docsNavigationSections';

export async function OPTIONS() {
  return NextResponse.json({}, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export async function GET(req: NextRequest ) {
  const list = []
  for (const item of docsNavigationSections[2].items) {
    list.push(item.title)
  }

  return NextResponse.json({ list },{
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
}
