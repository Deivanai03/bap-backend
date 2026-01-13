import { NextResponse } from 'next/server';
import { specs } from '../../../../lib/swagger.js';

export async function GET() {
  return NextResponse.json(specs);
}
