import { NextRequest, NextResponse } from "next/server";
import { getSourceCodeFromPath } from '@/utils/parseSourceCode';

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

export async function GET(req: NextRequest, { params }: { params: { compname: string } }) {
  const { compname } = await params;
  const component = await getSourceCodeFromPath(`docs/app/docs/components/${compname}/mcp.json`);
  const json = JSON.parse(component);
  const props = json.exports.api_documentation  

  return NextResponse.json({ props},{
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
}
