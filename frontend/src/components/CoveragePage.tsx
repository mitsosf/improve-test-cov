import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AiProvider, CoverageFileDto } from '@coverage-improver/shared';
import * as api from '../api';

const PAGE_SIZE = 10;

export function CoveragePage() {
  const { repoId } = useParams<{ repoId: string }>();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [showImproveModal, setShowImproveModal] = useState<{
    fileId: string;
    filePath: string;
  } | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);

  const { data: report, isLoading, error } = useQuery({
    queryKey: ['coverage', repoId, page],
    queryFn: () => api.getCoverage(repoId!, page, PAGE_SIZE),
    enabled: !!repoId,
    // Always refetch when navigating to this page to ensure fresh data
    refetchOnMount: 'always',
    staleTime: 0,
    // Poll every 3 seconds when there are files being improved
    refetchInterval: (query) => {
      const data = query.state.data;
      const hasImprovingFiles = data?.files?.some(f => f.status === 'improving');
      return hasImprovingFiles ? 3000 : false;
    },
  });

  const improveMutation = useMutation({
    mutationFn: ({ fileId, provider }: { fileId: string; provider: AiProvider }) =>
      api.createJob(repoId!, fileId, provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coverage', repoId] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setShowImproveModal(null);
    },
  });

  const bulkImproveMutation = useMutation({
    mutationFn: ({ fileIds, provider }: { fileIds: string[]; provider: AiProvider }) =>
      api.createBulkJobs(repoId!, fileIds, provider),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['coverage', repoId] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setSelectedFiles(new Set());
      setShowBulkModal(false);
    },
  });

  // Get improvable files (pending, below 100%)
  const improvableFiles = report?.files.filter(
    (f: CoverageFileDto) => f.status === 'pending' && f.coveragePercentage < 100,
  ) || [];

  function handleSelectAll() {
    if (selectedFiles.size === improvableFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(improvableFiles.map((f: CoverageFileDto) => f.id)));
    }
  }

  function handleToggleFile(fileId: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  }

  function getCoverageClass(percentage: number): string {
    if (percentage >= 80) return 'coverage-high';
    if (percentage >= 50) return 'coverage-medium';
    return 'coverage-low';
  }

  if (isLoading) {
    return <div className="loading">Loading coverage report...</div>;
  }

  if (error) {
    return (
      <div>
        <div className="error">{(error as Error).message}</div>
        <Link to="/" className="btn">Back to Repositories</Link>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="empty-state card">
        <h3>No coverage data</h3>
        <p>Run analysis first to see coverage.</p>
        <Link to="/" className="btn">Back to Repositories</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/" style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
            ← Back to Repositories
          </Link>
          <h2 className="page-title" style={{ marginTop: '8px' }}>
            {report.repository.name}
          </h2>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: 'var(--accent-blue)' }}>
            {report.summary.totalFiles}
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>Total Files</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div
            className={`coverage-badge ${getCoverageClass(report.summary.averageCoverage)}`}
            style={{ fontSize: '32px', fontWeight: 'bold', display: 'inline-block' }}
          >
            {report.summary.averageCoverage.toFixed(1)}%
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>Average Coverage</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', fontWeight: 'bold', color: 'var(--accent-red)' }}>
            {report.summary.filesBelowThreshold}
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>Files Below 80%</div>
        </div>
      </div>

      {/* Files Table */}
      <div className="card">
        {selectedFiles.size > 0 && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-secondary)' }}>
              {selectedFiles.size} file{selectedFiles.size > 1 ? 's' : ''} selected
            </span>
            <button
              className="btn btn-primary"
              onClick={() => setShowBulkModal(true)}
            >
              Improve Selected ({selectedFiles.size})
            </button>
          </div>
        )}
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}>
                <input
                  type="checkbox"
                  checked={selectedFiles.size === improvableFiles.length && improvableFiles.length > 0}
                  onChange={handleSelectAll}
                  disabled={improvableFiles.length === 0}
                />
              </th>
              <th>File</th>
              <th>Coverage</th>
              <th>Uncovered Lines</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {report.files.map(file => (
              <tr key={file.id}>
                <td>
                  {file.status === 'pending' && file.coveragePercentage < 100 && (
                    <input
                      type="checkbox"
                      checked={selectedFiles.has(file.id)}
                      onChange={() => handleToggleFile(file.id)}
                    />
                  )}
                </td>
                <td>
                  <span style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                    {file.path}
                  </span>
                </td>
                <td>
                  <span className={`coverage-badge ${getCoverageClass(file.coveragePercentage)}`}>
                    {file.coveragePercentage.toFixed(1)}%
                  </span>
                </td>
                <td>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    {file.uncoveredLines.slice(0, 5).join(', ')}
                    {file.uncoveredLines.length > 5 && '...'}
                  </span>
                </td>
                <td>
                  <span className={`badge badge-${file.status}`}>
                    {file.status}
                  </span>
                </td>
                <td>
                  {file.status === 'pending' && file.coveragePercentage < 100 && (
                    <button
                      className="btn btn-primary"
                      onClick={() => setShowImproveModal({ fileId: file.id, filePath: file.path })}
                      disabled={improveMutation.isPending}
                    >
                      Improve
                    </button>
                  )}
                  {file.status === 'improving' && (
                    <Link to="/jobs" className="btn">
                      View Job
                    </Link>
                  )}
                  {file.status === 'improved' && (
                    <span style={{ color: 'var(--accent-green)' }}>Done</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {report.pagination && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderTop: '1px solid var(--border-color)',
          }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
              Showing {((report.pagination.page - 1) * report.pagination.limit) + 1}-
              {Math.min(report.pagination.page * report.pagination.limit, report.pagination.total)} of {report.pagination.total} files
            </span>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                className="btn"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </button>

              <span style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>
                Page {report.pagination.page} of {report.pagination.totalPages}
              </span>

              <button
                className="btn"
                onClick={() => setPage(p => Math.min(report.pagination!.totalPages, p + 1))}
                disabled={page === report.pagination.totalPages}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Improve Modal */}
      {showImproveModal && (
        <div className="modal-overlay" onClick={() => setShowImproveModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Improve Coverage</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Generate tests for <code>{showImproveModal.filePath}</code>
            </p>

            {improveMutation.error && (
              <div className="error">{(improveMutation.error as Error).message}</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                className="btn btn-primary"
                style={{ justifyContent: 'center' }}
                onClick={() => improveMutation.mutate({ fileId: showImproveModal.fileId, provider: 'claude' })}
                disabled={improveMutation.isPending}
              >
                Use Claude
              </button>
              <button
                className="btn"
                style={{ justifyContent: 'center' }}
                onClick={() => improveMutation.mutate({ fileId: showImproveModal.fileId, provider: 'openai' })}
                disabled={improveMutation.isPending}
              >
                Use OpenAI
              </button>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => setShowImproveModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Improve Modal */}
      {showBulkModal && (
        <div className="modal-overlay" onClick={() => setShowBulkModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Improve {selectedFiles.size} Files</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
              Generate tests for {selectedFiles.size} selected file{selectedFiles.size > 1 ? 's' : ''}
            </p>

            {bulkImproveMutation.error && (
              <div className="error">{(bulkImproveMutation.error as Error).message}</div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                className="btn btn-primary"
                style={{ justifyContent: 'center' }}
                onClick={() => bulkImproveMutation.mutate({
                  fileIds: Array.from(selectedFiles),
                  provider: 'claude',
                })}
                disabled={bulkImproveMutation.isPending}
              >
                {bulkImproveMutation.isPending ? 'Creating jobs...' : 'Use Claude'}
              </button>
              <button
                className="btn"
                style={{ justifyContent: 'center' }}
                onClick={() => bulkImproveMutation.mutate({
                  fileIds: Array.from(selectedFiles),
                  provider: 'openai',
                })}
                disabled={bulkImproveMutation.isPending}
              >
                Use OpenAI
              </button>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => setShowBulkModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
