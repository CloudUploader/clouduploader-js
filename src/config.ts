import * as path from 'path';
import * as fs from 'fs';

export interface Config {
    baseUrl: string;
}

export function loadConfig(): Config {
    const configPath = path.resolve(__dirname, '../config.json');
    
    try {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configContent);
        return config as Config;
    } catch (err) {
        throw new Error(`Failed to load config from ${configPath}: ${err}`);
    }
}

export function getBaseUrl(optionsBaseUrl?: string): string {
    if (optionsBaseUrl) {
        return optionsBaseUrl;
    }
    
    try {
        const config = loadConfig();
        return config.baseUrl;
    } catch (err) {
        console.warn(`Warning: Could not load baseUrl from config, using default. Error: ${err}`);
        return 'http://localhost:8080';
    }
}
