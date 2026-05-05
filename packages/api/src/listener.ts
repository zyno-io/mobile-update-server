import { eventDispatcher } from '@deepkit/event';
import { httpWorkflow } from '@deepkit/http';
import { ScopedLogger } from '@deepkit/logger';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import mime from 'mime-types';
import { resolve, sep } from 'path';

export class StaticContentListener {
    private staticBase = resolve('./static');

    constructor(private logger: ScopedLogger) {}

    @eventDispatcher.listen(httpWorkflow.onRouteNotFound, 10)
    async routeNotFound(event: typeof httpWorkflow.onRouteNotFound.event) {
        if (event.sent) return;
        if (event.hasNext()) return;

        if (event.request.method !== 'GET') return;

        let url = event.request.url?.replace(/\?.*$/, '') ?? '/';
        url = url === '/' ? '/index.html' : url;

        let staticPath = `./static${url}`;
        staticPath = resolve(staticPath);

        // Reject anything outside the static dir. Prefix-match alone allows a sibling
        // like `/app/staticOther` to satisfy startsWith('/app/static'); require the
        // separator (or exact match) to anchor inside the dir.
        if (staticPath !== this.staticBase && !staticPath.startsWith(this.staticBase + sep)) {
            return event.send(new Response('Bad request', { status: 400 }));
        }

        let fileSize: number | undefined;
        try {
            const fileStat = await stat(staticPath);
            fileSize = fileStat.size;
        } catch (e) {
            if (!(e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT')) {
                return event.send(new Response('Server error', { status: 500 }));
            }
            staticPath = `${this.staticBase}/index.html`;
        }

        const contentType = mime.lookup(staticPath) || 'application/octet-stream';

        return new Promise<void>((resolve, reject) => {
            const fileStream = createReadStream(staticPath);

            fileStream.on('error', err => {
                this.logger.error('Error reading file', err);
                reject(new Response('Server error', { status: 500 }));
            });
            event.response.on('error', err => {
                this.logger.error('Error sending response', err);
            });

            event.response.writeHead(200, {
                ...(fileSize && { 'Content-Length': fileSize.toString() }),
                ...(contentType && { 'Content-Type': contentType })
            });
            fileStream.pipe(event.response);
            fileStream.on('end', () => resolve());
        });
    }
}
