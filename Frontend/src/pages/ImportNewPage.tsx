import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../auth/AuthContext';
import { HospitalSelect } from '../components/HospitalSelect';
import { Button, Card, ErrorNotice, Field, Input, Notice, PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { can } from '../lib/permissions';
import type { ImportBatch } from '../lib/types';

const MAX_BYTES = 15 * 1024 * 1024;

export function ImportNewPage() {
  const navigate = useNavigate();
  const user = useUser();
  const queryClient = useQueryClient();
  const [hospitalId, setHospitalId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [createMissing, setCreateMissing] = useState(false);

  const isPdf = file?.name.toLowerCase().endsWith('.pdf') ?? false;
  const periodRequired = !!file && !isPdf;

  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set('hospitalId', hospitalId);
      if (periodStart) form.set('periodStart', periodStart);
      if (periodEnd) form.set('periodEnd', periodEnd);
      if (createMissing) form.set('createMissing', 'true');
      form.set('file', file!);
      return api<ImportBatch>('/imports', { method: 'POST', form });
    },
    onSuccess: (batch) => {
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
      void queryClient.invalidateQueries({ queryKey: ['hospital'] });
      navigate(`/imports/${batch.id}`);
    },
  });

  const template = useMutation({
    mutationFn: async () => {
      const blob = await api<Blob>('/imports/template', { query: { hospitalId }, blob: true });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'revenue-template.csv';
      link.click();
      URL.revokeObjectURL(url);
    },
  });

  function pick(selected: File | null) {
    setFileError('');
    if (selected) {
      const name = selected.name.toLowerCase();
      if (!name.endsWith('.csv') && !name.endsWith('.xlsx') && !name.endsWith('.pdf')) {
        setFile(null);
        return setFileError('Only .pdf, .csv and .xlsx files are supported.');
      }
      if (selected.size > MAX_BYTES) {
        setFile(null);
        return setFileError('The file is larger than 15 MB.');
      }
    }
    setFile(selected);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    upload.mutate();
  }

  return (
    <div>
      <PageHeader
        title="New revenue import"
        subtitle="Upload the daily or periodic collection report as a PDF, or a CSV/XLSX export. Only the financial table is read; every total is re-added and checked before anything can be committed."
      />
      <Card>
        <form onSubmit={submit} className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Hospital">{(id) => <HospitalSelect id={id} required value={hospitalId} onChange={setHospitalId} />}</Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Report file (.pdf, .csv or .xlsx, up to 15 MB)" error={fileError}>
              {(id) => <Input id={id} type="file" required accept=".pdf,.csv,.xlsx" onChange={(event) => pick(event.target.files?.[0] ?? null)} />}
            </Field>
          </div>
          <Field label={`Period start${periodRequired ? '' : ' (optional for PDF)'}`} hint={isPdf ? 'Leave blank: the PDF states its own period.' : undefined}>
            {(id) => (
              <Input
                id={id}
                type="date"
                required={periodRequired}
                value={periodStart}
                max={periodEnd || undefined}
                onChange={(event) => setPeriodStart(event.target.value)}
              />
            )}
          </Field>
          <Field label={`Period end${periodRequired ? '' : ' (optional for PDF)'}`}>
            {(id) => (
              <Input
                id={id}
                type="date"
                required={periodRequired}
                value={periodEnd}
                min={periodStart || undefined}
                onChange={(event) => setPeriodEnd(event.target.value)}
              />
            )}
          </Field>
          {can(user, 'hospitals.update') && (
            <label className="flex items-start gap-2 text-sm text-slate-700 sm:col-span-2">
              <input type="checkbox" className="mt-1" checked={createMissing} onChange={(event) => setCreateMissing(event.target.checked)} />
              <span>
                Add departments and payment channels found in this file that the hospital does not have yet.
                <span className="block text-xs text-slate-500">Use for a hospital's first upload. Review the list afterwards; each addition is audited.</span>
              </span>
            </label>
          )}
          <div className="space-y-3 sm:col-span-2">
            <ErrorNotice error={upload.error ?? template.error} />
            <Notice tone="neutral" title="What is checked before anything is accepted">
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                <li>Titles, signatures and page furniture are set aside; only the revenue table is read.</li>
                <li>Every department total, channel total and the grand total are re-added and must tally.</li>
                <li>Row numbers must run without gaps, and each department must be known to the hospital.</li>
                <li>Days already uploaded are never overwritten: if earlier reports sit inside this file's period, only the new days are taken; otherwise it is blocked. Skipped days are flagged and need a reason.</li>
              </ul>
              <p className="mt-1">Uploading posts nothing. You will see every result first.</p>
            </Notice>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={upload.isPending} disabled={!hospitalId || !file}>
                Upload and validate
              </Button>
              <Button variant="secondary" loading={template.isPending} disabled={!hospitalId} onClick={() => template.mutate()}>
                Download CSV template for this hospital
              </Button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
