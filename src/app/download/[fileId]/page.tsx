import DownloadView from '@/components/DownloadView';

type Props = {
  params: Promise<{ fileId: string }>;
};

export default async function DownloadPage({ params }: Props) {
  // Получаем параметры (Next.js 15)
  const resolvedParams = await params;
  
  // Рендерим ТОЛЬКО красивый компонент, без лишнего текста
  return (
    <main className="min-h-screen bg-black flex items-center justify-center p-4">
      <DownloadView fileId={resolvedParams.fileId} />
    </main>
  );
}