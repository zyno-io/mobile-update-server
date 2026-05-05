import { openAsBlob } from 'node:fs';

import type { ICIJobInfo } from './ci.js';

import { AppError } from './error.js';

export type TargetPlatform = 'ios' | 'android';
export type AssetPlatform = TargetPlatform | 'all';

export interface ICreateUpdateInput {
    runtimeVersion: string;
    otaVersion?: string | null;
    platform: TargetPlatform;
    expoConfig: Record<string, unknown>;
    metadata: Record<string, unknown>;
}

export interface ICreateUpdateResponse {
    id: string;
    status: string;
}

export interface IUploadAssetParams {
    filePath: string;
    key: string;
    platform: AssetPlatform;
    isLaunchAsset: boolean;
    fileExtension?: string;
    contentType?: string;
}

export interface IUpdateResponse {
    id: string;
    status: string;
    platform: TargetPlatform;
    commitHash: string;
}

export class MobileUpdateApi {
    private serverUrl: string;
    private appId: string;
    private channelId: string;
    private ciToken: string;

    constructor(serverUrl: string, appId: string, channelId: string, jobInfo: ICIJobInfo) {
        this.serverUrl = serverUrl.replace(/\/+$/, '');
        this.appId = appId;
        this.channelId = channelId;
        this.ciToken = jobInfo.ciToken;
    }

    private async request<T>(method: string, path: string, body?: Record<string, unknown> | FormData): Promise<T> {
        const isJson = body && !(body instanceof FormData);
        const response = await fetch(`${this.serverUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${this.ciToken}`,
                ...(isJson && { 'Content-Type': 'application/json' })
            },
            body: isJson ? JSON.stringify(body) : (body as FormData | undefined)
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new AppError(`API ${method} ${path} failed: ${response.status} ${response.statusText} | ${text}`);
        }

        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
    }

    async createUpdate(input: ICreateUpdateInput): Promise<ICreateUpdateResponse> {
        return this.request<ICreateUpdateResponse>(
            'POST',
            `/api/apps/${this.appId}/channels/${this.channelId}/updates`,
            input as unknown as Record<string, unknown>
        );
    }

    async uploadAsset(updateId: string, params: IUploadAssetParams): Promise<void> {
        const blob = await openAsBlob(params.filePath, { type: params.contentType });
        const form = new FormData();
        form.append('file', blob, params.key);
        form.append('key', params.key);
        form.append('platform', params.platform);
        form.append('isLaunchAsset', String(params.isLaunchAsset));
        if (params.fileExtension) form.append('fileExtension', params.fileExtension);
        if (params.contentType) form.append('contentType', params.contentType);

        await this.request<{ id: string }>('POST', `/api/apps/${this.appId}/channels/${this.channelId}/updates/${updateId}/assets`, form);
    }

    async finalize(updateId: string): Promise<IUpdateResponse> {
        return this.request<IUpdateResponse>('POST', `/api/apps/${this.appId}/channels/${this.channelId}/updates/${updateId}/finalize`);
    }

    async cancelDraft(updateId: string): Promise<void> {
        await this.request<{ ok: true }>('POST', `/api/apps/${this.appId}/channels/${this.channelId}/updates/${updateId}/cancel-draft`);
    }

    async promoteUpdate(updateId: string, target?: 'canary' | 'released'): Promise<IUpdateResponse> {
        return this.request<IUpdateResponse>('POST', `/api/apps/${this.appId}/channels/${this.channelId}/updates/${updateId}/promote-ci`, { target });
    }

    async promoteCurrentCommit(target?: 'canary' | 'released'): Promise<IUpdateResponse[]> {
        return this.request<IUpdateResponse[]>('POST', `/api/apps/${this.appId}/channels/${this.channelId}/updates/promote-ci`, { target });
    }

    async recordBinaryBuild(input: {
        platform: TargetPlatform;
        binaryVersion: string;
        fingerprint: string;
    }): Promise<{ id: string; binaryVersion: string; fingerprint: string }> {
        return this.request('POST', `/api/apps/${this.appId}/channels/${this.channelId}/binary-builds`, input as unknown as Record<string, unknown>);
    }
}
