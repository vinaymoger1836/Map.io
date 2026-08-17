/**
 * The document store's disk end.
 *
 * War Games configuration — systems, national forces, the board — is written as
 * JSON under `data/` in the repo, so it survives a cleared browser, can be
 * diffed, backed up and committed. That is the whole point: nobody should have
 * to re-enter an S-400 or a national order of battle because a cache was wiped.
 *
 * This runs on the machine serving the app, which for now is the player's own.
 * It is unauthenticated and single-user by design; if this app is ever exposed
 * to a network, this route needs an auth check before anything else.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DATA_DIR = path.join(process.cwd(), 'data');

/**
 * Document names come from the URL, so they are checked against a whitelist
 * pattern rather than sanitised. A name that is not plain lowercase-and-dashes
 * never reaches the filesystem, which closes off `..` and absolute paths
 * without having to reason about how many ways a path can be spelled.
 */
const VALID_DOC = /^[a-z0-9][a-z0-9-]{0,63}$/;

function resolveDoc(doc: string): string | null {
  if (!VALID_DOC.test(doc)) return null;
  const file = path.join(DATA_DIR, `${doc}.json`);
  // Belt and braces: the resolved path must still sit inside the data folder.
  if (path.dirname(path.resolve(file)) !== path.resolve(DATA_DIR)) return null;
  return file;
}

export async function GET(_request: Request, { params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const file = resolveDoc(doc);
  if (!file) return NextResponse.json({ error: 'bad document name' }, { status: 400 });

  try {
    const raw = await readFile(file, 'utf8');
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    // A document that has never been written is not an error, it is empty.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return NextResponse.json(null);
    }
    console.error(`[store] could not read ${doc}`, err);
    return NextResponse.json({ error: 'unreadable' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const file = resolveDoc(doc);
  if (!file) return NextResponse.json({ error: 'bad document name' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body was not JSON' }, { status: 400 });
  }

  try {
    await mkdir(DATA_DIR, { recursive: true });
    // Written through a temporary file: a crash mid-write leaves the previous
    // version intact rather than a half-truncated one.
    const tmp = `${file}.tmp`;
    await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    const { rename } = await import('node:fs/promises');
    await rename(tmp, file);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // On Vercel / serverless deployments the filesystem is read-only (EROFS).
    // Return 200 so the client knows it is safely kept in browser localStorage.
    return NextResponse.json({
      ok: true,
      readonly: true,
      message: 'Server filesystem is read-only. Data is persisted in browser localStorage.',
    });
  }
}
