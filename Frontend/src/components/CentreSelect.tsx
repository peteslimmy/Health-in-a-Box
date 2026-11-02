import { useUser } from '../auth/AuthContext';
import { centreLabel } from '../lib/format';
import { Select } from './ui';

/** Lists only the centres the signed-in user is assigned to (the API enforces this too). */
export function CentreSelect({
  value,
  onChange,
  allowAll = false,
  id,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  allowAll?: boolean;
  id?: string;
  required?: boolean;
}) {
  const user = useUser();
  const centres = user.centres ?? [];
  return (
    <Select id={id} value={value} required={required} onChange={(event) => onChange(event.target.value)}>
      {allowAll ? <option value="">All centres</option> : <option value="">Select a centre…</option>}
      {centres.map((centre) => (
        <option key={centre.id} value={centre.id}>
          {centreLabel(centre)}
        </option>
      ))}
    </Select>
  );
}
