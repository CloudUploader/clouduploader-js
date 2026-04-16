export class CloudUploaderError extends Error {
    public error_code?: string;
    public status_code?: number;

    constructor(message: string, error_code?: string, status_code?: number) {
        super(message);
        this.name = 'CloudUploaderError';
        this.error_code = error_code;
        this.status_code = status_code;
    }
}

export class AuthenticationError extends CloudUploaderError {
    constructor(message: string, error_code?: string, status_code?: number) {
        super(message, error_code, status_code);
        this.name = 'AuthenticationError';
    }
}

export class UploadInitError extends CloudUploaderError {
    constructor(message: string, error_code?: string, status_code?: number) {
        super(message, error_code, status_code);
        this.name = 'UploadInitError';
    }
}

export class UploadFailedError extends CloudUploaderError {
    public failed_parts: number[];
    public upload_id?: string;

    constructor(message: string, error_code?: string, status_code?: number, failed_parts: number[] = [], upload_id?: string) {
        super(message, error_code, status_code);
        this.name = 'UploadFailedError';
        this.failed_parts = failed_parts;
        this.upload_id = upload_id;
    }
}

export class DownloadError extends CloudUploaderError {
    constructor(message: string, error_code?: string, status_code?: number) {
        super(message, error_code, status_code);
        this.name = 'DownloadError';
    }
}

export class FileNotFoundError extends CloudUploaderError {
    constructor(message: string, error_code?: string, status_code?: number) {
        super(message, error_code, status_code);
        this.name = 'FileNotFoundError';
    }
}
