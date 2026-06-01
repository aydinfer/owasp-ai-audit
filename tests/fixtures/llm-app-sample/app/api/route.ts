import { getServerSession } from 'next-auth';

// Next.js App Router handler: an api-route + auth + external egress + log sink.
// Exercises L3 (authz), L4 (server input / provider boundary / log sink) and
// L7 (logging) surface kinds.
export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session) return new Response('unauthorized', { status: 401 });

  const body = await req.json();
  const res = await fetch('https://api.example.com/ingest', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error('ingest failed', res.status);
  return Response.json({ ok: true });
}
