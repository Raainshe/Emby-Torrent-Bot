import fs from 'fs';
import path from 'path';

const LOG_FILE_NAME = 'bot_activity.log';
const LOG_FILE_PATH = path.join(process.cwd(), LOG_FILE_NAME); // Store log in the root directory

// Ensure log file exists
if (!fs.existsSync(LOG_FILE_PATH)) {
    try {
        fs.writeFileSync(LOG_FILE_PATH, '', 'utf8');
        console.log(`Log file created: ${LOG_FILE_PATH}`);
    } catch (error) {
        console.error(`Error creating log file ${LOG_FILE_PATH}:`, error);
    }
}


/**
 * Adds a log entry to the bot_activity.log file.
 * @param user The user who initiated the action (e.g., Discord tag or "System").
 * @param command The command or action being logged.
 * @param details Additional details about the log entry.
 */
export function addLogEntry(user: string, command: string, details: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] User: ${user}, Command: ${command}, Details: ${details}\n`;

    try {
        fs.appendFileSync(LOG_FILE_PATH, logMessage, 'utf8');
    } catch (error) {
        console.error(`Error writing to log file ${LOG_FILE_PATH}:`, error);
    }
}

/**
 * Retrieves the last N log entries from the bot_activity.log file.
 * @param count The number of recent log entries to retrieve.
 * @returns An array of log entry strings.
 */
export function getRecentLogs(count: number): string[] {
    try {
        if (!fs.existsSync(LOG_FILE_PATH)) {
            return ['Log file does not exist yet.'];
        }
        const data = fs.readFileSync(LOG_FILE_PATH, 'utf8');
        const lines = data.trim().split('\n');
        const recentLines = lines.slice(Math.max(lines.length - count, 0));
        return recentLines.length > 0 ? recentLines : ['No log entries found.'];
    } catch (error) {
        console.error(`Error reading from log file ${LOG_FILE_PATH}:`, error);
        return [`Error reading log file: ${error instanceof Error ? error.message : String(error)}`];
    }
}
