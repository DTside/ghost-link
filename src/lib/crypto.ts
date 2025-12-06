// src/lib/crypto.ts

export const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

// 1. Генерация случайного ключа
export async function generateKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
}

// 2. Экспорт ключа
export async function exportKey(key: CryptoKey): Promise<string> {
  const exported = await window.crypto.subtle.exportKey("raw", key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 3. Импорт ключа
export async function importKey(str: string): Promise<CryptoKey> {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  
  return window.crypto.subtle.importKey(
    "raw", bytes, "AES-GCM", true, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
}

// 4. Шифрование метаданных
export async function encryptMetadata(data: object, key: CryptoKey): Promise<{ iv: string; data: string }> {
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return {
    iv: btoa(String.fromCharCode(...iv)),
    data: btoa(String.fromCharCode(...new Uint8Array(encrypted)))
  };
}

// 5. Дешифровка метаданных
export async function decryptMetadata(encryptedStr: string, key: CryptoKey): Promise<any> {
  const { iv: ivStr, data: dataStr } = JSON.parse(encryptedStr);
  const iv = new Uint8Array(atob(ivStr).split('').map(c => c.charCodeAt(0)));
  const data = new Uint8Array(atob(dataStr).split('').map(c => c.charCodeAt(0)));
  const decrypted = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

// 6. Шифрование чанка
export async function encryptChunk(chunk: ArrayBuffer, key: CryptoKey): Promise<Uint8Array> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, chunk);
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), iv.length);
  return result;
}

// 7. Дешифровка чанка
export async function decryptChunk(encryptedChunk: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
  const iv = encryptedChunk.slice(0, 12);
  const data = encryptedChunk.slice(12);
  // Используем as any, чтобы TS не ругался на типы
  return window.crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(iv) } as any, key, data);
}

// --- ЛОГИКА ПАРОЛЕЙ ---

// 8. Генерация ключа из пароля
export async function deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']
  );
  
  return window.crypto.subtle.deriveKey(
    // Используем as any для salt
    { name: 'PBKDF2', salt: salt as any, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['wrapKey', 'unwrapKey']
  );
}

// 9. Обернуть (зашифровать) ключ
export async function wrapKey(keyToWrap: CryptoKey, wrappingKey: CryptoKey): Promise<ArrayBuffer> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await window.crypto.subtle.wrapKey('raw', keyToWrap, wrappingKey, { name: 'AES-GCM', iv });
  
  const result = new Uint8Array(iv.length + wrapped.byteLength);
  // ИСПРАВЛЕНИЕ ЗДЕСЬ: добавляем as any для методов set
  result.set(iv as any, 0);
  result.set(new Uint8Array(wrapped) as any, iv.length);
  return result.buffer;
}

// 10. Развернуть (расшифровать) ключ
export async function unwrapKey(wrappedData: ArrayBuffer, unwrappingKey: CryptoKey): Promise<CryptoKey> {
  const iv = wrappedData.slice(0, 12);
  const data = wrappedData.slice(12);
  return window.crypto.subtle.unwrapKey(
    'raw', data, unwrappingKey, 
    // Используем as any для iv
    { name: 'AES-GCM', iv: new Uint8Array(iv) } as any, 
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  );
}