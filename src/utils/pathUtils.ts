// Helper function to normalize paths for comparison, especially between WSL and Windows
export function normalizePathForComparison(path: string): string {
    let normalized = path;
    // Convert WSL /mnt/c/ style paths to C:/ style
    // Matches /mnt/x/ where x is a single letter, case-insensitive, and replaces with x:/
    normalized = normalized.replace(/^\/mnt\/([a-zA-Z])\/(.*)$/, '$1:/$2'); 
    // Replace all backslashes with forward slashes
    normalized = normalized.replace(/\\/g, '/');
    // Collapse multiple consecutive slashes into a single slash
    normalized = normalized.replace(/\/+/g, '/');
    // Ensure it ends with a single trailing slash
    if (!normalized.endsWith('/')) {
        normalized += '/';
    }
    // Convert to lowercase for case-insensitive comparison
    return normalized.toLowerCase();
}

// New helper function to convert Windows path to WSL path if needed
export function convertWindowsPathToWslPath(windowsPath: string): string {
    // Regex to capture drive letter and the rest of the path
    // Allows for C:\path or C:/path
    const match = windowsPath.match(/^([a-zA-Z]):[\\/](.*)/);

    // Ensure match is not null and the necessary capture groups are present and are strings
    if (match && typeof match[1] === 'string' && typeof match[2] === 'string') {
        const driveLetter = match[1].toLowerCase();
        // Replace backslashes with forward slashes for the rest of the path
        const restOfPath = match[2].replace(/\\/g, '/');
        return `/mnt/${driveLetter}/${restOfPath}`;
    }
    // If not a standard Windows path (e.g., C:\...) or regex doesn't match as expected,
    // return the original path.
    return windowsPath;
}

// Helper function to extract display name (dn) from magnet link
export function getDisplayNameFromMagnet(magnetLink: string): string | null {
    try {
        const urlParams = new URLSearchParams(magnetLink.substring(magnetLink.indexOf('?') + 1));
        return urlParams.get('dn');
    } catch (e) {
        console.error('Error parsing magnet link for dn:', e);
        return null;
    }
} 