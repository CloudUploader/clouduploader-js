import nock from 'nock';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CloudUploader } from '../src/client';
import { AuthenticationError, FileNotFoundError } from '../src/exceptions';

const BASE = 'http://test-api.local';
const API_KEY = 'ck_test_abc';

describe('CloudUploader SDK', () => {
    let uploader: CloudUploader;
    let tempDir: string;

    beforeEach(() => {
        uploader = new CloudUploader(API_KEY, { baseUrl: BASE });
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-uploader-'));
    });

    afterEach(() => {
        nock.cleanAll();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('direct upload success', async () => {
        const filePath = path.join(tempDir, 'test.txt');
        fs.writeFileSync(filePath, 'Hello World');

        nock(BASE)
            .post('/api/upload/iaas/create')
            .reply(200, {
                success: true,
                upload_id: 'up_001',
                key: 'test.txt',
                mode: 'direct',
                presigned_url: 'https://s3.example.com/put-here'
            });

        nock('https://s3.example.com')
            .put('/put-here', 'Hello World')
            .reply(200, '', { ETag: '"etag1"' });

        nock(BASE)
            .post('/api/upload/iaas/complete', { upload_id: 'up_001' })
            .reply(200, {
                success: true,
                storage: 'r2',
                storagePath: 'r2://bucket/test.txt'
            });

        const result = await uploader.uploadFile(filePath);
        expect(result.upload_id).toBe('up_001');
        expect(result.mode).toBe('direct');
        expect(result.storage_path).toBe('r2://bucket/test.txt');
    });

    test('folder upload concurrency', async () => {
        const fileA = path.join(tempDir, 'a.txt');
        const fileB = path.join(tempDir, 'b.txt');
        fs.writeFileSync(fileA, 'A');
        fs.writeFileSync(fileB, 'B');

        // Allow concurrent setup using nock
        nock(BASE)
            .post('/api/upload/iaas/create')
            .times(2)
            .reply(200, {
                success: true,
                upload_id: 'up_folder',
                key: 'x',
                mode: 'direct',
                presigned_url: 'https://s3.example.com/put'
            });

        nock('https://s3.example.com')
            .put('/put')
            .times(2)
            .reply(200);

        nock(BASE)
            .post('/api/upload/iaas/complete')
            .times(2)
            .reply(200, { success: true });

        const result = await uploader.uploadFolder(tempDir);
        expect(result.total_files).toBe(2);
        expect(result.succeeded).toBe(2);
        expect(result.failed).toBe(0);
    });

    test('error authentication', async () => {
        const filePath = path.join(tempDir, 'fail.txt');
        fs.writeFileSync(filePath, 'Fail');

        nock(BASE)
            .post('/api/upload/iaas/create')
            .reply(401, { error: 'UNAUTHORIZED', message: 'Invalid key' });

        await expect(uploader.uploadFile(filePath)).rejects.toThrow(AuthenticationError);
    });

    test('file not found error', async () => {
        await expect(uploader.uploadFile('/invalid/path')).rejects.toThrow(FileNotFoundError);
    });
});
