import { addLogEntry } from './logUtils';
import { qbitGetTorrents, qbitPauseTorrents, type TorrentInfo } from '../qbittorrent';

interface TorrentTimingInfo {
    hash: string;
    name: string;
    downloadStartTime: number; // Unix timestamp when download started
    downloadCompletionTime?: number; // Unix timestamp when download completed
    downloadDuration?: number; // Duration in seconds to complete download
    seedingStopTime?: number; // Unix timestamp when seeding should stop
    stopped: boolean; // Whether we've already stopped this torrent
}

// Store torrent timing information
const torrentTimings = new Map<string, TorrentTimingInfo>();

// Seeding multiplier (configurable via environment variable, defaults to 10x)
const SEEDING_MULTIPLIER = (() => {
    const multiplier = parseInt(process.env.SEEDING_TIME_MULTIPLIER || '10');
    if (isNaN(multiplier) || multiplier <= 0) {
        console.warn(`Invalid SEEDING_TIME_MULTIPLIER value: ${process.env.SEEDING_TIME_MULTIPLIER}. Using default value of 10.`);
        return 10;
    }
    return multiplier;
})();

// Check interval in milliseconds (every 5 minutes)
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Track a new torrent for seeding time management
 * @param torrent The torrent info from qBittorrent
 */
export function trackTorrentForSeeding(torrent: TorrentInfo): void {
    if (torrentTimings.has(torrent.hash)) {
        return; // Already tracking this torrent
    }

    const now = Math.floor(Date.now() / 1000);
    
    torrentTimings.set(torrent.hash, {
        hash: torrent.hash,
        name: torrent.name,
        downloadStartTime: torrent.added_on,
        stopped: false
    });

    addLogEntry('System', 'SeedingManager', `Started tracking torrent for seeding time limit: ${torrent.name} (Hash: ${torrent.hash})`);
}

/**
 * Mark a torrent as completed and calculate seeding stop time
 * @param torrent The completed torrent info
 */
export function markTorrentCompleted(torrent: TorrentInfo): void {
    const tracking = torrentTimings.get(torrent.hash);
    if (!tracking) {
        // Torrent wasn't being tracked, start tracking it now
        trackTorrentForSeeding(torrent);
        const newTracking = torrentTimings.get(torrent.hash)!;
        markTorrentCompleted(torrent);
        return;
    }

    if (tracking.downloadCompletionTime) {
        return; // Already marked as completed
    }

    const now = Math.floor(Date.now() / 1000);
    const downloadDuration = now - tracking.downloadStartTime;
    const seedingDuration = downloadDuration * SEEDING_MULTIPLIER;
    const seedingStopTime = now + seedingDuration;

    tracking.downloadCompletionTime = now;
    tracking.downloadDuration = downloadDuration;
    tracking.seedingStopTime = seedingStopTime;

    const stopDate = new Date(seedingStopTime * 1000);
    addLogEntry('System', 'SeedingManager', 
        `Torrent completed: ${tracking.name}. Download duration: ${Math.round(downloadDuration / 60)} minutes. ` +
        `Will stop seeding at: ${stopDate.toLocaleString()} (in ${Math.round(seedingDuration / 3600)} hours)`
    );
}

/**
 * Check all tracked torrents and stop seeding those that have exceeded their time limit
 */
export async function checkAndStopOverseededTorrents(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const torrentsToStop: string[] = [];

    for (const [hash, tracking] of torrentTimings.entries()) {
        if (tracking.stopped || !tracking.seedingStopTime) {
            continue;
        }

        if (now >= tracking.seedingStopTime) {
            torrentsToStop.push(hash);
        }
    }

    if (torrentsToStop.length > 0) {
        addLogEntry('System', 'SeedingManager', `Stopping seeding for ${torrentsToStop.length} torrents that have exceeded their time limit`);
        
        const success = await qbitPauseTorrents(torrentsToStop);
        
        if (success) {
            // Mark torrents as stopped
            for (const hash of torrentsToStop) {
                const tracking = torrentTimings.get(hash);
                if (tracking) {
                    tracking.stopped = true;
                    addLogEntry('System', 'SeedingManager', 
                        `Stopped seeding: ${tracking.name} after ${SEEDING_MULTIPLIER}x download time`
                    );
                }
            }
        } else {
            addLogEntry('System', 'SeedingManager', 'Failed to pause some torrents');
        }
    }
}

/**
 * Update torrent completion status by checking current torrents
 * This should be called periodically to detect newly completed torrents
 */
export async function updateTorrentCompletionStatus(): Promise<void> {
    try {
        const result = await qbitGetTorrents();
        
        if (result.error || !result.torrents) {
            addLogEntry('System', 'SeedingManager', `Error fetching torrents for seeding management: ${result.error}`);
            return;
        }

        for (const torrent of result.torrents) {
            const tracking = torrentTimings.get(torrent.hash);
            
            // Track new torrents that are downloading
            if (!tracking && torrent.progress < 1) {
                trackTorrentForSeeding(torrent);
            }
            
            // Mark completed torrents
            if (tracking && !tracking.downloadCompletionTime && torrent.progress >= 1) {
                markTorrentCompleted(torrent);
            }
        }
    } catch (error) {
        addLogEntry('System', 'SeedingManager', `Error updating torrent completion status: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Start the seeding manager background process
 */
export function startSeedingManager(): void {
    addLogEntry('System', 'SeedingManager', `Starting seeding manager with ${SEEDING_MULTIPLIER}x download time limit (configurable via SEEDING_TIME_MULTIPLIER env var)`);
    
    // Run initial check
    updateTorrentCompletionStatus().then(() => {
        checkAndStopOverseededTorrents();
    });
    
    // Set up periodic checks
    setInterval(async () => {
        await updateTorrentCompletionStatus();
        await checkAndStopOverseededTorrents();
    }, CHECK_INTERVAL_MS);
    
    addLogEntry('System', 'SeedingManager', `Seeding manager started. Will check every ${CHECK_INTERVAL_MS / 60000} minutes`);
}

/**
 * Get seeding status for all tracked torrents
 */
export function getSeedingStatus(): TorrentTimingInfo[] {
    return Array.from(torrentTimings.values());
}

/**
 * Remove a torrent from tracking (when deleted)
 */
export function removeTorrentTracking(hash: string): void {
    const tracking = torrentTimings.get(hash);
    if (tracking) {
        torrentTimings.delete(hash);
        addLogEntry('System', 'SeedingManager', `Removed tracking for torrent: ${tracking.name}`);
    }
}

/**
 * Manually stop seeding for specific torrents
 * @param hashes Array of torrent hashes to stop seeding
 * @returns True if the operation was successful, false otherwise
 */
export async function manuallyStopSeeding(hashes: string[]): Promise<boolean> {
    if (hashes.length === 0) {
        return false;
    }

    addLogEntry('System', 'SeedingManager', `Manually stopping seeding for ${hashes.length} torrents`);
    
    const success = await qbitPauseTorrents(hashes);
    
    if (success) {
        // Mark torrents as manually stopped
        for (const hash of hashes) {
            const tracking = torrentTimings.get(hash);
            if (tracking) {
                tracking.stopped = true;
                addLogEntry('System', 'SeedingManager', 
                    `Manually stopped seeding: ${tracking.name}`
                );
            }
        }
        addLogEntry('System', 'SeedingManager', `Successfully manually stopped seeding for ${hashes.length} torrents`);
        return true;
    } else {
        addLogEntry('System', 'SeedingManager', 'Failed to manually stop some or all torrents');
        return false;
    }
} 