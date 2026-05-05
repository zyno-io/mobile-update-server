export function buildUpdateUrl(serverUrl: string, appId: string, channelId: string, updateId: string): string {
    const base = serverUrl.replace(/\/+$/, '');
    return `${base}/apps/${appId}/channels/${channelId}/updates/${updateId}`;
}
