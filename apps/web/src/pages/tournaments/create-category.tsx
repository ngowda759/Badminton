import { useNavigate } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import { PageHeader } from '@/components/page-header.tsx';
import { CategoryForm } from '@/components/tournaments/category-form.tsx';
import { useTournament } from '@/components/tournaments/context.tsx';

/** Create-category page; navigates to the new category on success. */
export function CreateCategoryPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { tournament } = useTournament();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create category"
        description="Categories start as Draft; open them to accept registrations."
      />
      <CategoryForm
        initialValues={{ name: '', code: '', format: 'SINGLES', gender: '' }}
        submitLabel="Create category"
        codeEditable
        onCancel={() => void navigate(`/tournaments/${tournament.id}/categories`)}
        onSubmit={async (values) => {
          const category = await api.categories.create(tournament.id, {
            name: values.name.trim(),
            code: values.code,
            format: values.format,
            gender: values.gender === '' ? null : values.gender,
          });
          void navigate(`/tournaments/${tournament.id}/categories/${category.id}`);
        }}
      />
    </div>
  );
}
