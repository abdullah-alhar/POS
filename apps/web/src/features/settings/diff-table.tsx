import { SECTION_LABELS, type SettingDiffRow } from '@shoppos/shared';
import { ChangeList } from '../receipt-studio/change-list';

/** Settings side by side: what they were and what they would become. */
export function DiffTable({
  rows,
  beforeLabel = 'Now',
  afterLabel = 'New',
  showSection,
}: {
  rows: SettingDiffRow[];
  beforeLabel?: string;
  afterLabel?: string;
  showSection?: boolean;
}) {
  if (!rows.length)
    return <p className="text-muted-foreground py-3 text-center text-sm">No differences.</p>;
  return (
    <div className="max-h-[55vh] overflow-y-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-muted-foreground sticky top-0 text-left text-xs">
          <tr>
            <th className="px-3 py-2 font-medium">Setting</th>
            <th className="px-3 py-2 font-medium">{beforeLabel}</th>
            <th className="px-3 py-2 font-medium">{afterLabel}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.path} className="align-top">
              <td className="px-3 py-2">
                <span className="font-medium">{r.label}</span>
                {showSection && (
                  <span className="text-muted-foreground block text-xs">
                    {SECTION_LABELS[r.section]}
                  </span>
                )}
              </td>
              {r.layoutChanges ? (
                <td colSpan={2} className="px-3 py-2">
                  <ChangeList
                    changes={r.layoutChanges}
                    fromLabel={beforeLabel.toLowerCase()}
                    toLabel={afterLabel.toLowerCase()}
                  />
                </td>
              ) : (
                <>
                  <td className="text-muted-foreground px-3 py-2 break-words">{r.before}</td>
                  <td className="px-3 py-2 font-medium break-words">{r.after}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
