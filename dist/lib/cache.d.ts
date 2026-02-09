export interface CacheEntry {
    path: string;
    title: string;
    prodId?: string;
    testId?: string;
    lastScanned: string;
}
export interface Cache {
    version: number;
    entries: CacheEntry[];
}
export declare function getConfigDir(): string;
export declare function getCachePath(): string;
export declare function readCache(): Cache;
export declare function writeCache(cache: Cache): void;
export declare function addToCache(entry: Omit<CacheEntry, "lastScanned">): void;
export declare function findProjectRoot(dir: string): string | null;
export interface ScannedDashboard {
    path: string;
    title: string;
    prodId?: string;
    testId?: string;
}
export declare function scanDashboards(cwd: string): ScannedDashboard[];
