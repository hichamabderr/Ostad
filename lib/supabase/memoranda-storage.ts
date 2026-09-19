import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseBrowserClient } from './browser';
import type { Database } from './database.types';

const BUCKET = 'memoranda';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

type Client = SupabaseClient<Database>;

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

async function checksumForBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function currentClient(): Promise<{ client: Client; userId: string } | undefined> {
  const client = createSupabaseBrowserClient();
  if (!client) return undefined;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return undefined;
  return { client, userId: data.user.id };
}

export async function uploadTeacherMemorandum(unitId: string, file: File): Promise<{
  storagePath: string;
  checksum: string;
}> {
  const context = await currentClient();
  if (!context) throw new Error('لا توجد جلسة مستخدم صالحة لرفع الملف.');
  const checksum = await checksumForBlob(file);
  const storagePath = `users/${context.userId}/${unitId}/${safeFileName(file.name)}`;
  const upload = await context.client.storage.from(BUCKET).upload(storagePath, file, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (upload.error) throw upload.error;

  const metadata = await context.client.from('memoranda_files').upsert({
    owner_id: context.userId,
    unit_id: unitId,
    file_name: file.name,
    storage_path: storagePath,
    file_size: file.size,
    checksum,
    mime_type: 'application/pdf',
    is_bundled: false,
    revision: 1,
    deleted_at: null,
  }, { onConflict: 'storage_path' });
  if (metadata.error) throw metadata.error;
  return { storagePath, checksum };
}

export async function getMemorandumUrl(unitId: string): Promise<string | undefined> {
  const context = await currentClient();
  if (!context) return undefined;
  const metadata = await context.client
    .from('memoranda_files')
    .select('storage_path')
    .eq('unit_id', unitId)
    .is('deleted_at', null)
    .or(`is_bundled.eq.true,owner_id.eq.${context.userId}`)
    .order('is_bundled', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (metadata.error || !metadata.data) return undefined;
  const signed = await context.client.storage
    .from(BUCKET)
    .createSignedUrl(metadata.data.storage_path, SIGNED_URL_TTL_SECONDS);
  return signed.error ? undefined : signed.data.signedUrl;
}

export async function deleteTeacherMemorandum(storagePath: string): Promise<void> {
  const context = await currentClient();
  if (!context) return;
  const removed = await context.client.storage.from(BUCKET).remove([storagePath]);
  if (removed.error) throw removed.error;
  const metadata = await context.client
    .from('memoranda_files')
    .delete()
    .eq('storage_path', storagePath)
    .eq('owner_id', context.userId);
  if (metadata.error) throw metadata.error;
}
