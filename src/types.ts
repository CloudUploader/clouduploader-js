export interface UploadResult {
    upload_id: string;
    key: string;
    storage: string;
    storage_path: string;
    mode: 'direct' | 'multipart';
}

export interface FolderUploadFailure {
    file_path: string;
    error: string;
}

export interface FolderUploadResult {
    source_folder: string;
    results: UploadResult[];
    failures: FolderUploadFailure[];
    total_files: number;
    succeeded: number;
    failed: number;
}
