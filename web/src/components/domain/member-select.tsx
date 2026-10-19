'use client';

import { Select } from '@/components/ui/input';
import { useMembers } from '@/lib/hooks';

export function MemberSelect({ value, onChange, id, placeholder = 'Select a member', invalid, exclude = [] }: { value: string | undefined; onChange: (v: string) => void; id?: string; placeholder?: string; invalid?: boolean; exclude?: string[] }) {
  const { data } = useMembers('ACTIVE');
  return (
    <Select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid}>
      <option value="">{placeholder}</option>
      {data
        ?.filter((m) => !exclude.includes(m.membershipId))
        .map((m) => (
          <option key={m.membershipId} value={m.membershipId}>
            {m.fullName}
          </option>
        ))}
    </Select>
  );
}
