import axios from 'axios';
import FormData from 'form-data'; // Import FormData

const QBIT_URL = process.env.QBITTORRENT_URL;
const QBIT_USERNAME = process.env.QBITTORRENT_USERNAME;
const QBIT_PASSWORD = process.env.QBITTORRENT_PASSWORD;

let sid = ''; // To store the session ID

async function login(): Promise<boolean> {
    if (!QBIT_URL || !QBIT_USERNAME || !QBIT_PASSWORD) {
        console.error('qBittorrent credentials not configured in .env file (QBITTORRENT_URL, QBITTORRENT_USERNAME, QBITTORRENT_PASSWORD).');
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
                // qBittorrent might redirect after login, but axios by default doesn't follow POST redirects with the same method
                // However, for login, we primarily care about the Set-Cookie header from the initial response.
                // If issues arise with redirects, maxRedirects: 0 might be considered, but usually not needed for login cookie.
            }
        );

        if (response.status === 200 && response.data && response.data.trim() === "Ok.") {
             if (response.headers['set-cookie']) {
                const cookieHeader = Array.isArray(response.headers['set-cookie']) ? response.headers['set-cookie'] : [response.headers['set-cookie']!];
                const sidCookie = cookieHeader.find(cookie => cookie.startsWith('SID='));
                if (sidCookie) {
                    sid = sidCookie ? sidCookie.split(';')[0] || '' : ''; // Ensure sid is always a string
                    console.log('Successfully logged into qBittorrent');
                    console.log('Session ID (SID):', sid); // Add this line to log the SID
                    return true;
                }
            }
            console.error('Login to qBittorrent reported Ok, but SID cookie was not found in response.');
            return false;
        }
        console.error('Failed to login to qBittorrent. Status:', response.status, 'Data:', response.data);
        return false;
    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response) {
            console.error('Error logging into qBittorrent:', error.response.status, error.response.data);
        } else {
            console.error('Error logging into qBittorrent:', error.message);
        }
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
        console.log("SID not found, attempting to login to qBittorrent...");
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
            console.log('qBittorrent session likely expired (403 Forbidden), attempting re-login...');
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
                    if (axios.isAxiosError(retryError) && retryError.response) {
                        console.error('Error getting torrents after re-login:', retryError.response.status, retryError.response.data);
                        return { error: `Error getting torrents after re-login: ${retryError.response.status}` };
                    }
                    console.error('Error getting torrents after re-login:', retryError.message);
                    return { error: 'Error getting torrents after re-login' };
                }
            } else {
                 return { error: 'Failed to re-login to qBittorrent after session expiry.' };
            }
        }
        if (axios.isAxiosError(error) && error.response) {
            console.error('Error getting torrents from qBittorrent:', error.response.status, error.response.data);
            return { error: `Error fetching torrents: ${error.response.status}` };
        }
        console.error('Error getting torrents from qBittorrent:', error.message);
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
    if (!sid) {
        console.log("SID not found, attempting to login to qBittorrent...");
        const loggedIn = await login();
        if (!loggedIn) {
            return { success: false, error: 'Failed to login to qBittorrent. Check credentials and qBittorrent WebUI settings.' };
        }
    }
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
        const generatedHeaders = formData.getHeaders(); // Get generated headers
        console.log('[addTorrentByMagnet] SID being used:', sid); // Log the SID
        console.log('[addTorrentByMagnet] FormData Headers:', JSON.stringify(generatedHeaders, null, 2)); // Log the generated headers

        const response = await axios.post(
            `${QBIT_URL}/api/v2/torrents/add`,
            formData,
            {
                headers: {
                    ...generatedHeaders, // Important for multipart/form-data
                    Cookie: sid,
                },
            }
        );

        // The API responds with "Ok." on success or "Fails." on failure, both with status 200.
        if (response.status === 200 && response.data && response.data.trim() === "Ok.") {
            return { success: true };
        } else if (response.status === 200 && response.data && response.data.trim() === "Fails.") {
            console.error('qBittorrent API reported "Fails." for adding torrent. Magnet:', magnetUrl, 'SavePath:', savePath, 'Raw Response:', response.data);
            return { success: false, error: 'qBittorrent reported "Fails." This could be due to the magnet link being invalid, already added, or an issue with qBittorrent\'s default save path / permissions. Check qBittorrent logs if possible.' };
        }
        // Handle other unexpected responses
        console.error('Failed to add torrent. Status:', response.status, 'Data:', response.data);
        return { success: false, error: `Failed to add torrent. Status: ${response.status}, Response: ${response.data}` };

    } catch (error: any) {
        if (axios.isAxiosError(error) && error.response) {
            // Handle 403 Forbidden - session might have expired
            if (error.response.status === 403) {
                console.log('qBittorrent session likely expired (403 Forbidden) while adding torrent, attempting re-login...');
                sid = ''; // Clear SID
                const loggedIn = await login();
                if (loggedIn && QBIT_URL) {
                    // Retry the request once after re-login
                    try {
                        const formData = new FormData();
                        formData.append('urls', magnetUrl);
                        if (savePath) {
                            formData.append('savepath', savePath);
                        }
                        const retryResponse = await axios.post(`${QBIT_URL}/api/v2/torrents/add`, formData, {
                             headers: {
                                ...formData.getHeaders(),
                                Cookie: sid,
                            },
                        });
                        if (retryResponse.status === 200 && retryResponse.data && typeof retryResponse.data === 'string' && retryResponse.data.trim().toLowerCase() === "ok.") {
                            console.log(`Successfully sent magnet URL to qBittorrent after re-login: ${magnetUrl}`);
                            return { success: true };
                        } else {
                             console.error('Failed to add torrent via magnet after re-login. Status:', retryResponse.status, 'Raw Response Data:', JSON.stringify(retryResponse.data)); // Enhanced logging
                            return { success: false, error: `Failed to add torrent after re-login. Status: ${retryResponse.status}, Response: ${JSON.stringify(retryResponse.data)}` }; // Include response data in error
                        }
                    } catch (retryError: any) {
                        if (axios.isAxiosError(retryError) && retryError.response) {
                            console.error('Error adding torrent after re-login:', retryError.response.status, retryError.response.data);
                            return { success: false, error: `Error adding torrent after re-login: ${retryError.response.status}` };
                        }
                        console.error('Error adding torrent after re-login:', retryError.message);
                        return { success: false, error: 'Error adding torrent after re-login' };
                    }
                } else {
                    return { success: false, error: 'Failed to re-login to qBittorrent after session expiry while adding torrent.' };
                }
            }
            console.error('Error adding torrent via magnet:', error.response.status, error.response.data);
            return { success: false, error: `Error adding torrent: ${error.response.status}` };
        }
        console.error('Error adding torrent via magnet:', error.message);
        return { success: false, error: 'Error adding torrent' };
    }
}

// Add other functions like addTorrent, pauseTorrent, etc. as needed

export { login as qbitLogin, getTorrents as qbitGetTorrents, getSeedingTorrents as qbitGetSeedingTorrents, addTorrentByMagnet as qbitAddTorrentByMagnet };
