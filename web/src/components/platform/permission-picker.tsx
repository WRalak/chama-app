'use client';

import { ALL_PLATFORM_PERMISSIONS, PLATFORM_PERMISSION_INFO, type PlatformPermission } from '@chamahub/shared';

/** Grouped permission checkboxes. Permissions the viewer does not hold are shown but cannot be ticked (the API refuses them anyway). */
export function PermissionPicker({ value, onChange, held }: { value: PlatformPermission[]; onChange: (v: PlatformPermission[]) => void; held: readonly string[] }) {
  const areas = [...new Set(Object.values(PLATFORM_PERMISSION_INFO).map((i) => i.area))];
  return (
    <div className="space-y-3">
      {areas.map((area) => (
        <fieldset key={area}>
          <legend className="mb-1 text-xs font-semibold text-plum">{area}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {ALL_PLATFORM_PERMISSIONS.filter((p) => PLATFORM_PERMISSION_INFO[p].area === area).map((p) => {
              const can = held.includes(p);
              return (
                <label key={p} className={`flex items-start gap-2 text-sm ${can ? 'text-plum' : 'text-muted'}`} title={can ? undefined : 'You cannot grant a permission you do not hold'}>
                  <input type="checkbox" className="mt-0.5 accent-berry" disabled={!can} checked={value.includes(p)} onChange={(e) => onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))} />
                  {PLATFORM_PERMISSION_INFO[p].label}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
