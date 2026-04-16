# CloudUploader JavaScript SDK

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

---

## Installation

As this package scales rapidly, initialize it directly into your Node project.

```bash
cd my-app
npm install /home/rafeeque/Rafeeque/cloudUploader/sdk/javascriptSDK
```
*(Or link it locally based on your repository setup).*

---

## Configuration

Initialize the `CloudUploader` client inside your application.

```typescript
import { CloudUploader } from 'cloud_uploader'; // standard import mapping 

const uploader = new CloudUploader('ck_live_xxx', {
    baseUrl: 'http://localhost:8080',   // Root backend (default: http://localhost:8080)
    maxParallelUploads: 5,              // Dynamic concurrency limit (default: 5)
    storage: 'r2',                      // Cloud target (r2, s3, azure, minio, gcs)
    maxRetries: 3,                      // Exponential backoff attempts
    timeout: 30000                      // Request timeout overhead
});
```

---

## 1. Single File Upload

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
```

### Progress Tracking
You can attach an optional callback to hook into raw UI streams.

```typescript
const result = await uploader.uploadFile(
    './assets/very_large_dataset.csv', 
    (uploadedBytes, totalBytes) => {
        const pct = (uploadedBytes / totalBytes) * 100;
        process.stdout.write(`\rProgress: ${pct.toFixed(1)}%`);
    }
);
```

---

## 2. Mass Folder Upload (High Concurrency)

Rapidly sync an entire directory recursively to the backend. Files are mapped via internal concurrency throttling (`p-map`), ensuring low latency network scheduling.

```typescript
async function backupAssets() {
    const result = await uploader.uploadFolder('./dist/assets', {
        fileFilter: '*.{png,jpg}',  // Glob matching (optional)
        skipHidden: true,           // Avoid .DS_Store / dotfiles (optional)
        storageOverride: 's3'       // Push this specific folder somewhere else!
    });
    
    console.log(`Pushed ${result.succeeded}/${result.total_files} successfully.`);
    if (result.failures.length > 0) {
        console.warn(`Encountered ${result.failed} issues:`, result.failures);
    }
}
```

---

## 3. Downloading Files

Fetch massive streams without crashing memory using built-in piping endpoints!

```typescript
async function downloadAsset() {
    const localPath = await uploader.downloadFile(
        'file_abc123', 
        './downloads/file.jpg',
        (downloaded, total) => console.log(`Pulled ${downloaded} bytes`)
    );
    console.log(`File saved securely at ${localPath}`);
}
```

---

## 4. Status Tracking & Interruption

Check or forcibly kill a multipart upload mid-execution:

```typescript
// Query the IaaS logic state
const statusResponse = await uploader.getUploadStatus('up_abc123');
console.log(statusResponse);

// Panic abort
await uploader.abortUpload('up_abc123');
```

---

## Error Handling

Extensive error hierarchies let you trap precise business logic bounds!

```typescript
import { AuthenticationError, FileNotFoundError, UploadFailedError } from 'cloud_uploader';

try {
    await uploader.uploadFile('mission_critical.pdf');
} catch (err) {
    if (err instanceof AuthenticationError) {
        console.error("Check your API key validity!");
    } else if (err instanceof FileNotFoundError) {
        console.error("The file requested does not exist locally.");
    } else if (err instanceof UploadFailedError) {
        console.error(`Parts completely failed to map: ${err.failed_parts}`);
    } else {
        console.error(`Generic network issue: ${err.message}`);
    }
}
```
