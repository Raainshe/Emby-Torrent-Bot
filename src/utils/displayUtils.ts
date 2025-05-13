// src/utils/displayUtils.ts

const BAR_LENGTH = 20; // Length of the progress bar in characters

/**
 * Formats bytes into a human-readable string (KB/s, MB/s, GB/s).
 * @param bytes The number of bytes.
 * @returns A string representing the speed.
 */
export function formatSpeed(bytes: number): string {
    if (bytes === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Creates a text-based progress bar.
 * @param progress A number between 0 and 1 representing the progress.
 * @param dlspeed Download speed in bytes per second.
 * @param seeds Number of connected seeds.
 * @param leechers Number of connected leechers.
 * @returns A string representing the progress bar and stats.
 */
export function createProgressBar(
    progress: number,
    dlspeed?: number,
    seeds?: number,
    leechers?: number
): string {
    const filledLength = Math.round(BAR_LENGTH * progress);
    const emptyLength = BAR_LENGTH - filledLength;

    const filledBar = '❚'.repeat(filledLength);
    const emptyBar = ' '.repeat(emptyLength); // Using a space for a less cluttered empty part
    const percentage = (progress * 100).toFixed(2);

    let statsString = '';
    if (dlspeed !== undefined) {
        statsString += ` | ↓ ${formatSpeed(dlspeed)}`;
    }
    if (seeds !== undefined) {
        statsString += ` | S: ${seeds}`;
    }
    if (leechers !== undefined) {
        statsString += ` | L: ${leechers}`;
    }

    return `[${filledBar}${emptyBar}] ${percentage}%${statsString}`;
}

/**
 * Formats a duration in seconds into a human-readable string.
 * @param totalSeconds The total duration in seconds.
 * @returns A string representing the duration (e.g., "1h 23m 45s" or "45m 30s").
 */
export function formatDuration(totalSeconds: number): string {
    if (totalSeconds < 0) totalSeconds = 0;

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    let durationString = '';
    if (hours > 0) {
        durationString += `${hours}h `;
    }
    if (minutes > 0 || hours > 0) { // Always show minutes if hours are shown, or if minutes > 0
        durationString += `${minutes}m `;
    }
    durationString += `${seconds}s`;

    return durationString.trim();
}
