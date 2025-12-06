import UploadZone from '@/components/UploadZone';

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
      <div className="text-center mb-12">
        <h1 className="text-6xl font-black tracking-tighter bg-gradient-to-r from-blue-400 to-purple-600 text-transparent bg-clip-text mb-4">
          GhostLink
        </h1>
        <p className="text-neutral-400 text-lg max-w-md mx-auto">
          Шифрование на стороне клиента. <br/>
          Мы не видим ваши файлы. Они исчезают после скачивания.
        </p>
      </div>
      
      <UploadZone />
      
      <footer className="mt-20 text-neutral-600 text-sm">
        Secure Zero-Knowledge File Transfer
      </footer>
    </main>
  );
}