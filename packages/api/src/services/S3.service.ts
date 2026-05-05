import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { AppConfig } from '../config';

export class S3Service {
    private s3Client: S3Client;

    constructor(private appConfig: AppConfig) {
        this.s3Client = new S3Client({
            endpoint: appConfig.S3_ENDPOINT,
            region: appConfig.S3_REGION,
            forcePathStyle: true,
            // R2 rejects the SDK v3 default integrity headers with an unparseable 400.
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
            ...(appConfig.S3_ACCESS_KEY_ID &&
                appConfig.S3_ACCESS_SECRET && {
                    credentials: {
                        accessKeyId: appConfig.S3_ACCESS_KEY_ID,
                        secretAccessKey: appConfig.S3_ACCESS_SECRET
                    }
                })
        });
    }

    async uploadBuffer(buffer: Buffer, key: string, contentType: string): Promise<void> {
        await this.s3Client.send(
            new PutObjectCommand({
                Bucket: this.appConfig.S3_BUCKET,
                Key: key,
                ContentType: contentType,
                Body: buffer
            })
        );
    }

    async exists(key: string): Promise<boolean> {
        try {
            await this.s3Client.send(
                new HeadObjectCommand({
                    Bucket: this.appConfig.S3_BUCKET,
                    Key: key
                })
            );
            return true;
        } catch (err) {
            if (err && typeof err === 'object' && '$metadata' in err) {
                const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
                if (meta?.httpStatusCode === 404) return false;
            }
            throw err;
        }
    }

    async deleteFile(key: string): Promise<void> {
        await this.s3Client.send(
            new DeleteObjectCommand({
                Bucket: this.appConfig.S3_BUCKET,
                Key: key
            })
        );
    }

    async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: this.appConfig.S3_BUCKET,
            Key: key
        });
        return getSignedUrl(this.s3Client, command, { expiresIn: expiresInSeconds });
    }

    pathForAsset(appId: string, sha256: string, fileExtension: string): string {
        const ext = fileExtension ? `.${fileExtension.replace(/^\./, '')}` : '';
        return `apps/${appId}/assets/${sha256.substring(0, 2)}/${sha256}${ext}`;
    }
}
