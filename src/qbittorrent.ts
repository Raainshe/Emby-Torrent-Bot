import axios from 'axios';
import FormData from 'form-data'; // Import FormData

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

interface TorrentInfo {
    name: string;
    state: string;
    // Add other torrent properties you might need
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

async function addTorrentByMagnet(magnetUrl: string, savePath?: string): Promise<{ success: boolean; error?: string }> {
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
            return { success: true };
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

// Add other functions like addTorrent, pauseTorrent, etc. as needed

export { login as qbitLogin, getTorrents as qbitGetTorrents, getSeedingTorrents as qbitGetSeedingTorrents, addTorrentByMagnet as qbitAddTorrentByMagnet };
