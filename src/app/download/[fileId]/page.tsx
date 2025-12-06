import DownloadView from '@/components/DownloadView';

type Props = {
  params: Promise<{ fileId: string }>;
};

export default async function DownloadPage({ params }: Props) {
  // !!! ВОТ ГЛАВНОЕ ИСПРАВЛЕНИЕ !!!
  // Мы ждем (await), пока параметры загрузятся
  const { fileId } = await params;
  
  return (
    <main className="min-h-screen bg-black flex items-center justify-center p-4">
      {/* Передаем уже полученный fileId */}
      <DownloadView fileId={fileId} />
    </main>
  );
}