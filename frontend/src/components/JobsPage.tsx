import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { JobDto } from '@coverage-improver/shared';
import * as api from '../api';

export function JobsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.listJobs(),
    refetchInterval: 5000, // Poll every 5 seconds
    staleTime: 0, // Always consider data stale
    refetchOnMount: 'always', // Always refetch when component mounts
  });

  const cancelMutation = useMutation({
    mutationFn: api.cancelJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['jobs'] }),
  });

  function handleCancel(id: string) {
    if (!confirm('Are you sure you want to cancel this job?')) return;
    cancelMutation.mutate(id);
  }

  function getStatusClass(status: string): string {
    switch (status) {
      case 'completed': return 'badge-completed';
      case 'running': return 'badge-running';
      case 'pending': return 'badge-pending';
      case 'failed': return 'badge-failed';
      case 'cancelled': return 'badge-cancelled';
      default: return '';
    }
  }

  if (isLoading) {
    return <div className="loading">Loading jobs...</div>;
  }

  const jobs = data?.jobs ?? [];

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Jobs</h2>
      </div>

      {error && <div className="error">{(error as Error).message}</div>}

      {jobs.length === 0 ? (
        <div className="empty-state card">
          <h3>No jobs yet</h3>
          <p>Start an improvement job from a repository's coverage page.</p>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>File</th>
                <th>Repository</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Progress</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job: JobDto) => (
                <tr key={job.id}>
                  <td>
                    <span style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                      {job.filePath}
                    </span>
                  </td>
                  <td>{job.repositoryName}</td>
                  <td>
                    <span style={{
                      color: job.aiProvider === 'claude' ? 'var(--accent-purple)' : 'var(--accent-green)',
                      fontWeight: 500,
                    }}>
                      {job.aiProvider}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${getStatusClass(job.status)}`}>
                      {job.status}
                    </span>
                  </td>
                  <td style={{ width: '200px' }}>
                    <div className="progress-bar">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      {job.progress}%
                    </div>
                  </td>
                  <td>
                    {job.status === 'completed' && job.prUrl && (
                      <a
                        href={job.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary"
                      >
                        View PR
                      </a>
                    )}
                    {(job.status === 'pending' || job.status === 'running') && (
                      <button
                        className="btn btn-danger"
                        onClick={() => handleCancel(job.id)}
                        disabled={cancelMutation.isPending}
                      >
                        Cancel
                      </button>
                    )}
                    {job.status === 'failed' && job.error && (
                      <span
                        style={{ color: 'var(--accent-red)', fontSize: '13px' }}
                        title={job.error}
                      >
                        {job.error.slice(0, 30)}...
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
