import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}

const client = createClient(supabaseUrl, serviceRoleKey);
const root = path.resolve(process.cwd(), 'public/memoranda');

async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  }));
  return files.flat().filter(file => file.toLowerCase().endsWith('.pdf'));
}

for (const filePath of await walk(root)) {
  const bytes = await readFile(filePath);
  const relative = path.relative(root, filePath).split(path.sep).join('/');
  const unitId = path.basename(relative, '.pdf');
  const storagePath = `bundled/${relative}`;
  const upload = await client.storage.from('memoranda').upload(storagePath, bytes, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (upload.error) throw upload.error;

  const metadata = await client.from('memoranda_files').upsert({
    owner_id: null,
    unit_id: unitId,
    file_name: path.basename(filePath),
    storage_path: storagePath,
    file_size: bytes.byteLength,
    checksum: await checksum(bytes),
    mime_type: 'application/pdf',
    is_bundled: true,
  }, { onConflict: 'storage_path' });
  if (metadata.error) throw metadata.error;
  console.log(`Seeded ${relative}`);
}
