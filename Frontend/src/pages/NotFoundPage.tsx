import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui';

export function NotFoundPage() {
  return (
    <div>
      <PageHeader title="Page not found" subtitle="The page does not exist, or you do not have access to it." />
      <Link to="/" className="text-brand-700 underline">Back to the dashboard</Link>
    </div>
  );
}
