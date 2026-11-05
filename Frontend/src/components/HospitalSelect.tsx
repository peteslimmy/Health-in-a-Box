import { useUser } from '../auth/AuthContext';
import { hospitalLabel } from '../lib/format';
import { Select } from './ui';

/** Lists only the hospitals the signed-in user is assigned to (the API enforces this too). */
export function HospitalSelect({
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
  const hospitals = user.hospitals ?? [];
  return (
    <Select id={id} value={value} required={required} onChange={(event) => onChange(event.target.value)}>
      {allowAll ? <option value="">All hospitals</option> : <option value="">Select a hospital…</option>}
      {hospitals.map((hospital) => (
        <option key={hospital.id} value={hospital.id}>
          {hospitalLabel(hospital)}
        </option>
      ))}
    </Select>
  );
}
