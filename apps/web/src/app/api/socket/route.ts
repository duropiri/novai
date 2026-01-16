import { NextRequest, NextResponse } from 'next/server';

// Proxy Socket.IO polling requests to the NestJS backend
const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace('/api', '') || 'http://localhost:3001';

async function proxyRequest(req: NextRequest) {
  const url = new URL(req.url);
  // Forward the query string to the backend Socket.IO endpoint
  const targetUrl = `${API_URL}/socket.io/${url.search}`;

  console.log('[Socket Proxy] Forwarding:', req.method, url.pathname + url.search, '->', targetUrl);

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    // Skip headers that shouldn't be forwarded
    if (!['host', 'connection'].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  let body: string | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      body = await req.text();
    } catch {
      // No body
    }
  }

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      // Skip headers that cause issues
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    // Enable CORS for Socket.IO
    responseHeaders.set('Access-Control-Allow-Origin', req.headers.get('origin') || '*');
    responseHeaders.set('Access-Control-Allow-Credentials', 'true');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Content-Type');

    const data = await response.arrayBuffer();

    console.log('[Socket Proxy] Response:', response.status, 'bytes:', data.byteLength);

    return new NextResponse(data, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[Socket Proxy] Error:', error);
    return NextResponse.json(
      { error: 'Failed to proxy request' },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest) {
  return proxyRequest(req);
}

export async function POST(req: NextRequest) {
  return proxyRequest(req);
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': req.headers.get('origin') || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
