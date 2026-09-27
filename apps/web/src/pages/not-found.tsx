import { Link } from 'react-router-dom';

import { EmptyState } from '@/components/states.tsx';

/** Fallback for an unknown route. */
export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-lg py-12">
      <EmptyState
        title="Page not found"
        description="The page you requested does not exist."
        action={
          <Link className="text-primary text-sm underline underline-offset-4" to="/tournaments">
            Back to tournaments
          </Link>
        }
      />
    </div>
  );
}
