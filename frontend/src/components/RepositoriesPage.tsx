import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { RepositoryDto, AnalysisJobDto } from '@coverage-improver/shared';
import * as api from '../api';

export function RepositoriesPage() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeAnalysisJobs, setActiveAnalysisJobs] = useState<Record<string, AnalysisJobDto>>({});

  const { data: repositories = [], isLoading, error } = useQuery({
    queryKey: ['repositories'],
    queryFn: api.listRepositories,
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteRepository,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['repositories'] }),
  });

  const analyzeMutation = useMutation({
    mutationFn: (id: string) => api.analyzeRepository(id),
    onSuccess: (job) => {
      setActiveAnalysisJobs(prev => ({ ...prev, [job.repositoryId]: job }));
    },
  });

  // Poll for active analysis job status
  useEffect(() => {
    const activeJobs = Object.values(activeAnalysisJobs).filter(
      job => job.status === 'pending' || job.status === 'running'
    );

    if (activeJobs.length === 0) return;

    const pollInterval = setInterval(async () => {
      for (const job of activeJobs) {
        try {
          const updated = await api.getAnalysisJob(job.repositoryId, job.id);
          setActiveAnalysisJobs(prev => ({ ...prev, [updated.repositoryId]: updated }));

          if (updated.status === 'completed' || updated.status === 'failed') {
            queryClient.invalidateQueries({ queryKey: ['repositories'] });
            // Also invalidate coverage data so it's fresh when user navigates
            queryClient.invalidateQueries({ queryKey: ['coverage', updated.repositoryId] });
          }
        } catch (err) {
          console.error('Failed to poll analysis job:', err);
        }
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [activeAnalysisJobs, queryClient]);

  function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this repository?')) return;
    deleteMutation.mutate(id);
  }

  function getAnalysisStatus(repoId: string): AnalysisJobDto | undefined {
    return activeAnalysisJobs[repoId];
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Repositories</h2>
        <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
          + Add Repository
        </button>
      </div>

      {error && <div className="error">{(error as Error).message}</div>}

      {isLoading ? (
        <div className="loading">Loading repositories...</div>
      ) : repositories.length === 0 ? (
        <div className="empty-state card">
          <h3>No repositories yet</h3>
          <p>Add a GitHub repository to start analyzing coverage.</p>
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Repository</th>
                <th>Branch</th>
                <th>Last Analyzed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {repositories.map((repo: RepositoryDto) => (
                <tr key={repo.id}>
                  <td>
                    <Link to={`/coverage/${repo.id}`} style={{ fontWeight: 500 }}>
                      {repo.name}
                    </Link>
                    <br />
                    <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                      {repo.url}
                    </span>
                  </td>
                  <td>{repo.branch}</td>
                  <td>
                    {repo.lastAnalyzedAt
                      ? new Date(repo.lastAnalyzedAt).toLocaleString()
                      : <span style={{ color: 'var(--text-secondary)' }}>Never</span>
                    }
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {(() => {
                        const analysisJob = getAnalysisStatus(repo.id);
                        const isAnalyzing = analysisJob && (analysisJob.status === 'pending' || analysisJob.status === 'running');

                        if (isAnalyzing) {
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <div className="spinner" style={{ width: '16px', height: '16px' }} />
                              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                {analysisJob.progress}% - {analysisJob.status === 'pending' ? 'Queued' : 'Analyzing'}
                              </span>
                            </div>
                          );
                        }

                        if (analysisJob?.status === 'failed') {
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span style={{ fontSize: '12px', color: 'var(--error-color)' }}>
                                Failed: {analysisJob.error?.slice(0, 50)}
                              </span>
                              <button
                                className="btn"
                                onClick={() => analyzeMutation.mutate(repo.id)}
                                disabled={analyzeMutation.isPending}
                              >
                                Retry
                              </button>
                            </div>
                          );
                        }

                        return (
                          <button
                            className="btn"
                            onClick={() => analyzeMutation.mutate(repo.id)}
                            disabled={analyzeMutation.isPending}
                          >
                            Analyze
                          </button>
                        );
                      })()}
                      {repo.lastAnalyzedAt ? (
                        <Link to={`/coverage/${repo.id}`} className="btn">
                          Coverage
                        </Link>
                      ) : (
                        <button className="btn" disabled title="Run analysis first">
                          Coverage
                        </button>
                      )}
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDelete(repo.id)}
                        disabled={deleteMutation.isPending}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddModal && (
        <AddRepositoryModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}

function isValidGitHubUrl(url: string): boolean {
  return /^https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(url);
}

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

function AddRepositoryModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');

  // Debounce URL for API call
  const debouncedUrl = useDebounce(url, 300);

  // Fetch branches when URL is a valid GitHub URL (with debounce)
  const branchesQuery = useQuery({
    queryKey: ['branches', debouncedUrl],
    queryFn: () => api.getBranches(debouncedUrl),
    enabled: isValidGitHubUrl(debouncedUrl),
    retry: false,
  });

  const branches = branchesQuery.data;

  // Set default branch when branches are loaded (only if available)
  useEffect(() => {
    if (branches && branches.branches.length > 0 && !branch) {
      // Pick first available branch (which should be default if available)
      setBranch(branches.branches[0]);
    }
  }, [branches, branch]);

  const mutation = useMutation({
    mutationFn: () => api.createRepository(url, branch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] });
      onSuccess();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  function handleUrlChange(newUrl: string) {
    setUrl(newUrl);
    // Reset branch when URL changes
    if (!isValidGitHubUrl(newUrl)) {
      setBranch('');
    }
  }

  const allTracked = branches?.allTracked ?? false;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Add Repository</h3>

        {mutation.error && <div className="error">{(mutation.error as Error).message}</div>}
        {branchesQuery.error && <div className="error">{(branchesQuery.error as Error).message}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">GitHub URL</label>
            <input
              type="url"
              className="form-input"
              placeholder="https://github.com/owner/repo"
              value={url}
              onChange={e => handleUrlChange(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Branch</label>
            {branchesQuery.isLoading || (isValidGitHubUrl(url) && url !== debouncedUrl) ? (
              <div style={{ color: 'var(--text-secondary)', padding: '10px 0' }}>
                Loading branches...
              </div>
            ) : allTracked ? (
              <div style={{ color: 'var(--text-secondary)', padding: '10px 0' }}>
                All branches are already tracked for this repository.
              </div>
            ) : branches && branches.branches.length > 0 ? (
              <select
                className="form-select"
                value={branch}
                onChange={e => setBranch(e.target.value)}
                required
              >
                {branches.branches.map(b => (
                  <option key={b} value={b}>
                    {b}{b === branches.defaultBranch ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="form-input"
                placeholder="main"
                value={branch}
                onChange={e => setBranch(e.target.value)}
              />
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={mutation.isPending || branchesQuery.isLoading || !branch || allTracked}
            >
              {mutation.isPending ? 'Adding...' : 'Add Repository'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
