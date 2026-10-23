import { FullScreenLoader } from '@/app/guards';
import { useSettings } from '@/lib/queries';
import { ReceiptStudio } from './studio';

/** Settings → Receipt opens the receipt editor full screen. */
export function ReceiptStudioPage() {
  const { data: settings } = useSettings();
  if (!settings) return <FullScreenLoader />;
  return <ReceiptStudio settings={settings} />;
}
