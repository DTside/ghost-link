'use client';

import { useState, useEffect } from 'react';
import { 
  Lock, Unlock, Download, FileText, AlertTriangle, Loader2, 
  Image as ImageIcon, Music, Video, Box, FileCode, File, EyeOff 
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { 
  deriveKeyFromPassword, 
  unwrapKey, 
  importKey, 
  decryptChunk, 
  decryptMetadata 
} from '@/lib/crypto';

interface DownloadViewProps {
  fileId: string;
}

const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith('image/')) return <ImageIcon className="w-12 h-12 text-purple-400" />;
  if (mimeType.startsWith('video/')) return <Video className="w-12 h-12 text-red-400" />;
  if (mimeType.startsWith('audio/')) return <Music className="w-12 h-12 text-yellow-400" />;
  if (mimeType.includes('pdf')) return <FileText className="w-12 h-12 text-red-500" />;
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return <Box className="w-12 h-12 text-orange-400" />;
  if (mimeType.includes('html') || mimeType.includes('json') || mimeType.includes('javascript')) return <FileCode className="w-12 h-12 text-green-400" />;
  return <File className="w-12 h-12 text-blue-400" />;
};

export default function DownloadView({ fileId }: DownloadViewProps) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'idle' | 'decrypting' | 'downloading' | 'error' | 'ready' | 'burned'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<any>(null);
  const [decryptedMeta, setDecryptedMeta] = useState<any>(null);
  const [isProtected, setIsProtected] = useState(false);
  const [fileKey, setFileKey] = useState<CryptoKey | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    fetchFileInfo();
  }, [fileId]);

  const fetchFileInfo = async () => {
    try {
      const { data, error } = await supabase
        .from('files')
        .select('*')
        .eq('id', fileId)
        .single();

      if (error || !data) throw new Error('Файл не найден или удален');

      // --- ПРОВЕРКА НА "СГОРАНИЕ" ---
      // Если лимит установлен И текущие скачивания >= лимита -> Файл сгорел
      if (data.max_downloads !== null && data.downloads_count >= data.max_downloads) {
        setStatus('burned');
        return;
      }

      setFileMeta(data);

      if (data.wrapped_key_data) {
        setIsProtected(true);
      } else {
        try {
            const hash = window.location.hash.substring(1);
            if (!hash) throw new Error('Нет ключа');
            const key = await importKey(hash);
            setFileKey(key);
            const meta = await decryptMetadata(data.encrypted_meta, key);
            setDecryptedMeta(meta);
            setStatus('ready');
        } catch (e) {
            console.error(e);
        }
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUnlock = async () => {
      try {
        if (!password) return;
        setLoading(true);
        
        const wrappedData = JSON.parse(fileMeta.wrapped_key_data);
        const salt = Uint8Array.from(atob(wrappedData.salt), c => c.charCodeAt(0));
        const wrappedKeyBuffer = Uint8Array.from(atob(wrappedData.wrappedKey), c => c.charCodeAt(0));

        const passwordKey = await deriveKeyFromPassword(password, salt);
        const key = await unwrapKey(wrappedKeyBuffer.buffer, passwordKey);
        
        setFileKey(key);
        const meta = await decryptMetadata(fileMeta.encrypted_meta, key);
        setDecryptedMeta(meta);
        setStatus('ready');
        setLoading(false);
        setIsProtected(false);
      } catch (e) {
          setLoading(false);
          alert('Неверный пароль');
      }
  };

  const handleDownload = async () => {
    try {
      if (!fileKey || !decryptedMeta) return;

      setLoading(true);
      setError(null);
      setStatus('downloading');

      // 1. Увеличиваем счетчик в БД
      await supabase.rpc('increment_downloads', { file_id: fileId });

      // 2. Скачиваем
      const { data: listData, error: listError } = await supabase.storage
        .from('ghost-files')
        .list(fileId);

      if (listError) throw listError;

      const chunks = listData.sort((a, b) => Number(a.name) - Number(b.name));
      const decryptedChunks: Blob[] = [];
      let downloadedSize = 0;

      for (const chunk of chunks) {
        const { data: chunkData, error: dlError } = await supabase.storage
          .from('ghost-files')
          .download(`${fileId}/${chunk.name}`);

        if (dlError) throw dlError;

        const buffer = await chunkData.arrayBuffer();
        const decryptedBuffer = await decryptChunk(buffer, fileKey);
        decryptedChunks.push(new Blob([decryptedBuffer]));
        
        downloadedSize += decryptedBuffer.byteLength;
        setProgress(Math.round((downloadedSize / decryptedMeta.size) * 100));
      }

      const finalBlob = new Blob(decryptedChunks, { type: decryptedMeta.type });
      const url = window.URL.createObjectURL(finalBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = decryptedMeta.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      // После скачивания, если это был одноразовый файл, меняем статус
      if (fileMeta.max_downloads === 1) {
        setStatus('burned');
      } else {
        setStatus('ready');
      }
      setLoading(false);

    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setError(err.message || 'Ошибка при скачивании');
      setLoading(false);
    }
  };

  // ЭКРАН: ФАЙЛ СГОРЕЛ
  if (status === 'burned') {
    return (
      <div className="flex flex-col items-center justify-center text-neutral-400 gap-4 animate-in fade-in zoom-in">
        <div className="bg-neutral-800 p-6 rounded-full border border-neutral-700">
            <EyeOff className="w-12 h-12 text-neutral-500" />
        </div>
        <h2 className="text-2xl font-bold text-white">Этот файл исчез</h2>
        <p className="max-w-xs text-center text-sm">
          У этого файла был лимит на 1 скачивание, и он уже был использован. 
          Данные физически уничтожены.
        </p>
        <a href="/" className="mt-4 text-blue-500 hover:text-blue-400 underline">Загрузить свой файл</a>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center text-red-400 gap-4 animate-in fade-in zoom-in">
        <div className="bg-red-900/20 p-6 rounded-full">
            <AlertTriangle className="w-12 h-12" />
        </div>
        <p className="text-xl font-bold">{error}</p>
        <a href="/" className="text-sm underline hover:text-white bg-neutral-800 px-4 py-2 rounded-lg">На главную</a>
      </div>
    );
  }

  if (!fileMeta) return <div className="flex justify-center items-center"><Loader2 className="animate-spin text-blue-500 w-10 h-10"/></div>;

  if (isProtected) {
      return (
        <div className="flex flex-col items-center gap-6 p-8 w-full max-w-md mx-auto text-center bg-neutral-900 border border-neutral-800 rounded-3xl shadow-2xl animate-in zoom-in-95">
            <div className="bg-yellow-900/20 p-5 rounded-full border border-yellow-500/30">
                <Lock className="w-10 h-10 text-yellow-500" />
            </div>
            <div>
                <h1 className="text-2xl font-bold text-white mb-2">Файл защищен</h1>
                <p className="text-gray-400 text-sm">Введите пароль для доступа</p>
            </div>
            <div className="w-full space-y-3">
                <input
                    type="password"
                    placeholder="Пароль"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full p-4 rounded-xl bg-black border border-neutral-700 text-white focus:border-yellow-500 outline-none text-center"
                />
                <button
                    onClick={handleUnlock}
                    disabled={loading}
                    className="w-full py-4 font-bold rounded-xl bg-yellow-600 hover:bg-yellow-500 text-black transition-all flex items-center justify-center gap-2"
                >
                    {loading ? <Loader2 className="animate-spin"/> : 'Открыть файл'}
                </button>
            </div>
        </div>
      )
  }

  return (
    <div className="flex flex-col items-center gap-6 p-8 w-full max-w-md mx-auto text-center bg-neutral-900 border border-neutral-800 rounded-3xl shadow-2xl animate-in fade-in slide-in-from-bottom-4">
      <div className="mb-2">
         {decryptedMeta ? getFileIcon(decryptedMeta.type) : <FileText className="w-16 h-16 text-blue-500" />}
      </div>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-white break-all">
          {decryptedMeta ? decryptedMeta.name : 'Файл зашифрован'}
        </h1>
        {decryptedMeta && (
            <p className="text-gray-400 text-sm">
                {(decryptedMeta.size / 1024 / 1024).toFixed(2)} MB
            </p>
        )}
      </div>

      <div className="w-full bg-neutral-800/50 p-6 rounded-2xl border border-neutral-700/50">
        {status === 'downloading' ? (
            <div className="space-y-4">
                <div className="flex items-center justify-center gap-2 text-blue-400">
                    <Loader2 className="animate-spin" />
                    <span className="font-mono">{progress}%</span>
                </div>
                <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all duration-200" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-xs text-gray-500">Расшифровка и сборка файла...</p>
            </div>
        ) : (
            <button
            onClick={handleDownload}
            className="w-full py-4 font-bold rounded-xl bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20 transition-all flex items-center justify-center gap-2 active:scale-95"
            >
            <Download className="w-5 h-5" />
            Скачать на диск
            </button>
        )}
      </div>

      <div className="flex items-center gap-2 text-neutral-600 text-xs">
        <FileText className="w-3 h-3" />
        <span>GhostLink Secure Transfer</span>
      </div>
    </div>
  );
}