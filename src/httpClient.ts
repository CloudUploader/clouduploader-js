import axios, { AxiosInstance, AxiosResponse } from 'axios';
import axiosRetry from 'axios-retry';
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import { AuthenticationError, CloudUploaderError } from './exceptions';

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;

export class HttpClient {
    private api_key: string;
    private base_url: string;
    private timeout: number;
    private max_retries: number;
    private session: AxiosInstance;

    constructor(api_key: string, base_url: string, timeout = DEFAULT_TIMEOUT, max_retries = DEFAULT_MAX_RETRIES) {
        this.api_key = api_key;
        this.base_url = base_url.replace(/\/$/, '');
        this.timeout = timeout;
        this.max_retries = max_retries;

        const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
        const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

        this.session = axios.create({
            baseURL: this.base_url,
            timeout: this.timeout,
            httpAgent,
            httpsAgent,
            headers: {
                'Authorization': `Bearer ${this.api_key}`,
                'X-Api-Key': this.api_key,
                'User-Agent': 'cloud-uploader-js/0.1.0'
            }
        });

        axiosRetry(this.session, {
            retries: this.max_retries,
            retryDelay: axiosRetry.exponentialDelay,
            retryCondition: (error) => {
                if (error.response?.status) {
                    return [429, 500, 502, 503, 504].includes(error.response.status);
                }
                return axiosRetry.isNetworkOrIdempotentRequestError(error) || error.code === 'ECONNABORTED';
            }
        });
    }

    public async postJson(path: string, payload: any, timeoutOverride?: number): Promise<any> {
        try {
            const resp = await this.session.post(path, payload, {
                timeout: timeoutOverride || this.timeout
            });
            return resp.data;
        } catch (error: any) {
            this.handleError(error);
        }
    }

    public async get(path: string, params?: any, timeoutOverride?: number): Promise<any> {
        try {
            const resp = await this.session.get(path, {
                params,
                timeout: timeoutOverride || this.timeout
            });
            return resp.data;
        } catch (error: any) {
            this.handleError(error);
        }
    }

    public async putBinary(url: string, dataFactory: () => fs.ReadStream | Buffer, contentType: string, contentLength?: number): Promise<AxiosResponse> {
        const maxAttempts = this.max_retries + 1;
        let lastError: any;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const data = dataFactory();
                const headers: any = { 
                    'Content-Type': contentType,
                    'Expect': '' // Disable Expect: 100-continue for R2 compatibility
                };
                if (contentLength !== undefined) {
                    headers['Content-Length'] = contentLength.toString();
                }

                const resp = await axios.put(url, data, {
                    headers,
                    timeout: Math.max(this.timeout, 120000),
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity
                });
                return resp;
            } catch (err: any) {
                lastError = err;
                const status = err.response?.status;
                if ([429, 500, 502, 503, 504].includes(status) || err.code === 'ECONNABORTED' || (!err.response && err.isAxiosError)) {
                    if (attempt < maxAttempts) {
                        const waitTime = Math.pow(2, attempt - 1) * 500;
                        await new Promise(res => setTimeout(res, waitTime));
                    }
                } else {
                    throw new CloudUploaderError(`PUT failed: ${err.message}`, err.response?.data?.error, status);
                }
            }
        }
        throw new CloudUploaderError(`PUT failed after ${maxAttempts} attempts: ${lastError.message}`);
    }

    public async downloadStream(url: string, timeoutOverride?: number): Promise<AxiosResponse> {
        const resp = await axios.get(url, {
            responseType: 'stream',
            timeout: timeoutOverride || Math.max(this.timeout, 300000)
        });
        return resp;
    }

    private handleError(error: any): never {
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data || {};
            const msg = data.message || `HTTP ${status}`;
            if (status === 401) {
                throw new AuthenticationError(msg, data.error, status);
            }
            throw new CloudUploaderError(msg, data.error, status);
        }
        throw new CloudUploaderError(error.message || 'Unknown network error');
    }
}
