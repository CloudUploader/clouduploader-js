import * as fs from 'fs';
import pMap from 'p-map';
import { HttpClient } from './httpClient';

export type ProgressCallback = (uploadedBytes: number, totalBytes: number) => void;

interface PartResult {
    part_number: number;
    etag: string;
    size: number;
}

export interface MultipartResult {
    completed: { part_number: number; etag: string }[];
    failedParts: number[];
}

export class MultipartUploadEngine {
    private uploadedBytes = 0;

    constructor(
        private http: HttpClient,
        private filePath: string,
        private fileSize: number,
        private chunkSize: number,
        private presignedUrls: string[],
        private maxWorkers: number = 5,
        private progressCallback?: ProgressCallback,
        private contentType: string = 'application/octet-stream'
    ) {}

    /** Upload all parts from the initial presigned URL list. */
    public async execute(): Promise<MultipartResult> {
        const numParts = this.presignedUrls.length;
        const urlMap: Record<number, string> = {};
        for (let i = 0; i < numParts; i++) urlMap[i + 1] = this.presignedUrls[i];
        return this._uploadParts(urlMap);
    }

    /** Re-upload only failed parts using new presigned URLs from /retry response.
     *  retryUrlMap keys are string part numbers e.g. { "3": "<url>", "5": "<url>" }
     */
    public async uploadRetryParts(retryUrlMap: Record<string, string>): Promise<MultipartResult> {
        const urlMap: Record<number, string> = {};
        for (const [k, v] of Object.entries(retryUrlMap)) urlMap[Number(k)] = v;
        return this._uploadParts(urlMap);
    }

    private async _uploadParts(urlMap: Record<number, string>): Promise<MultipartResult> {
        const partNumbers = Object.keys(urlMap).map(Number);
        const completed: PartResult[] = [];
        const failedParts: number[] = [];

        await pMap(
            partNumbers,
            async (partNum) => {
                try {
                    const result = await this._uploadPart(partNum, urlMap[partNum]);
                    completed.push(result);
                } catch {
                    failedParts.push(partNum);
                }
            },
            { concurrency: this.maxWorkers }
        );

        return {
            completed: completed
                .sort((a, b) => a.part_number - b.part_number)
                .map(p => ({ part_number: p.part_number, etag: p.etag })),
            failedParts,
        };
    }

    private async _uploadPart(partNumber: number, url: string): Promise<PartResult> {
        const offset = (partNumber - 1) * this.chunkSize;
        const end = Math.min(offset + this.chunkSize, this.fileSize);
        const length = end - offset;

        const dataFactory = () => fs.createReadStream(this.filePath, { start: offset, end: end - 1 });
        const resp = await this.http.putBinary(url, dataFactory, this.contentType, length);
        const etagHeader = resp.headers['etag'] || '';
        const etag = etagHeader.replace(/"/g, '');

        if (this.progressCallback) {
            this.uploadedBytes += length;
            try { this.progressCallback(this.uploadedBytes, this.fileSize); } catch {}
        }

        return { part_number: partNumber, etag, size: length };
    }
}
