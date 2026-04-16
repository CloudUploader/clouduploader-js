import * as fs from 'fs';
import pMap from 'p-map';
import { HttpClient } from './httpClient';
import { UploadFailedError } from './exceptions';

export type ProgressCallback = (uploadedBytes: number, totalBytes: number) => void;

interface PartResult {
    part_number: number;
    etag: string;
    size: number;
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

    public async execute(): Promise<{ part_number: number; etag: string }[]> {
        const numParts = this.presignedUrls.length;
        const partNumbers = Array.from({ length: numParts }, (_, i) => i + 1);
        
        const parts: PartResult[] = [];
        const failedParts: number[] = [];

        await pMap(
            partNumbers,
            async (partNum) => {
                try {
                    const result = await this.uploadPart(partNum);
                    parts.push(result);
                } catch (err: any) {
                    failedParts.push(partNum);
                }
            },
            { concurrency: this.maxWorkers }
        );

        if (failedParts.length > 0) {
            throw new UploadFailedError(
                `${failedParts.length} of ${numParts} parts failed.`,
                undefined,
                undefined,
                failedParts
            );
        }

        return parts
            .sort((a, b) => a.part_number - b.part_number)
            .map(p => ({ part_number: p.part_number, etag: p.etag }));
    }

    private async uploadPart(partNumber: number): Promise<PartResult> {
        const offset = (partNumber - 1) * this.chunkSize;
        const end = Math.min(offset + this.chunkSize, this.fileSize);
        const length = end - offset;

        const url = this.presignedUrls[partNumber - 1];

        // We use a data factory so it can create a new stream on retry
        const dataFactory = () => fs.createReadStream(this.filePath, { start: offset, end: end - 1 });

        const resp = await this.http.putBinary(url, dataFactory, this.contentType, length);
        const etagHeader = resp.headers['etag'] || '';
        const etag = etagHeader.replace(/"/g, '');

        if (this.progressCallback) {
            this.uploadedBytes += length;
            try {
                this.progressCallback(this.uploadedBytes, this.fileSize);
            } catch (ignore) {}
        }

        return { part_number: partNumber, etag, size: length };
    }
}
