import * as path from 'path';
import * as fs from 'fs';
import { glob } from 'glob';
import pMap from 'p-map';
import { HttpClient } from './httpClient';
import { UploadOrchestrator } from './uploader';
import { ProgressCallback } from './multipart';
import { UploadResult, FolderUploadResult, FolderUploadFailure } from './types';
import { FileNotFoundError, DownloadError } from './exceptions';
import { getBaseUrl } from './config';

export interface CloudUploaderOptions {
    baseUrl?: string;
    timeout?: number;
    maxRetries?: number;
    maxParallelUploads?: number;
    chunkSizeOverride?: number;
    storage?: string;
}

export class CloudUploader {
    private http: HttpClient;
    private orchestrator: UploadOrchestrator;
    public storage: string;
    public maxParallelUploads: number;

    constructor(apiKey: string, options: CloudUploaderOptions = {}) {
        if (!apiKey) throw new Error('API key is required');

        const baseUrl = getBaseUrl(options.baseUrl);
        this.maxParallelUploads = options.maxParallelUploads || 5;
        this.storage = options.storage || 'r2';

        this.http = new HttpClient(apiKey, baseUrl, options.timeout, options.maxRetries);
        this.orchestrator = new UploadOrchestrator(
            this.http,
            this.maxParallelUploads,
            options.chunkSizeOverride,
            this.storage
        );
    }

    public async uploadFile(
        filePath: string,
        progressCallback?: ProgressCallback,
        storageOverride?: string
    ): Promise<UploadResult> {
        return this.orchestrator.upload(filePath, progressCallback, storageOverride);
    }

    public async uploadFolder(
        folderPath: string,
        fileFilter = '*',
        skipHidden = true,
        storageOverride?: string
    ): Promise<FolderUploadResult> {
        const absFolder = path.resolve(folderPath);
        try {
            const stats = await fs.promises.stat(absFolder);
            if (!stats.isDirectory()) {
                throw new FileNotFoundError(`Path is not a directory: ${folderPath}`);
            }
        } catch (err: any) {
            throw new FileNotFoundError(`Folder not found: ${folderPath}`);
        }

        const pattern = path.join(absFolder, '**', fileFilter).replace(/\\/g, '/');
        const matches = await glob(pattern, { nodir: true, dot: !skipHidden });

        const filesToUpload = matches.filter(file => {
            if (skipHidden) {
                const rel = path.relative(absFolder, file);
                const parts = rel.split(path.sep);
                if (parts.some(p => p.startsWith('.'))) return false;
            }
            return true;
        });

        const totalFiles = filesToUpload.length;
        const results: UploadResult[] = [];
        const failures: FolderUploadFailure[] = [];

        await pMap(
            filesToUpload,
            async (filePath) => {
                try {
                    const res = await this.uploadFile(filePath, undefined, storageOverride);
                    results.push(res);
                } catch (err: any) {
                    failures.push({ file_path: filePath, error: err.message });
                }
            },
            { concurrency: this.maxParallelUploads }
        );

        return {
            source_folder: absFolder,
            results,
            failures,
            total_files: totalFiles,
            succeeded: results.length,
            failed: failures.length
        };
    }

    public async downloadFile(
        fileId: string,
        outputPath: string,
        progressCallback?: ProgressCallback
    ): Promise<string> {
        const absOut = path.resolve(outputPath);
        let downloadUrl = '';

        try {
            const meta = await this.http.get('/file/download', { fileId });
            downloadUrl = meta.url || meta.presigned_url || '';
            if (!downloadUrl) throw new DownloadError(`No download URL returned for fileId=${fileId}`);
        } catch (err) {
            throw err;
        }

        const resp = await this.http.downloadStream(downloadUrl);
        const total = parseInt(resp.headers['content-length'] || '0', 10);
        let downloaded = 0;

        await fs.promises.mkdir(path.dirname(absOut), { recursive: true });

        return new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(absOut);
            resp.data.pipe(writer);

            resp.data.on('data', (chunk: Buffer) => {
                downloaded += chunk.length;
                if (progressCallback) {
                    try { progressCallback(downloaded, total); } catch (e) {}
                }
            });

            writer.on('finish', () => resolve(absOut));
            writer.on('error', reject);
            resp.data.on('error', reject);
        });
    }

    public async getUploadStatus(uploadId: string): Promise<any> {
        return this.orchestrator.status(uploadId);
    }

    public async abortUpload(uploadId: string): Promise<any> {
        return this.orchestrator.abort(uploadId);
    }

    public close(): void {
        // cleanup resources if required
    }
}
