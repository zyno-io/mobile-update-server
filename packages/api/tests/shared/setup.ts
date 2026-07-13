import { TestingHelpers } from '@zyno-io/ts-server-foundation';
import { createServer, IncomingMessage, ServerResponse } from 'http';

export const ZERO_ID = '00000000-0000-0000-0000-000000000000';
export const TEST_CI_TOKEN = 'glcbt-test-token';
export const TEST_PROJECT_PATH = 'group/test-app';
export const TEST_VCS_PROJECT_ID = 1;

process.env.CI = 'true';

TestingHelpers.setDefaultDatabaseConfig({
    MYSQL_HOST: '127.0.0.1',
    MYSQL_PORT: 3308,
    MYSQL_USER: 'root',
    MYSQL_PASSWORD_SECRET: 'secret'
});

export interface MockGitLabState {
    /** project_id to report in /api/v4/job responses */
    jobProjectId: number;
    jobRef: string;
    jobSha: string;
    jobTitle: string;
    jobAuthor: string;
    /** access_level to return for project membership lookups */
    membershipAccessLevel: number;
}

export const mockGitLabState: MockGitLabState = {
    jobProjectId: TEST_VCS_PROJECT_ID,
    jobRef: 'main',
    jobSha: '0'.repeat(40),
    jobTitle: 'test commit',
    jobAuthor: 'tester',
    membershipAccessLevel: 40
};

export function startMockGitLab(): Promise<{ port: number; close: () => Promise<void> }> {
    return new Promise(resolve => {
        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
            // GitLab job-token validation
            if (req.url === '/api/v4/job') {
                const token = req.headers['job-token'] as string | undefined;
                if (token !== TEST_CI_TOKEN) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(
                    JSON.stringify({
                        id: 42,
                        ref: mockGitLabState.jobRef,
                        pipeline: { project_id: mockGitLabState.jobProjectId, sha: mockGitLabState.jobSha },
                        commit: { title: mockGitLabState.jobTitle, author_name: mockGitLabState.jobAuthor }
                    })
                );
                return;
            }

            // GitLab project membership lookup
            const membersMatch = req.url?.match(/^\/api\/v4\/projects\/(\d+)\/members\/all\/(.+)$/);
            if (membersMatch) {
                if (mockGitLabState.membershipAccessLevel === 0) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ id: membersMatch[2], access_level: mockGitLabState.membershipAccessLevel }));
                return;
            }

            res.writeHead(404);
            res.end('Not found');
        });

        server.listen(0, () => {
            const port = (server.address() as { port: number }).port;
            resolve({
                port,
                close: () => new Promise<void>(res => server.close(() => res()))
            });
        });
    });
}
