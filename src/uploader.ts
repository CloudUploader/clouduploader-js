import * as fs from 'fs';
import * as os from 'os';
import { HttpClient } from './httpClient';
import { UploadInitError, UploadFailedError } from './exceptions';
import { MultipartUploadEngine, ProgressCallback } from './multipart';
import { UploadResult } from './types';
import { validateFile, sanitizeFilename, guessContentType } from './utils';

export class UploadOrchestrator {
    private http: HttpClient;
    public maxWorkers: number;
    private chunkOverride?: number;
    private defaultStorage: string;
    private networkMbps?: number;

    constructor(
        http: HttpClient,
        maxWorkers = 5,
        chunkOverride?: number,
        defaultStorage = 'r2',
        networkMbps?: number
    ) {
        this.http = http;
        this.maxWorkers = maxWorkers;
        this.chunkOverride = chunkOverride;
        this.defaultStorage = defaultStorage;
        this.networkMbps = networkMbps;
    }

    public async upload(
        filePath: string,
        progressCallback?: ProgressCallback,
        storage?: string
    ): Promise<UploadResult> {
        const { absPath, size: fileSize } = await validateFile(filePath);
        const filename = sanitizeFilename(absPath);
        const chosenStorage = storage || this.defaultStorage;

        // 1. Initialize upload
        const initResp = await this.initUpload(filename, fileSize, chosenStorage);
        const uploadId: string = initResp.upload_id;
        const key: string = initResp.key;
        const mode: string = initResp.mode || 'direct';

        let parts: any[] | undefined = undefined;

        // 2. Transmit data
        try {
            if (mode === 'multipart') {
                parts = await this.doMultipart(absPath, fileSize, initResp, progressCallback);
            } else {
                await this.doDirect(absPath, fileSize, initResp, progressCallback);
            }
        } catch (err) {
            await this.safeAbort(uploadId);
            throw err;
        }

        // 3. Complete
        const completeResp = await this.completeUpload(uploadId, mode, parts);

        return {
            upload_id: uploadId,
            key: key,
            storage: completeResp.storage || chosenStorage,
            storage_path: completeResp.storagePath || '',
            mode: mode as any
        };
    }

    public async status(uploadId: string): Promise<any> {
        return this.http.get(`/api/upload/iaas/status/${uploadId}`);
    }

    public async abort(uploadId: string): Promise<any> {
        return this.http.postJson('/api/upload/iaas/abort', { upload_id: uploadId });
    }

    /** Request fresh presigned URLs for specific failed parts without restarting the upload. */
    public async retry(uploadId: string, failedParts: number[]): Promise<any> {
        return this.http.postJson('/api/upload/iaas/retry', { upload_id: uploadId, failed_parts: failedParts });
    }

    private async safeAbort(uploadId: string): Promise<void> {
        try {
            await this.abort(uploadId);
        } catch {
            // ignore
        }
    }

    private async initUpload(filename: string, fileSize: number, storage: string): Promise<any> {
        const payload: any = {
            filename,
            size: fileSize,
            storage,
            cpu_threads: os.cpus().length,
        };
        if (this.networkMbps !== undefined) {
            payload.network_mbps = this.networkMbps;
        }
        try {
            const resp = await this.http.postJson('/api/upload/iaas/create', payload);
            if (!resp.success) {
                throw new UploadInitError(resp.message || 'Init rejected', resp.error);
            }
            return resp;
        } catch (err: any) {
            if (err instanceof UploadInitError) throw err;
            if (err.name === 'AuthenticationError') throw err;
            throw new UploadInitError(`Failed to initialize: ${err.message}`, err.error_code, err.status_code);
        }
    }

    private async doDirect(
        filePath: string,
        fileSize: number,
        initResp: any,
        progressCallback?: ProgressCallback
    ): Promise<void> {
        const url = initResp.presigned_url;
        const contentType = guessContentType(filePath);
        await this.http.putBinary(url, () => fs.createReadStream(filePath), contentType, fileSize);
        if (progressCallback) {
            try { progressCallback(fileSize, fileSize); } catch {}
        }
    }

    private async doMultipart(
        filePath: string,
        fileSize: number,
        initResp: any,
        progressCallback?: ProgressCallback
    ): Promise<any[]> {
        const uploadId: string = initResp.upload_id;
        const chunkSize = this.chunkOverride || initResp.chunk_size;
        const presignedUrls = initResp.presigned_urls;
        const parallelism = Math.min(this.maxWorkers, initResp.part_parallelism || this.maxWorkers);
        const contentType = guessContentType(filePath);

        const engine = new MultipartUploadEngine(
            this.http, filePath, fileSize, chunkSize, presignedUrls, parallelism, progressCallback, contentType
        );

        let result = await engine.execute();

        // Retry failed parts once via /retry (gets fresh presigned URLs, no new multipart init)
        if (result.failedParts.length > 0) {
            let retryResp: any;
            try {
                retryResp = await this.retry(uploadId, result.failedParts);
            } catch (err: any) {
                throw new UploadFailedError(
                    `${result.failedParts.length} parts failed and /retry call failed: ${err.message}`,
                    err.error_code, err.status_code, result.failedParts, uploadId
                );
            }
            if (!retryResp.success) {
                throw new UploadFailedError(
                    `Retry init rejected: ${retryResp.message || retryResp.error}`,
                    retryResp.error, undefined, result.failedParts, uploadId
                );
            }

            const retryResult = await engine.uploadRetryParts(retryResp.retry_urls);
            if (retryResult.failedParts.length > 0) {
                throw new UploadFailedError(
                    `${retryResult.failedParts.length} parts still failed after retry`,
                    undefined, undefined, retryResult.failedParts, uploadId
                );
            }

            // Merge: successful from first pass (excluding retried) + retried
            const retriedNums = new Set(retryResult.completed.map(p => p.part_number));
            result = {
                completed: [
                    ...result.completed.filter(p => !retriedNums.has(p.part_number)),
                    ...retryResult.completed,
                ].sort((a, b) => a.part_number - b.part_number),
                failedParts: [],
            };
        }

        return result.completed;
    }

    private async completeUpload(uploadId: string, mode: string, parts?: any[]): Promise<any> {
        const payload: any = { upload_id: uploadId };
        if (mode === 'multipart' && parts) {
            payload.parts = parts;
        }
        try {
            const resp = await this.http.postJson('/api/upload/iaas/complete', payload);
            if (!resp.success) {
                throw new UploadFailedError(resp.message || 'Complete call rejected', resp.error, undefined, [], uploadId);
            }
            return resp;
        } catch (err: any) {
            if (err instanceof UploadFailedError) throw err;
            throw new UploadFailedError(`Complete call failed: ${err.message}`, err.error_code, err.status_code, [], uploadId);
        }
    }
}
