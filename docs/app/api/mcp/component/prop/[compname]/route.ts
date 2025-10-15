import { NextRequest, NextResponse } from "next/server";
import { getSourceCodeFromPath } from '@/utils/parseSourceCode';

export async function GET(req: NextRequest, { params }: { params: { compname: string } }) {
  const { compname } = await params;
  const component = await getSourceCodeFromPath(`docs/app/docs/components/${compname}/mcp.json`);
  const json = JSON.parse(component);
  const props = json.exports.api_documentation  

  return NextResponse.json({ props});
}
