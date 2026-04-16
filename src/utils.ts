import * as fs from 'fs';
import * as path from 'path';
import mime from 'mime-types';
import { FileNotFoundError } from './exceptions';

export function guessContentType(filename: string): string {
    const type = mime.lookup(filename);
    return type ? type : 'application/octet-stream';
}

export function sanitizeFilename(filePath: string): string {
    return path.basename(filePath);
}

export function formatBytes(n: number): string {
    let bytes = n;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    for (const unit of units) {
        if (Math.abs(bytes) < 1024.0) {
            return `${bytes.toFixed(2)} ${unit}`;
        }
        bytes /= 1024.0;
    }
    return `${bytes.toFixed(2)} PB`;
}

export async function validateFile(filePath: string): Promise<{ absPath: string; size: number }> {
    const p = path.resolve(filePath);
    try {
        const stats = await fs.promises.stat(p);
        if (!stats.isFile()) {
            throw new FileNotFoundError(`Path is not a regular file: ${filePath}`);
        }
        return { absPath: p, size: stats.size };
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            throw new FileNotFoundError(`File not found: ${filePath}`);
        }
        throw err;
    }
}
