import { GitHubRepo } from '../../../domain';
import { createTestDatabase, SqliteGitHubRepoRepository } from './';

describe('SqliteGitHubRepoRepository', () => {
  let repo: SqliteGitHubRepoRepository;

  beforeEach(() => {
    const db = createTestDatabase();
    repo = new SqliteGitHubRepoRepository(db);
  });

  describe('save and findById', () => {
    it('should save and retrieve a repository', async () => {
      const repository = GitHubRepo.create({
        url: 'https://github.com/user/repo',
        owner: 'user',
        name: 'repo',
        branch: 'main',
        defaultBranch: 'main',
      });

      await repo.save(repository);
      const found = await repo.findById(repository.id);

      expect(found).not.toBeNull();
      expect(found!.url).toBe('https://github.com/user/repo');
      expect(found!.owner).toBe('user');
      expect(found!.name).toBe('repo');
    });

    it('should update existing repository', async () => {
      const repository = GitHubRepo.create({
        url: 'https://github.com/user/repo',
        owner: 'user',
        name: 'repo',
        branch: 'main',
        defaultBranch: 'main',
      });

      await repo.save(repository);
      repository.markAsAnalyzed();
      await repo.save(repository);

      const found = await repo.findById(repository.id);
      expect(found!.lastAnalyzedAt).not.toBeNull();
    });
  });

  describe('findByUrl', () => {
    it('should find repository by URL', async () => {
      const repository = GitHubRepo.create({
        url: 'https://github.com/user/repo',
        owner: 'user',
        name: 'repo',
        branch: 'main',
        defaultBranch: 'main',
      });

      await repo.save(repository);
      const found = await repo.findByUrl('https://github.com/user/repo');

      expect(found).not.toBeNull();
      expect(found!.id).toBe(repository.id);
    });

    it('should return null for non-existent URL', async () => {
      const found = await repo.findByUrl('https://github.com/nonexistent/repo');
      expect(found).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all repositories', async () => {
      await repo.save(GitHubRepo.create({
        url: 'https://github.com/user/repo1',
        owner: 'user',
        name: 'repo1',
        branch: 'main',
        defaultBranch: 'main',
      }));
      await repo.save(GitHubRepo.create({
        url: 'https://github.com/user/repo2',
        owner: 'user',
        name: 'repo2',
        branch: 'main',
        defaultBranch: 'main',
      }));

      const all = await repo.findAll();
      expect(all).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('should delete repository', async () => {
      const repository = GitHubRepo.create({
        url: 'https://github.com/user/repo',
        owner: 'user',
        name: 'repo',
        branch: 'main',
        defaultBranch: 'main',
      });

      await repo.save(repository);
      await repo.delete(repository.id);
      const found = await repo.findById(repository.id);

      expect(found).toBeNull();
    });
  });
});
