import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader.jsx';
import { EmptyState } from '../components/Feedback.jsx';

export function NotFound() {
  return (
    <div className="stack">
      <PageHeader title="Page not found" />
      <div className="card">
        <EmptyState
          title="That page does not exist"
          description="The address may be mistyped, or the record may have been removed."
          action={<Link to="/dashboard">Go to the dashboard</Link>}
        />
      </div>
    </div>
  );
}
