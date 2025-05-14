import { addLogEntry } from './utils/logUtils';
import axios from 'axios';
import FormData from 'form-data'; // Import FormData
import https from 'https'; // Added for potential future use with https.Agent

// Add a request interceptor for debugging
// axios.interceptors.request.use(request => {
//   // Log only relevant parts, especially headers and method/url
//   // Avoid logging 'data' if it's a stream or large, as it might not be useful or could be too verbose
//   const { method, url, headers, params } = request;
//   console.log('[AxiosRequestInterceptor] Starting Request:', JSON.stringify({ method, url, headers, params }, null, 2));
//   return request;
// }, error => {
//   console.error('[AxiosRequestInterceptor] Request Error:', error);
//   return Promise.reject(error);
// });

const QBIT_URL = process.env.QBITTORRENT_URL;
const QBIT_USERNAME = process.env.QBITTORRENT_USERNAME;
const QBIT_PASSWORD = process.env.QBITTORRENT_PASSWORD;

let sid = ''; // To store the session ID

async function login(): Promise<boolean> {
    if (!QBIT_URL || !QBIT_USERNAME || !QBIT_PASSWORD) {
        return false;
    }
    try {
        const response = await axios.post(
            `${QBIT_URL}/api/v2/auth/login`,
            `username=${encodeURIComponent(QBIT_USERNAME)}&password=${encodeURIComponent(QBIT_PASSWORD)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );

        if (response.status === 200 && response.data && response.data.trim() === "Ok.") {
             if (response.headers['set-cookie']) {
                const cookieHeader = Array.isArray(response.headers['set-cookie']) ? response.headers['set-cookie'] : [response.headers['set-cookie']!];
                const sidCookie = cookieHeader.find(cookie => cookie.startsWith('SID='));
                if (sidCookie) {
                    sid = sidCookie ? sidCookie.split(';')[0] || '' : ''; // Ensure sid is always a string
                    return true;
                }
            }
            return false;
        }
        return false;
    } catch (error: any) {
        return false;
    }
}

export interface TorrentInfo {
    added_on: number;
    amount_left: number;
    auto_tmm: boolean;
    availability: number;
    category: string;
    completed: number;
    completion_on: number;
    content_path: string;
    dl_limit: number;
    dlspeed: number; // Download speed in B/s
    download_path: string;
    downloaded: number;
    downloaded_session: number;
    eta: number;
    f_l_piece_prio: boolean;
    force_start: boolean;
    hash: string;
    infohash_v1: string;
    infohash_v2: string;
    last_activity: number;
    magnet_uri: string;
    max_ratio: number;
    max_seeding_time: number;
    name: string;
    num_complete: number; // Total number of seeds in the swarm (available globally)
    num_incomplete: number; // Total number of leechers in the swarm (available globally)
    num_leechs: number; // Connected leechers
    num_seeds: number; // Connected seeds
    priority: number;
    progress: number;
    ratio: number;
    ratio_limit: number;
    save_path: string;
    seeding_time: number;
    seeding_time_limit: number;
    seen_complete: number;
    seq_dl: boolean;
    size: number;
    state: string;
    super_seeding: boolean;
    tags: string;
    time_active: number;
    total_size: number;
    tracker: string;
    trackers_count: number;
    up_limit: number;
    uploaded: number;
    uploaded_session: number;
    upspeed: number;
}

interface GetTorrentsResult {
    torrents?: TorrentInfo[];
    error?: string;
}

async function getTorrents(): Promise<GetTorrentsResult> {
    if (!sid) {
        const loggedIn = await login();
        if (!loggedIn) {
            return { error: 'Failed to login to qBittorrent. Check credentials and qBittorrent WebUI settings.' };
        }
    }
    if (!QBIT_URL) {
         return { error: 'qBittorrent URL not configured.' };
    }

    try {
        const response = await axios.get<TorrentInfo[]>(`${QBIT_URL}/api/v2/torrents/info`, {
            headers: {
                Cookie: sid,
            },
        });
        return { torrents: response.data }; // Array of torrent objects
    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response && error.response.status === 403) { // Forbidden, likely session expired
            sid = ''; // Clear SID to force re-login
            const loggedIn = await login();
            if (loggedIn && QBIT_URL) { // Check QBIT_URL again after re-login attempt
                // Retry the request once after re-login
                try {
                    const retryResponse = await axios.get<TorrentInfo[]>(`${QBIT_URL}/api/v2/torrents/info`, {
                         headers: {
                            Cookie: sid,
                        },
                    });
                    return { torrents: retryResponse.data };
                } catch (retryError: any) {
                    return { error: 'Error getting torrents after re-login' };
                }
            } else {
                 return { error: 'Failed to re-login to qBittorrent after session expiry.' };
            }
        }
        return { error: 'Error fetching torrents' };
    }
}

const SEEDING_STATES = [
    "uploading",
    "stalledUP",
    "forcedUP",
    "queuedUP",
    "checkingUP"
];

async function getSeedingTorrents(): Promise<GetTorrentsResult> {
    const result = await getTorrents();

    if (result.error) {
        return { error: result.error };
    }

    if (result.torrents) {
        const seedingTorrents = result.torrents.filter(torrent =>
            SEEDING_STATES.includes(torrent.state.toLowerCase())
        );
        return { torrents: seedingTorrents };
    }

    return { torrents: [] }; // Should not happen if no error and no torrents
}

async function getTorrentByHash(hash: string): Promise<TorrentInfo | undefined> {
    if (!sid) {
        const loggedIn = await login();
        if (!loggedIn) {
            // Cannot log in, so cannot fetch torrent
            return undefined;
        }
    }
    if (!QBIT_URL) {
        return undefined;
    }

    try {
        const response = await axios.get<TorrentInfo[]>(`${QBIT_URL}/api/v2/torrents/info`, {
            params: {
                hashes: hash // qBittorrent API can filter by one or more hashes
            },
            headers: {
                Cookie: sid,
            },
        });
        if (response.data && response.data.length > 0) {
            return response.data[0]; // Return the first torrent matching the hash
        }
        return undefined; // No torrent found with that hash
    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response && error.response.status === 403) {
            sid = ''; 
            const loggedIn = await login();
            if (loggedIn && QBIT_URL) {
                try {
                    const retryResponse = await axios.get<TorrentInfo[]>(`${QBIT_URL}/api/v2/torrents/info`, {
                        params: { hashes: hash },
                        headers: { Cookie: sid },
                    });
                    if (retryResponse.data && retryResponse.data.length > 0) {
                        return retryResponse.data[0];
                    }
                    return undefined;
                } catch (retryError: any) {
                    return undefined;
                }
            }
        }
        // console.error(`Error fetching torrent by hash ${hash}:`, error.message); // Keep this commented for now
        return undefined;
    }
}

async function addTorrentByMagnet(magnetUrl: string, savePath?: string): Promise<{ success: boolean; error?: string; torrent?: TorrentInfo }> {
    // Force a fresh login attempt to ensure the SID is current for this operation
    const loggedIn = await login(); // This will update the global 'sid' variable
    if (!loggedIn) {
        return { success: false, error: 'Failed to login to qBittorrent before adding torrent. Check credentials and qBittorrent WebUI settings.' };
    }
    // Now the global 'sid' variable should hold a freshly obtained SID

    if (!QBIT_URL) {
         return { success: false, error: 'qBittorrent URL not configured.' };
    }

    const formData = new FormData();
    formData.append('urls', magnetUrl);

    if (savePath) {
        formData.append('savepath', savePath);
    }
    // Add other parameters as needed, e.g., category, tags, etc.
    // formData.append('category', 'myCategory');
    // formData.append('tags', 'tag1,tag2');

    try {
        const payload = formData.getBuffer(); // Get the payload as a buffer
        const requestHeaders = {
            ...formData.getHeaders(), // This includes Content-Type with boundary
            'Content-Length': payload.length.toString(), // Manually set Content-Length
            Cookie: sid, // sid is updated by the login() call above
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
        };

        const response = await axios.post(
            `${QBIT_URL}/api/v2/torrents/add`,
            payload, // Pass the buffer directly
            {
                headers: requestHeaders,
            }
        );

        // The API responds with "Ok." on success or "Fails." on failure, both with status 200.
        if (response.status === 200 && response.data && response.data.trim() === "Ok.") {
            // Torrent added successfully, now try to fetch its details
            // Wait a brief moment for qBittorrent to process the new torrent
            await new Promise(resolve => setTimeout(resolve, 1500)); // 1.5 second delay

            const torrentsResult = await getTorrents();
            if (torrentsResult.torrents && torrentsResult.torrents.length > 0) {
                // Find the most recently added torrent
                let newlyAddedTorrent = torrentsResult.torrents.reduce((latest, current) => {
                    return (latest.added_on > current.added_on) ? latest : current;
                });

                // A more robust check could involve comparing magnetUrl or hash if available
                // For now, assuming the latest 'added_on' is the one we just added.
                // We also need to ensure it was added very recently.
                const now = Math.floor(Date.now() / 1000);
                if (newlyAddedTorrent && (now - newlyAddedTorrent.added_on < 10)) { // Added in the last 10 seconds
                     return { success: true, torrent: newlyAddedTorrent };
                } else {
                    // Could not definitively identify the newly added torrent, but it was added.
                    return { success: true }; 
                }
            }
            return { success: true }; // Successfully added, but couldn't fetch specific torrent info
        } else if (response.status === 200 && response.data && response.data.trim() === "Fails.") {
            return { success: false, error: 'qBittorrent reported "Fails." This could be due to the magnet link being invalid, already added, or an issue with qBittorrent\'s default save path / permissions. Check qBittorrent logs if possible.' };
        }
        // Handle other unexpected responses
        return { success: false, error: `Failed to add torrent. Status: ${response.status}, Response: ${response.data}` };

    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response) {
            // Handle 403 Forbidden - session might have expired
            if (error.response.status === 403) {
                sid = ''; // Clear SID
                const reLoggedIn = await login(); // Use a different variable name for clarity
                if (reLoggedIn && QBIT_URL) {
                    // Retry the request once after re-login
                    try {
                        // Re-create FormData and payload for the retry
                        const retryFormData = new FormData(); 
                        retryFormData.append('urls', magnetUrl);
                        if (savePath) {
                            retryFormData.append('savepath', savePath);
                        }
                        const retryPayload = retryFormData.getBuffer();
                        const retryRequestHeaders = {
                             ...retryFormData.getHeaders(), 
                             'Content-Length': retryPayload.length.toString(),
                             Cookie: sid, // sid is updated by the new login()
                             'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36',
                        };

                        const retryResponse = await axios.post(`${QBIT_URL}/api/v2/torrents/add`, retryPayload, {
                             headers: retryRequestHeaders,
                        });
                        if (retryResponse.status === 200 && retryResponse.data && typeof retryResponse.data === 'string' && retryResponse.data.trim().toLowerCase() === "ok.") {
                            // Similar logic to fetch torrent info after successful retry
                            await new Promise(resolve => setTimeout(resolve, 1500));
                            const torrentsResult = await getTorrents();
                            if (torrentsResult.torrents && torrentsResult.torrents.length > 0) {
                                let newlyAddedTorrent = torrentsResult.torrents.reduce((latest, current) => {
                                    return (latest.added_on > current.added_on) ? latest : current;
                                });
                                const now = Math.floor(Date.now() / 1000);
                                if (newlyAddedTorrent && (now - newlyAddedTorrent.added_on < 10)) {
                                    return { success: true, torrent: newlyAddedTorrent };
                                }
                            }
                            return { success: true };
                        } else {
                            return { success: false, error: `Failed to add torrent after re-login. Status: ${retryResponse.status}, Response: ${JSON.stringify(retryResponse.data)}` }; // Include response data in error
                        }
                    } catch (retryError: any) {
                        return { success: false, error: 'Error adding torrent after re-login' };
                    }
                } else {
                    return { success: false, error: 'Failed to re-login to qBittorrent after session expiry while adding torrent.' };
                }
            }
            return { success: false, error: `Error adding torrent: ${error.response.status}` };
        }
        return { success: false, error: 'Error adding torrent' };
    }
}

/**
 * Deletes torrents from qBittorrent.
 * @param hashes An array of torrent hashes to delete.
 * @param deleteFiles Whether to delete the files from disk.
 * @returns True if the deletion was successful, false otherwise.
 */
export async function qbitDeleteTorrents(hashes: string[], deleteFiles: boolean): Promise<boolean> {
    if (!sid) {
        await login(); // Changed from qbitLogin() to login()
        if (!sid) {
            addLogEntry('System', 'qbitDeleteTorrents', 'Login failed, cannot delete torrents.');
            return false;
        }
    }

    const qbUrl = process.env.QBITTORRENT_URL;
    if (!qbUrl) {
        addLogEntry('System', 'qbitDeleteTorrents', 'qBittorrent URL is not configured.');
        return false;
    }

    // Construct the data as application/x-www-form-urlencoded
    const params = new URLSearchParams();
    params.append('hashes', hashes.join('|'));
    params.append('deleteFiles', deleteFiles.toString());

    try {
        const response = await axios.post(
            `${qbUrl}/api/v2/torrents/delete`, 
            params.toString(), // Send as URL-encoded string
            {
                headers: {
                    // Set Content-Type to application/x-www-form-urlencoded
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': sid,
                },
            }
        );

        if (response.status === 200) {
            addLogEntry('System', 'qbitDeleteTorrents', `Successfully deleted torrents: ${hashes.join(', ')}. Delete files: ${deleteFiles}`);
            return true;
        } else {
            addLogEntry('System', 'qbitDeleteTorrents', `Failed to delete torrents. Status: ${response.status} - ${response.data}`);
            return false;
        }
    } catch (error: any) { // Explicitly type error as any or a more specific error type
        // Log more detailed error information if available
        let errorMessage = 'Unknown error';
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            errorMessage = `AxiosError: Request failed with status code ${error.response.status}. Data: ${JSON.stringify(error.response.data)}`;
        } else if (error.request) {
            // The request was made but no response was received
            errorMessage = 'AxiosError: No response received from qBittorrent.';
        } else {
            // Something happened in setting up the request that triggered an Error
            errorMessage = error.message;
        }
        console.error('Error deleting torrents:', error); // Keep console.error for detailed object logging
        addLogEntry('System', 'qbitDeleteTorrents', `Error deleting torrents: ${errorMessage}`);
        return false;
    }
}

export async function qbitPauseTorrents(hashes: string[]): Promise<boolean> {
    if (hashes.length === 0) {
        return true; // Nothing to pause
    }
    if (!sid) {
        const loggedIn = await login();
        if (!loggedIn) {
            addLogEntry('System', 'qbitPauseTorrents', 'Failed to login to qBittorrent before pausing torrents.');
            return false;
        }
    }
    if (!QBIT_URL) {
        addLogEntry('System', 'qbitPauseTorrents', 'qBittorrent URL not configured.');
        return false;
    }

    const hashesString = hashes.join('|');

    try {
        const response = await axios.post(
            `${QBIT_URL}/api/v2/torrents/pause`,
            new URLSearchParams({ hashes: hashesString }).toString(), // Send as application/x-www-form-urlencoded
            {
                headers: {
                    Cookie: sid,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );

        // The API responds with status 200 on success, even if some hashes were not found or already paused.
        // A more robust check might involve verifying torrent states after, but for pausing, 200 is usually sufficient.
        if (response.status === 200) {
            addLogEntry('System', 'qbitPauseTorrents', `Successfully sent pause command for ${hashes.length} torrent(s).`);
            return true;
        }
        addLogEntry('System', 'qbitPauseTorrents', `Failed to pause torrents. Status: ${response.status}, Response: ${response.data}`);
        return false;
    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response && error.response.status === 403) {
            sid = ''; // Clear SID to force re-login
            addLogEntry('System', 'qbitPauseTorrents', 'qBittorrent session expired. Attempting re-login.');
            const loggedIn = await login();
            if (loggedIn) {
                // Retry the request once after re-login
                try {
                    const retryResponse = await axios.post(
                        `${QBIT_URL}/api/v2/torrents/pause`,
                        new URLSearchParams({ hashes: hashesString }).toString(),
                        {
                            headers: {
                                Cookie: sid,
                                'Content-Type': 'application/x-www-form-urlencoded',
                            },
                        }
                    );
                    if (retryResponse.status === 200) {
                        addLogEntry('System', 'qbitPauseTorrents', `Successfully sent pause command for ${hashes.length} torrent(s) after re-login.`);
                        return true;
                    }
                    addLogEntry('System', 'qbitPauseTorrents', `Failed to pause torrents after re-login. Status: ${retryResponse.status}, Response: ${retryResponse.data}`);
                    return false;
                } catch (retryError: any) {
                    addLogEntry('System', 'qbitPauseTorrents', `Error pausing torrents after re-login: ${retryError.message}`);
                    return false;
                }
            } else {
                addLogEntry('System', 'qbitPauseTorrents', 'Failed to re-login to qBittorrent after session expiry.');
                return false;
            }
        }
        addLogEntry('System', 'qbitPauseTorrents', `Error pausing torrents: ${error.message}`);
        return false;
    }
}

// Make sure to export all functions that are used externally, e.g., in discordClient.ts
export {
    login as qbitLogin,
    getTorrents as qbitGetTorrents,
    getSeedingTorrents as qbitGetSeedingTorrents,
    getTorrentByHash as qbitGetTorrentByHash,
    addTorrentByMagnet as qbitAddTorrentByMagnet,
    // qbitDeleteTorrents is already exported by its declaration
    // qbitPauseTorrents is already exported by its declaration
};
