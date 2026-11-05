import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorNotice, Loading, PageHeader, Select } from '../components/ui';
import { api } from '../lib/api';
import type { WorkItem, WorkQueue } from '../lib/types';

const SEVERITY_STYLE: Record<WorkItem['severity'], string> = {
  urgent: 'bg-red-50 text-red-700',
  attention: 'bg-amber-50 text-amber-800',
  info: 'bg-slate-100 text-slate-600',
};
const SEVERITY_LABEL: Record<WorkItem['severity'], string> = { urgent: 'Urgent', attention: 'Needs attention', info: 'Waiting' };

export function WorkQueuePage() {
  const [kind, setKind] = useState('');
  const queue = useQuery({ queryKey: ['work-queue'], queryFn: () => api<WorkQueue>('/work-queue'), refetchInterval: 60_000 });

  if (queue.isLoading) return <Loading />;
  if (queue.error || !queue.data) return <ErrorNotice error={queue.error} />;
  const data = queue.data;
  const items = data.items.filter((item) => !kind || item.kind === kind);

  return (
    <div className="space-y-5">
      <PageHeader
        title="My work"
        subtitle="Everything waiting for you to act on, most urgent first. It lists only what you are allowed to do: things you prepared yourself are left for someone else to approve."
      />
      {data.total === 0 ? (
        <EmptyState title="Nothing is waiting for you" hint="New approvals, late reports and overdue follow-ups will appear here." />
      ) : (
        <Card
          title={`${data.total} item${data.total === 1 ? '' : 's'}${data.urgent > 0 ? ` · ${data.urgent} urgent` : ''}`}
          actions={
            <Select aria-label="Filter by kind" value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="">All kinds</option>
              {Object.entries(data.counts).map(([name, count]) => (
                <option key={name} value={name}>
                  {name} ({count})
                </option>
              ))}
            </Select>
          }
        >
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li key={item.key}>
                <Link to={item.link} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm hover:bg-slate-50">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_STYLE[item.severity]}`}>{SEVERITY_LABEL[item.severity]}</span>
                  <span className="w-44 shrink-0 font-medium text-slate-800">{item.kind}</span>
                  <span className="min-w-0 flex-1 text-slate-700">
                    <span className="font-medium">{item.action}:</span> {item.title}
                    {item.hospital && <span className="block text-xs text-slate-500">{item.hospital}</span>}
                  </span>
                  <span className="text-xs tabular-nums text-slate-500">
                    {item.ageDays === 0 ? 'today' : `${item.ageDays} day${item.ageDays === 1 ? '' : 's'}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
