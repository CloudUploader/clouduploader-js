# CloudUploader JavaScript SDK

[![npm version](https://badge.fury.io/js/%40clouduploader%2Fclouduploader-js.svg)](https://www.npmjs.com/package/@clouduploader/clouduploader-js)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A highly-concurrent, low-latency JavaScript/TypeScript SDK for the **CloudUploader** platform. 

This SDK natively interfaces with CloudUploader endpoints (`/api/upload/iaas/create`, `/complete`, etc.) to provide extreme performance for single files and massively parallel directory structures via chunked, multipart processing. Designed rigorously for Node.js, it bounds I/O aggressively without exhausting the V8 Garbage Collector or HTTP sockets.

## Features

| Feature | Details |
|---|---|
| **Simple API** | Upload any file or folder with one method call. |
| **P-Map Concurrency** | Safely controls concurrent execution boundaries for folder uploads without exhausting the Node Event Loop (unlike naive `Promise.all`). |
| **TCP Optimizations** | Pre-bundled with `http.Agent` pushing `{ maxSockets: 100, keepAlive: true }` to eliminate socket acquisition freezes on large batch transactions. |
| **Multipart & Direct Routing** | Submits small files directly via PUT, whilst dynamically chunking large files across parallel streaming threads. |
| **TypeScript Native** | Compile-time typings shipped right out of the box (`ES2022`). |
| **Config-Driven** | Centralized configuration via `config.json` for easy management across environments. |
| **Comprehensive Error Handling** | Precise error types for robust error handling in production. |
| **Progress Tracking** | Real-time upload/download progress callbacks. |

---

## Installation

Install the package from npm:

```bash
npm install @clouduploader/clouduploader-js
```

Or with yarn:

```bash
yarn add @clouduploader/clouduploader-js
```

---

## Quick Start

Initialize the `CloudUploader` client in your application:

```typescript
import { CloudUploader } from '@clouduploader/clouduploader-js';

const uploader = new CloudUploader('ck_live_xxx', {
    baseUrl: 'http://localhost:8080',   // Root backend (loaded from config.json by default)
    maxParallelUploads: 5,              // Dynamic concurrency limit (default: 5)
    storage: 'r2',                      // Cloud target (r2, s3, azure, minio, gcs)
    maxRetries: 3,                      // Exponential backoff attempts
    timeout: 30000                      // Request timeout in ms
});
```

---

## Configuration

### Via Environment/Options

The SDK supports both configuration file and runtime options:

```typescript
import { CloudUploader } from '@clouduploader/clouduploader-js';

const uploader = new CloudUploader('ck_live_xxx', {
    baseUrl: 'https://api.clouduploader.com',  // Override config.json
    maxParallelUploads: 10,
    storage: 's3',
    maxRetries: 5,
    timeout: 45000,
    chunkSizeOverride: 5242880 // 5MB chunks
});
```

### Via config.json

Create a `config.json` in your project root:

```json
{
  "baseUrl": "http://localhost:8080"
}
```

The SDK will automatically read this file when no `baseUrl` is provided in options.

---

## Usage Examples

### 1. Single File Upload

### 1. Single File Upload

Upload a singular file seamlessly. The orchestrator will automatically negotiate direct routing vs parallel chunked sequences if the file is massive!

```typescript
async function uploadMyVideo() {
    try {
        const result = await uploader.uploadFile('./assets/video.mp4');
        console.log(`Success! File stored at: ${result.storage_path}`);
        // -> "r2://my-bucket/ab/cd/video.mp4"
    } catch (err) {
        console.error("Upload failed", err);
    }
}

uploadMyVideo();
```

#### Progress Tracking

Monitor upload progress in real-time:

```typescript
const result = await uploader.uploadFile(
    './assets/very_large_dataset.csv', 
    (uploadedBytes, totalBytes) => {
        const pct = (uploadedBytes / totalBytes) * 100;
        process.stdout.write(`\rProgress: ${pct.toFixed(1)}%`);
    }
);
```

#### Storage Override

Push a specific file to a different storage backend:

```typescript
const result = await uploader.uploadFile(
    './assets/backup.zip',
    undefined,
    's3'  // Override default storage for this upload
);
```

---

### 2. Mass Folder Upload (High Concurrency)

Rapidly sync an entire directory recursively to the backend. Files are mapped via internal concurrency throttling (`p-map`), ensuring low latency network scheduling.

```typescript
async function backupAssets() {
    const result = await uploader.uploadFolder(
        './dist/assets',
        '*.{png,jpg,gif}',  // Glob matching (optional)
        true,               // Skip hidden files (optional)
        's3'                // Storage override (optional)
    );
    
    console.log(`Pushed ${result.succeeded}/${result.total_files} successfully.`);
    if (result.failures.length > 0) {
        console.warn(`Encountered ${result.failed} issues:`, result.failures);
    }
}

backupAssets();
```

**Response Structure:**

```typescript
{
    source_folder: string;
    results: UploadResult[];
    failures: FolderUploadFailure[];
    total_files: number;
    succeeded: number;
    failed: number;
}
```

---

### 3. Downloading Files

Fetch massive streams without crashing memory using built-in piping endpoints!

```typescript
async function downloadAsset() {
    const localPath = await uploader.downloadFile(
        'file_abc123', 
        './downloads/file.jpg',
        (downloaded, total) => {
            const progress = ((downloaded / total) * 100).toFixed(1);
            console.log(`Downloaded: ${progress}%`);
        }
    );
    console.log(`File saved at: ${localPath}`);
}

downloadAsset();
```

---

### 4. Status Tracking & Interruption

Check or forcibly kill a multipart upload mid-execution:

```typescript
// Query upload status
const status = await uploader.getUploadStatus('upload_id_123');
console.log(status);

// Abort upload
await uploader.abortUpload('upload_id_123');
```

---

## API Reference

### CloudUploader Class

#### Constructor

```typescript
constructor(apiKey: string, options?: CloudUploaderOptions)
```

**Parameters:**
- `apiKey` (string): Your CloudUploader API key (required)
- `options` (CloudUploaderOptions): Configuration options (optional)

#### Methods

##### `uploadFile(filePath, progressCallback?, storageOverride?)`

Upload a single file.

```typescript
uploadFile(
    filePath: string,
    progressCallback?: (uploadedBytes: number, totalBytes: number) => void,
    storageOverride?: string
): Promise<UploadResult>
```

##### `uploadFolder(folderPath, fileFilter?, skipHidden?, storageOverride?)`

Upload entire folder with concurrency control.

```typescript
uploadFolder(
    folderPath: string,
    fileFilter?: string,
    skipHidden?: boolean,
    storageOverride?: string
): Promise<FolderUploadResult>
```

##### `downloadFile(fileId, outputPath, progressCallback?)`

Download a file to local filesystem.

```typescript
downloadFile(
    fileId: string,
    outputPath: string,
    progressCallback?: (downloadedBytes: number, totalBytes: number) => void
): Promise<string>
```

##### `getUploadStatus(uploadId)`

Get status of an active upload.

```typescript
getUploadStatus(uploadId: string): Promise<any>
```

##### `abortUpload(uploadId)`

Cancel an active multipart upload.

```typescript
abortUpload(uploadId: string): Promise<any>
```

##### `close()`

Clean up resources.

```typescript
close(): void
```

---

## Type Definitions

### CloudUploaderOptions

```typescript
interface CloudUploaderOptions {
    baseUrl?: string;                  // API endpoint URL
    timeout?: number;                  // Request timeout in ms
    maxRetries?: number;               // Retry attempts
    maxParallelUploads?: number;       // Concurrent upload limit
    chunkSizeOverride?: number;        // Custom chunk size in bytes
    storage?: string;                  // Storage backend (r2, s3, etc.)
}
```

### UploadResult

```typescript
interface UploadResult {
    file_id: string;
    storage_path: string;
    size: number;
    timestamp: string;
}
```

### FolderUploadResult

```typescript
interface FolderUploadResult {
    source_folder: string;
    results: UploadResult[];
    failures: FolderUploadFailure[];
    total_files: number;
    succeeded: number;
    failed: number;
}
```

### FolderUploadFailure

```typescript
interface FolderUploadFailure {
    file_path: string;
    error: string;
}
```

---

## Error Handling

The SDK provides specific error types for precise error handling:

```typescript
import { 
    FileNotFoundError, 
    DownloadError,
    AuthenticationError,
    UploadFailedError 
} from '@clouduploader/clouduploader-js';

try {
    await uploader.uploadFile('mission_critical.pdf');
} catch (err) {
    if (err instanceof FileNotFoundError) {
        console.error("File does not exist locally:", err.message);
    } else if (err instanceof DownloadError) {
        console.error("Download failed:", err.message);
    } else if (err instanceof AuthenticationError) {
        console.error("Invalid API key. Check your credentials.");
    } else if (err instanceof UploadFailedError) {
        console.error("Upload failed:", err.message);
    } else {
        console.error("Unexpected error:", err);
    }
}
```

### Available Error Types

| Error | Description |
|---|---|
| `FileNotFoundError` | File or folder path does not exist |
| `DownloadError` | Download operation failed |
| `AuthenticationError` | Invalid or missing API credentials |
| `UploadFailedError` | Upload operation encountered fatal error |

---

## Storage Backends

The SDK supports multiple cloud storage backends:

| Backend | Code | Notes |
|---|---|---|
| Cloudflare R2 | `r2` | Default |
| Amazon S3 | `s3` | AWS-compatible |
| Azure Blob Storage | `azure` | Microsoft Cloud |
| MinIO | `minio` | Self-hosted S3-compatible |
| Google Cloud Storage | `gcs` | Google Cloud |

---

## Production Best Practices

### 1. Environment Configuration

```typescript
const uploader = new CloudUploader(
    process.env.CLOUDUPLOADER_API_KEY!,
    {
        baseUrl: process.env.CLOUDUPLOADER_BASE_URL || 'http://localhost:8080',
        maxParallelUploads: parseInt(process.env.MAX_PARALLEL_UPLOADS || '5'),
        timeout: parseInt(process.env.REQUEST_TIMEOUT || '30000'),
        maxRetries: parseInt(process.env.MAX_RETRIES || '3')
    }
);
```

### 2. Retry Logic

```typescript
async function uploadWithRetry(filePath: string, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await uploader.uploadFile(filePath);
        } catch (err) {
            if (attempt === maxAttempts) throw err;
            const delay = Math.pow(2, attempt - 1) * 1000;
            console.log(`Retry attempt ${attempt} after ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}
```

### 3. Resource Cleanup

```typescript
process.on('exit', () => {
    uploader.close();
});
```

---

## Requirements

- **Node.js**: >= 14.0.0
- **npm**: >= 6.0.0
- **TypeScript**: >= 4.0.0 (for TypeScript projects)

---

## Development

### Setup

```bash
git clone https://github.com/CloudUploader/clouduploader-js.git
cd clouduploader-js
npm install
```

### Build

```bash
npm run build
```

### Testing

```bash
npm test
```

### Type Checking

```bash
npx tsc --noEmit
```

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request to the [GitHub repository](https://github.com/CloudUploader/clouduploader-js).

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Support

For issues, questions, or feature requests, please open an issue on the [GitHub repository](https://github.com/CloudUploader/clouduploader-js/issues).

### Resources

- [GitHub Repository](https://github.com/CloudUploader/clouduploader-js)
- [npm Package](https://www.npmjs.com/package/@clouduploader/clouduploader-js)
- [HTTP Client](./src/httpClient.ts)
- [Multipart Upload](./src/multipart.ts)

---

## Changelog

See [CHANGELOG](./CHANGELOG.md) for version history.

---

## Authors

**CloudUploader Team**
```
