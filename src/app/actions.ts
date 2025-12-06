'use server';

import { createClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';

// Инициализируем АДМИНСКИЙ клиент (Service Role), чтобы писать в базу без RLS
// ВНИМАНИЕ: Убедись, что переменная SUPABASE_SERVICE_ROLE_KEY есть в .env.local
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
    },
  }
);

const RATE_LIMIT = 5; // Максимум загрузок
const WINDOW_HOURS = 1; // За какое время (1 час)

export async function createFileAction(fileData: {
  encrypted_meta: string;
  wrapped_key_data: string | null;
  max_downloads: number | null;
  expires_at: string | null;
}) {
  const headersList = await headers();
  // Пытаемся получить IP. На Vercel это 'x-forwarded-for', на локалке может быть '::1'
  const ip = headersList.get('x-forwarded-for') || '127.0.0.1';
  
  // 1. ПРОВЕРКА RATE LIMIT
  const { data: limitData, error: limitError } = await supabaseAdmin
    .from('rate_limits')
    .select('*')
    .eq('ip', ip)
    .single();

  const now = new Date();
  
  if (limitData) {
    const lastReset = new Date(limitData.last_reset);
    const hoursDiff = (now.getTime() - lastReset.getTime()) / (1000 * 60 * 60);

    if (hoursDiff > WINDOW_HOURS) {
      // Время прошло, сбрасываем счетчик
      await supabaseAdmin.from('rate_limits').update({ count: 1, last_reset: now.toISOString() }).eq('ip', ip);
    } else {
      // Время не прошло, проверяем лимит
      if (limitData.count >= RATE_LIMIT) {
        throw new Error(`Лимит превышен! Подождите ${Math.ceil(60 - (hoursDiff * 60))} мин.`);
      }
      // Увеличиваем счетчик
      await supabaseAdmin.from('rate_limits').update({ count: limitData.count + 1 }).eq('ip', ip);
    }
  } else {
    // Новый IP
    await supabaseAdmin.from('rate_limits').insert({ ip, count: 1 });
  }

  // 2. СОЗДАНИЕ ФАЙЛА (если проверка пройдена)
  const { data: file, error: fileError } = await supabaseAdmin
    .from('files')
    .insert({
      encrypted_meta: fileData.encrypted_meta,
      wrapped_key_data: fileData.wrapped_key_data,
      max_downloads: fileData.max_downloads,
      expires_at: fileData.expires_at,
      storage_path: 'placeholder', // обновится после загрузки клиентом
    })
    .select()
    .single();

  if (fileError) throw new Error('Ошибка создания файла в БД');

  return { fileId: file.id };
}