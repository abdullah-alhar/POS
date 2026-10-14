import { useRef, useState } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { imageFileToDataUrl } from '@/lib/image';
import { cn } from '@/lib/utils';

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Profile photo, or the person's initials on a brand-tinted circle. */
export function UserAvatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'bg-brand/12 text-brand inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-semibold select-none',
        className,
      )}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  );
}

/** Pick, preview and remove a profile photo. The picture is cropped square and shrunk to 256 px. */
export function AvatarPicker({
  name,
  value,
  onChange,
  busy,
}: {
  name: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  busy?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  async function pick(file: File) {
    setReading(true);
    try {
      onChange(
        await imageFileToDataUrl(file, {
          maxSize: 256,
          type: 'image/jpeg',
          quality: 0.86,
          square: true,
        }),
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="group relative rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        aria-label="Choose a photo"
      >
        <UserAvatar name={name || '?'} src={value} className="size-20 text-xl" />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
          {reading || busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <Camera className="size-5" />
          )}
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void pick(file);
          e.target.value = '';
        }}
      />
      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Camera /> {value ? 'Change photo' : 'Add photo'}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
            disabled={busy}
          >
            <Trash2 /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
