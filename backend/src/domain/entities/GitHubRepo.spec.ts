import { GitHubRepo } from './GitHubRepo';

describe('GitHubRepo', () => {
  describe('create', () => {
    it('should create a repository with valid props', () => {
      const repo = GitHubRepo.create({
        url: 'https://github.com/user/repo',
        owner: 'user',
        name: 'repo',
        branch: 'main',
        defaultBranch: 'main',
      });

      expect(repo.url).toBe('https://github.com/user/repo');
      expect(repo.owner).toBe('user');
      expect(repo.name).toBe('repo');
      expect(repo.defaultBranch).toBe('main');
      expect(repo.id).toBeDefined();
      expect(repo.lastAnalyzedAt).toBeNull();
    });

    it('should throw for empty URL', () => {
      expect(() =>
        GitHubRepo.create({
          url: '',
          owner: 'user',
          name: 'repo',
          branch: 'main',
          defaultBranch: 'main',
        }),
      ).toThrow('Repository URL cannot be empty');
    });

    it('should throw for non-GitHub URL', () => {
      expect(() =>
        GitHubRepo.create({
          url: 'https://gitlab.com/user/repo',
          owner: 'user',
          name: 'repo',
          branch: 'main',
          defaultBranch: 'main',
        }),
      ).toThrow('Only GitHub repositories are supported');
    });
  });

  describe('fromGitHubUrl', () => {
    it('should parse HTTPS URL', () => {
      const { owner, name } = GitHubRepo.fromGitHubUrl('https://github.com/user/repo');
      expect(owner).toBe('user');
      expect(name).toBe('repo');
    });

    it('should parse URL with .git suffix', () => {
      const { owner, name } = GitHubRepo.fromGitHubUrl('https://github.com/user/repo.git');
      expect(owner).toBe('user');
      expect(name).toBe('repo');
    });

    it('should throw for invalid URL', () => {
      expect(() => GitHubRepo.fromGitHubUrl('invalid')).toThrow('Invalid GitHub URL');
    });
  });

  describe('markAsAnalyzed', () => {
    it('should update lastAnalyzedAt', () => {
      const repo = GitHubRepo.create({
        url: 'https://github.com/user/repo',
        owner: 'user',
        name: 'repo',
        branch: 'main',
        defaultBranch: 'main',
      });

      expect(repo.lastAnalyzedAt).toBeNull();
      repo.markAsAnalyzed();
      expect(repo.lastAnalyzedAt).toBeInstanceOf(Date);
    });
  });

  describe('cloneUrl', () => {
    it('should return HTTPS clone URL', () => {
      const repo = GitHubRepo.create({
        url: 'https://github.com/user/repo',
        owner: 'user',
        name: 'repo',
        branch: 'main',
        defaultBranch: 'main',
      });

      expect(repo.cloneUrl).toBe('https://github.com/user/repo.git');
    });
  });
});
