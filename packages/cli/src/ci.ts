export interface ICIJobInfo {
    projectUrl: string;
    ciToken: string;
}

export function getGitLabCiInfo(): ICIJobInfo | null {
    const { CI_PROJECT_URL, CI_JOB_TOKEN } = process.env;
    if (!CI_PROJECT_URL || !CI_JOB_TOKEN) return null;
    return { projectUrl: CI_PROJECT_URL, ciToken: CI_JOB_TOKEN };
}

export function getJobInfo(): ICIJobInfo | null {
    return getGitLabCiInfo();
}
