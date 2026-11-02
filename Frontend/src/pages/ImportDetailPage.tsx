import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useUser } from '../auth/AuthContext';
import { Button, Card, EmptyState, ErrorNotice, Field, KeyValue, Loading, Notice, PageHeader, StatusBadge, Table, Td, Textarea, Th } from '../components/ui';
import { api } from '../lib/api';
import { centreLabel, formatDate, formatDateTime, formatMoney } from '../lib/format';
import { can } from '../lib/permissions';
import type { ImportDetail, ImportIssue } from '../lib/types';

function IssueTable({ issues, caption }: { issues: ImportIssue[]; caption: string }) {
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th>Row</Th>
          <Th>Field</Th>
          <Th>Problem</Th>
          <Th>Code</Th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue, index) => (
          <tr key={index}>
            <Td numeric>{issue.row ?? '—'}</Td>
            <Td>{issue.field ?? '—'}</Td>
            <Td>{issue.message}</Td>
            <Td className="font-mono text-xs">{issue.code}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Findings an approver may knowingly accept: differences between printed totals and the figures. */
const APPROVABLE = new Set(['ROW_TOTAL_MISMATCH', 'GRAND_TOTAL_MISMATCH', 'COLUMN_TOTAL_MISMATCH', 'CROSS_FOOTING_MISMATCH', 'SERIAL_GAP']);

type Check = { label: string; codes: string[]; hint: string };

/** The controls every upload passes through, each shown as passed or failed. */
const CHECKS: Check[] = [
  {
    label: 'Each department total equals its channel figures',
    codes: ['ROW_TOTAL_MISMATCH', 'INVALID_AMOUNT', 'NEGATIVE_AMOUNT'],
    hint: 'A department total is not the sum of its channels, or an amount is not a valid number.',
  },
  {
    label: 'Each channel total equals the sum of its rows',
    codes: ['COLUMN_TOTAL_MISMATCH'],
    hint: 'A printed column total does not match the figures above it.',
  },
  {
    label: 'Grand total equals the sum of all departments',
    codes: ['GRAND_TOTAL_MISMATCH', 'CROSS_FOOTING_MISMATCH'],
    hint: 'The grand total does not agree with the rows or the channel totals.',
  },
  { label: 'Row numbers run without gaps or repeats', codes: ['SERIAL_GAP'], hint: 'A printed row may be missing or repeated.' },
  {
    label: 'Departments and channels are known to the centre',
    codes: ['UNKNOWN_DEPARTMENT', 'UNKNOWN_CHANNEL_COLUMN', 'DUPLICATE_DEPARTMENT', 'DUPLICATE_CHANNEL_COLUMN'],
    hint: 'Names in the file are not set up for this centre.',
  },
  {
    label: 'No day is already in the system',
    codes: ['PERIOD_ALREADY_UPLOADED'],
    hint: 'Days in this file were already uploaded. Existing records are never overwritten.',
  },
  {
    label: 'Period is not in the future and the report was printed after it ended',
    codes: ['PERIOD_IN_FUTURE', 'PRINTED_BEFORE_PERIOD_END'],
    hint: 'The report cannot include days that had not finished.',
  },
];

function ChecksCard({ errors, flags }: { errors: ImportIssue[]; flags: ImportIssue[] }) {
  const failed = new Set(errors.map((error) => error.code));
  return (
    <Card title="Checks">
      <ul className="divide-y divide-slate-100">
        {CHECKS.map((check) => {
          const bad = check.codes.some((code) => failed.has(code));
          return (
            <li key={check.label} className="flex items-start gap-3 py-2 text-sm">
              <span
                aria-hidden
                className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${bad ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}
              >
                {bad ? '✕' : '✓'}
              </span>
              <span>
                <span className="font-medium text-slate-800">{check.label}</span>
                <span className="sr-only">{bad ? ' — failed' : ' — passed'}</span>
                {bad && <span className="block text-xs text-red-700">{check.hint}</span>}
              </span>
            </li>
          );
        })}
        <li className="flex items-start gap-3 py-2 text-sm">
          <span
            aria-hidden
            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${flags.length > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}
          >
            {flags.length > 0 ? '!' : '✓'}
          </span>
          <span>
            <span className="font-medium text-slate-800">No days omitted since the previous report</span>
            <span className="sr-only">{flags.length > 0 ? ' — flagged' : ' — passed'}</span>
            {flags.length > 0 && <span className="block text-xs text-amber-800">Skipped days are listed below and need a reason to commit.</span>}
          </span>
        </li>
      </ul>
    </Card>
  );
}

export function ImportDetailPage() {
  const { id = '' } = useParams();
  const user = useUser();
  const queryClient = useQueryClient();
  const [acknowledgement, setAcknowledgement] = useState('');
  const [varianceReason, setVarianceReason] = useState('');
  const [understood, setUnderstood] = useState(false);
  const detail = useQuery({ queryKey: ['import', id], queryFn: () => api<ImportDetail>(`/imports/${id}`) });
  const download = useMutation({
    mutationFn: async () => {
      const blob = await api<Blob>(`/imports/${id}/source`, { blob: true });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = detail.data?.fileName ?? 'report';
      link.click();
      URL.revokeObjectURL(url);
    },
  });
  const commit = useMutation({
    mutationFn: (reason: string) => api<{ reportId: string }>(`/imports/${id}/commit`, { method: 'POST', body: reason ? { acknowledgement: reason } : {} }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['import', id] });
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-trends'] });
    },
  });

  const approveVariance = useMutation({
    mutationFn: () =>
      api<{ reportId: string }>(`/imports/${id}/commit-with-variance`, {
        method: 'POST',
        body: { reason: varianceReason.trim(), ...(acknowledgement.trim() && { acknowledgement: acknowledgement.trim() }) },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['import', id] });
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-trends'] });
    },
  });

  if (detail.isLoading) return <Loading />;
  if (detail.error || !detail.data) return <ErrorNotice error={detail.error} />;
  const batch = detail.data;
  const validation = batch.validationJson;
  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const flags = validation?.flags ?? [];
  const needsAcknowledgement = flags.some((flag) => flag.requiresAcknowledgement);
  const source = validation?.source ?? null;
  const trim = validation?.trim ?? null;
  const setupAdded = validation?.setupAdded;
  const lines = batch.normalizedJson?.lines ?? [];
  const channelCodes = [...new Set(lines.flatMap((line) => Object.keys(line.amounts)))];
  const isUploader = batch.createdById === user.id;
  const canCommit = can(user, 'imports.commit') && batch.status === 'READY_TO_COMMIT';
  const reasonOk = !needsAcknowledgement || acknowledgement.trim().length >= 10;
  const onlyTotalsDiffer = errors.length > 0 && errors.every((error) => APPROVABLE.has(error.code));
  const canApproveVariance = can(user, 'imports.approve_variance') && batch.status === 'NEEDS_REVIEW' && onlyTotalsDiffer;
  const rowsWithDifference = lines.filter((line) => Math.abs(Number(line.variance)) > 0.01).length;
  const printedTotal = validation?.grandTotal ?? '0.00';
  const evidencedTotal = lines.reduce((sum, line) => sum + Number(line.channelTotal), 0).toFixed(2);
  const difference = (Number(printedTotal) - Number(evidencedTotal)).toFixed(2);
  const approval = batch.committedReport?.varianceApprovedAt ? batch.committedReport : null;
  const approvalOk = varianceReason.trim().length >= 20 && understood && (!needsAcknowledgement || acknowledgement.trim().length >= 10);
  const setupProblem = errors.some((error) => error.code === 'UNKNOWN_DEPARTMENT' || error.code === 'UNKNOWN_CHANNEL_COLUMN');

  return (
    <div className="space-y-5">
      <PageHeader
        title={batch.fileName ?? 'Revenue import'}
        subtitle={
          <>
            <StatusBadge status={batch.status} /> {centreLabel(batch.centre)} · {formatDate(batch.periodStart)} – {formatDate(batch.periodEnd)}
          </>
        }
        actions={
          <>
            <Button variant="secondary" loading={download.isPending} onClick={() => download.mutate()}>
              Download original file
            </Button>
            {canCommit && !isUploader && (
              <Button loading={commit.isPending} disabled={!reasonOk} onClick={() => commit.mutate(acknowledgement.trim())}>
                Commit import
              </Button>
            )}
          </>
        }
      />
      <ErrorNotice error={download.error} />
      <ErrorNotice error={commit.error} />
      <ErrorNotice error={approveVariance.error} />
      {approveVariance.isSuccess && (
        <Notice tone="good" title="Committed with the differences approved">
          The report is recorded with its channel amounts as its figures, and your reason is kept with it.{' '}
          <Link
            className="underline"
            to={`/charge-runs/new?centreId=${batch.centre.id}&periodStart=${batch.periodStart.slice(0, 10)}&periodEnd=${batch.periodEnd.slice(0, 10)}`}
          >
            Calculate service charges for this period
          </Link>
          .
        </Notice>
      )}
      {approval && (
        <Notice tone="warn" title="Committed with approved differences">
          <p>
            {approval.varianceApprovedBy?.fullName ?? 'A reviewer'} accepted the differences on {formatDateTime(approval.varianceApprovedAt)}. The report's figures are the channel amounts ({formatMoney(approval.varianceJson?.evidencedTotal)}); the report printed {formatMoney(approval.varianceJson?.printedGrandTotal)}, a difference of {formatMoney(approval.varianceJson?.difference)}.
          </p>
          <p className="mt-1">
            <span className="font-medium">Reason given:</span> {approval.varianceReason}
          </p>
        </Notice>
      )}
      {commit.isSuccess && (
        <Notice tone="good" title="Import committed">
          The revenue report is now recorded.{' '}
          <Link
            className="underline"
            to={`/charge-runs/new?centreId=${batch.centre.id}&periodStart=${batch.periodStart.slice(0, 10)}&periodEnd=${batch.periodEnd.slice(0, 10)}`}
          >
            Calculate service charges for this period
          </Link>
          .
        </Notice>
      )}
      {canCommit && isUploader && (
        <Notice tone="warn" title="A different person must commit this import">
          You uploaded it, so segregation of duties prevents you from committing it. Ask a reviewer.
        </Notice>
      )}
      {batch.status === 'NEEDS_REVIEW' && (
        <Notice tone="bad" title={`${errors.length} problem${errors.length === 1 ? '' : 's'} must be fixed before this can be committed`}>
          Nothing has been posted and nothing already in the system was changed.{' '}
          {setupProblem
            ? 'Some departments or channels are not set up for this centre: upload the file again with "Add departments and payment channels found in this file" ticked, or add them in the centre setup. '
            : ''}
          {onlyTotalsDiffer
            ? can(user, 'imports.approve_variance')
              ? 'Only differences in the printed totals were found, so a reviewer may accept them in writing below, or the centre can send a corrected report. '
              : 'Only differences in the printed totals were found. The centre can send a corrected report, or someone with permission to approve differences can accept them in writing. '
            : 'Printed totals that do not tally must be corrected in the source report and re-exported. Other problems here cannot be approved. '}
          <Link className="underline" to="/imports/new">
            Upload again
          </Link>
        </Notice>
      )}

      {setupAdded && (setupAdded.departments.length > 0 || setupAdded.channels.length > 0) && (
        <Notice tone="info" title="Added to the centre from this file">
          {setupAdded.departments.length} department(s) and {setupAdded.channels.length} payment channel(s) were created (
          {setupAdded.channels.join(', ') || 'no new channels'}). Review them in the centre setup.
        </Notice>
      )}

      {trim && (
        <Notice tone="info" title={`Only the new days are taken: ${formatDate(trim.takenStart)} – ${formatDate(trim.takenEnd)}`}>
          The file covers {formatDate(trim.fileStart)} – {formatDate(trim.fileEnd)}.{' '}
          {trim.alreadyRecorded.map((r) => `${formatDate(r.start)} – ${formatDate(r.end)} (${r.label})`).join(', ')} already in the system and left untouched (
          {formatMoney(trim.recordedTotal)}). The amounts below are the file's totals minus what is already recorded.
        </Notice>
      )}

      {flags.length > 0 && (
        <Card title="Flags: omitted days">
          <ul className="space-y-2">
            {flags.map((flag, index) => (
              <li key={index} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {flag.message}
              </li>
            ))}
          </ul>
          {canCommit && !isUploader && needsAcknowledgement && (
            <div className="mt-3 max-w-xl">
              <Field label="Why is it acceptable to commit with these days missing?" hint="At least 10 characters. Your reason is recorded in the audit trail.">
                {(fieldId) => (
                  <Textarea id={fieldId} rows={2} maxLength={500} value={acknowledgement} onChange={(event) => setAcknowledgement(event.target.value)} />
                )}
              </Field>
            </div>
          )}
        </Card>
      )}

      {canApproveVariance && isUploader && (
        <Notice tone="warn" title="A different person must approve the differences">
          You uploaded this report, so you cannot approve its differences. Ask a reviewer who has permission to.
        </Notice>
      )}
      {canApproveVariance && !isUploader && (
        <Card title="Approve the differences and commit">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Printed grand total</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(printedTotal)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sum of the channel amounts</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{formatMoney(evidencedTotal)}</p>
              </div>
              <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700">Difference</p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-red-700">{formatMoney(difference)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rows that differ</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{rowsWithDifference}</p>
                <p className="text-xs text-slate-500">{errors.length} findings in all</p>
              </div>
            </div>
            <Notice tone="info" title="What approving does">
              <ul className="mt-1 list-disc pl-5">
                <li>The report is recorded with the <strong>channel amounts</strong> as its figures, and service charges are calculated on those amounts, not on the printed totals.</li>
                <li>The printed totals, every difference and your reason are kept with the report and in the audit trail. It is marked as committed with approved differences.</li>
                <li>Only differences between totals can be approved. It cannot be undone; a mistake is corrected with a later adjustment.</li>
              </ul>
            </Notice>
            <Field label="Why are these differences acceptable?" hint="At least 20 characters. For example, who at the centre confirmed what. This is shown with the report.">
              {(fieldId) => <Textarea id={fieldId} rows={3} maxLength={1000} value={varianceReason} onChange={(event) => setVarianceReason(event.target.value)} />}
            </Field>
            {needsAcknowledgement && (
              <Field label="Why is it acceptable to commit with days missing?" hint="At least 10 characters.">
                {(fieldId) => <Textarea id={fieldId} rows={2} maxLength={500} value={acknowledgement} onChange={(event) => setAcknowledgement(event.target.value)} />}
              </Field>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
              <span>I have reviewed the differences and accept that charges will be calculated on the channel amounts.</span>
            </label>
            <Button variant="danger" loading={approveVariance.isPending} disabled={!approvalOk} onClick={() => approveVariance.mutate()}>
              Commit with approved differences
            </Button>
          </div>
        </Card>
      )}

      <ChecksCard errors={errors} flags={flags} />

      <Card title="Summary">
        <KeyValue
          items={[
            ['Centre', centreLabel(batch.centre)],
            ['Uploaded by', `${batch.createdBy.fullName} on ${formatDateTime(batch.createdAt)}`],
            ['Department rows', `${batch.rowCount} (${batch.validRowCount} valid)`],
            ['Grand total (reported)', formatMoney(validation?.grandTotal ?? batch.totalAmount)],
            ['Sum of channel columns', formatMoney(validation?.channelTotal)],
            ['Errors / warnings / flags', `${errors.length} / ${warnings.length} / ${flags.length}`],
          ]}
        />
      </Card>

      {source && (
        <Card title="What was read from the PDF">
          <KeyValue
            items={[
              ['Report title', source.title ?? '—'],
              ['Printed on', source.printDate ? formatDate(source.printDate) : '—'],
              ['Pages', String(source.pages)],
              ['Department rows read', String(batch.rowCount)],
            ]}
          />
          {source.ignoredLines.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Set aside, not financial data</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-slate-600">
                {source.ignoredLines.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {errors.length > 0 && (
        <Card title="Errors (blocking)">
          <IssueTable issues={errors} caption="Blocking validation errors" />
        </Card>
      )}
      {warnings.length > 0 && (
        <Card title="Warnings">
          <IssueTable issues={warnings} caption="Validation warnings" />
        </Card>
      )}

      <Card title="Parsed department rows">
        {lines.length === 0 ? (
          <EmptyState title="No rows could be matched to the centre's departments" hint="Fix the errors above, then upload again." />
        ) : (
          <Table caption="Parsed department rows">
            <thead>
              <tr>
                <Th numeric>Row</Th>
                <Th>Department</Th>
                {channelCodes.map((code) => (
                  <Th key={code} numeric>
                    {code}
                  </Th>
                ))}
                <Th numeric>Channel sum</Th>
                <Th numeric>Reported total</Th>
                <Th numeric>Variance</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.rowNumber}>
                  <Td numeric>{line.rowNumber}</Td>
                  <Td>{line.departmentCode}</Td>
                  {channelCodes.map((code) => (
                    <Td key={code} numeric>
                      {formatMoney(line.amounts[code] ?? '0.00')}
                    </Td>
                  ))}
                  <Td numeric>{formatMoney(line.channelTotal)}</Td>
                  <Td numeric>{formatMoney(line.reportedTotal)}</Td>
                  <Td numeric className={Number(line.variance) !== 0 ? 'font-semibold text-red-700' : ''}>
                    {formatMoney(line.variance)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
