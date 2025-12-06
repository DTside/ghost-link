'use client';

import { useState, useCallback } from 'react';
import { UploadCloud, CheckCircle, AlertCircle, Loader2, Lock, Unlock, Key, Clock, Zap } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react'; 
import { supabase } from '@/lib/supabase';
import { generateKey, exportKey, encryptChunk, encryptMetadata, deriveKeyFromPassword, wrapKey, CHUNK_SIZE } from '@/lib/crypto';
// Импортируем наш Server Action для проверки лимитов
import { createFileAction } from '@/app/actions';

export default function UploadZone() {
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<'idle' | 'encrypting' | 'uploading' | 'completed' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [fileLink, setFileLink] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  
  // --- НАСТРОЙКИ ---
  const [isPasswordProtected, setIsPasswordProtected] = useState(false);
  const [password, setPassword] = useState('');
  const [lifespanMode, setLifespanMode] = useState<'burn' | 'day'>('burn');

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const onDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files?.[0]) startUploadProcess(e.dataTransfer.files[0]);
  }, [isPasswordProtected, password, lifespanMode]);

  const startUploadProcess = async (file: File) => {
    try {
      if (isPasswordProtected && !password) {
        alert('Пожалуйста, введите пароль для защиты файла');
        return;
      }
      setStatus('encrypting');
      setProgress(0);

      // 1. Криптография (Клиентская сторона)
      const key = await generateKey();
      const keyString = await exportKey(key);
      let wrappedKeyDataString = null;

      if (isPasswordProtected && password) {
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        const derivedKey = await deriveKeyFromPassword(password, salt);
        const wrappedKeyBuffer = await wrapKey(key, derivedKey);
        wrappedKeyDataString = JSON.stringify({
          salt: btoa(String.fromCharCode(...salt)),
          wrappedKey: btoa(String.fromCharCode(...new Uint8Array(wrappedKeyBuffer)))
        });
      }

      const { iv: metaIv, data: metaData } = await encryptMetadata({
        name: file.name, type: file.type, size: file.size
      }, key);

      // 2. Логика TTL (Время жизни)
      let maxDownloads = null;
      let expiresAt = null;

      if (lifespanMode === 'burn') {
        maxDownloads = 1;
        const date = new Date();
        date.setDate(date.getDate() + 3); // Удалить через 3 дня если не скачали
        expiresAt = date.toISOString();
      } else {
        maxDownloads = 100;
        const date = new Date();
        date.setDate(date.getDate() + 1); // 24 часа
        expiresAt = date.toISOString();
      }

      // 3. СОЗДАНИЕ ЗАПИСИ ЧЕРЕЗ SERVER ACTION (Rate Limiting)
      // Вместо прямого supabase.insert мы вызываем серверную функцию
      let fileId: string;
      
      try {
        const result = await createFileAction({
          encrypted_meta: JSON.stringify({ iv: metaIv, data: metaData }),
          wrapped_key_data: wrappedKeyDataString,
          max_downloads: maxDownloads,
          expires_at: expiresAt
        });
        fileId = result.fileId;
      } catch (serverError: any) {
        // Если лимит превышен, сервер выбросит ошибку, мы её ловим тут
        throw new Error(serverError.message || 'Ошибка сервера при создании файла');
      }

      // 4. Загрузка чанками (Direct Upload в Storage)
      setStatus('uploading');
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      let uploadedBytes = 0;

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(start, end);
        const chunkBuffer = await chunkBlob.arrayBuffer();
        const encryptedChunk = await encryptChunk(chunkBuffer, key);

        const { error: uploadError } = await supabase.storage
          .from('ghost-files')
          .upload(`${fileId}/${i}`, encryptedChunk, { upsert: true });

        if (uploadError) throw uploadError;
        uploadedBytes += chunkBlob.size;
        setProgress(Math.round((uploadedBytes / file.size) * 100));
      }

      // 5. Финализация (обновляем путь)
      await supabase.from('files').update({ storage_path: `${fileId}/` }).eq('id', fileId);

      const finalLink = `${window.location.origin}/download/${fileId}${!isPasswordProtected ? `#${keyString}` : ''}`;
      setFileLink(finalLink);
      setStatus('completed');

    } catch (err: any) {
      console.error(err);
      setStatus('error');
      // Показываем сообщение об ошибке (например "Лимит превышен")
      setErrorMsg(err.message || 'Ошибка загрузки');
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6">
      <div 
        className={`relative border-2 border-dashed rounded-3xl p-12 text-center transition-all duration-300 ease-in-out
          ${isDragging ? 'border-blue-500 bg-blue-900/20 scale-[1.02]' : 'border-neutral-800 bg-neutral-900/50'}
          ${status === 'error' ? 'border-red-500/50 bg-red-900/10' : ''}
          hover:border-neutral-600
        `}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        
        {status === 'idle' && (
          <div className="flex flex-col items-center gap-6">
            <div className="p-5 bg-neutral-800 rounded-full mb-2">
              <UploadCloud className="w-10 h-10 text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white mb-2">Перетащите файл сюда</p>
              <p className="text-neutral-500">или кликните для выбора (до 1 ГБ)</p>
            </div>
            
            <input type="file" className="absolute inset-0 opacity-0 cursor-pointer z-10" onChange={(e) => e.target.files?.[0] && startUploadProcess(e.target.files[0])} />
            
            <div className="relative z-20 w-full max-w-md space-y-3 mt-4">
              {/* Выбор режима жизни */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-black/40 border border-neutral-800 rounded-xl">
                <button onClick={() => setLifespanMode('burn')} className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${lifespanMode === 'burn' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'text-neutral-500 hover:text-neutral-300'}`}>
                  <Zap size={16} /> 1 Скачивание
                </button>
                <button onClick={() => setLifespanMode('day')} className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${lifespanMode === 'day' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'text-neutral-500 hover:text-neutral-300'}`}>
                  <Clock size={16} /> 24 Часа
                </button>
              </div>

              {/* Настройка пароля */}
              <div className="bg-black/40 border border-neutral-800 rounded-xl overflow-hidden transition-all">
                <div onClick={() => setIsPasswordProtected(!isPasswordProtected)} className="flex items-center justify-between p-3 cursor-pointer hover:bg-neutral-800/50">
                  <div className="flex items-center gap-3">
                    {isPasswordProtected ? <Lock className="text-yellow-500 w-4 h-4"/> : <Unlock className="text-neutral-600 w-4 h-4"/>}
                    <span className={`text-sm font-medium ${isPasswordProtected ? 'text-white' : 'text-neutral-400'}`}>Защита паролем</span>
                  </div>
                  <div className={`w-8 h-4 rounded-full relative transition-colors ${isPasswordProtected ? 'bg-yellow-600' : 'bg-neutral-700'}`}>
                     <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${isPasswordProtected ? 'translate-x-4' : ''}`} />
                  </div>
                </div>
                <div className={`overflow-hidden transition-all duration-300 ${isPasswordProtected ? 'max-h-20 opacity-100' : 'max-h-0 opacity-0'}`}>
                   <div className="p-3 pt-0 relative">
                      <Key className="absolute left-3 top-2.5 w-4 h-4 text-neutral-500" />
                      <input type="password" placeholder="Секретный код" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-neutral-900 border border-neutral-700 rounded-lg py-2 pl-9 pr-4 text-white text-sm focus:border-yellow-500 outline-none" />
                   </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {(status === 'encrypting' || status === 'uploading') && (
          <div className="flex flex-col items-center gap-6 py-8">
            <Loader2 className="w-16 h-16 animate-spin text-blue-500" />
            <div className="w-full max-w-xs space-y-2">
               <div className="flex justify-between text-xs text-neutral-400 font-mono uppercase">
                  <span>{status === 'encrypting' ? 'Шифрование' : 'Загрузка'}</span>
                  <span>{progress}%</span>
               </div>
               <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                 <div className="h-full bg-blue-500 transition-all duration-300 shadow-[0_0_10px_rgba(59,130,246,0.5)]" style={{ width: `${progress}%` }} />
               </div>
            </div>
          </div>
        )}

        {status === 'completed' && (
          <div className="flex flex-col items-center gap-6 animate-in fade-in zoom-in duration-300 py-4">
            <CheckCircle className="w-20 h-20 text-green-500" />
            <h3 className="text-2xl font-bold text-white">Ссылка готова!</h3>
            
            <div className="w-full bg-neutral-950 p-4 rounded-xl border border-neutral-800 flex items-center gap-2">
               <p className="text-blue-400 font-mono text-sm truncate flex-1">{fileLink}</p>
               <button onClick={() => navigator.clipboard.writeText(fileLink)} className="bg-neutral-800 hover:bg-neutral-700 text-white px-3 py-1.5 rounded text-xs font-bold">Copy</button>
            </div>
            
            <div className="bg-white p-4 rounded-xl shadow-lg">
              <QRCodeSVG value={fileLink} size={140} />
            </div>

            <button onClick={() => { setStatus('idle'); setFileLink(''); setPassword(''); setIsPasswordProtected(false); }} className="text-neutral-500 hover:text-white text-sm hover:underline mt-2">
              Отправить еще один
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <AlertCircle className="w-16 h-16 text-red-500" />
            <p className="text-red-400 font-medium">{errorMsg}</p>
            <button onClick={() => setStatus('idle')} className="bg-neutral-800 px-6 py-2 rounded-lg text-white">Попробовать снова</button>
          </div>
        )}
      </div>
    </div>
  );
}