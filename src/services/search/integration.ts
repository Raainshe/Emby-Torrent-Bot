import { search1337x, getMagnetLink1337x } from '../torrent-sites/1337x.js';
import { searchTPB, getMagnetLinkTPB } from '../torrent-sites/tpb.js';
import { searchYTS, getMagnetLinkYTS } from '../torrent-sites/yts.js';
import { findBestTMDBMatch, getPosterUrl, getBackdropUrl } from '../tmdb/client.js';
import type { TorrentSearchResult, TorrentSearchResponse, SearchOptions } from '../torrent-sites/types.js';
import type { TMDBSearchResult } from '../tmdb/types.js';

export interface EnrichedTorrentResult extends TorrentSearchResult {
    tmdb?: TMDBSearchResult;
    posterUrl?: string;
    backdropUrl?: string;
    detailUrl?: string;
}

export interface EnrichedSearchResponse {
    results: EnrichedTorrentResult[];
    totalResults: number;
    page: number;
    totalPages: number;
    error?: string;
    sourceUsed?: string;
    fallbackMessage?: string;
    sourcesAttempted?: string[];
}

/**
 * Search for torrents with TMDB metadata enrichment and multi-source fallback
 */
export async function searchTorrentsWithMetadata(options: SearchOptions): Promise<EnrichedSearchResponse> {
    const sourcesAttempted: string[] = [];
    let lastError = '';
    
    try {
        console.log(`Starting multi-source search for: ${options.query} in category: ${options.category}`);
        
        // Try 1337x first
        console.log('Attempting search on 1337x...');
        sourcesAttempted.push('1337x');
        const torrentResults1337x = await search1337x(options);
        
        if (!torrentResults1337x.error && torrentResults1337x.results.length > 0) {
            console.log(`✅ 1337x returned ${torrentResults1337x.results.length} results`);
            return await enrichResultsWithTMDB(torrentResults1337x, '1337x', sourcesAttempted);
        }
        
        if (torrentResults1337x.error) {
            lastError = torrentResults1337x.error;
            console.warn(`❌ 1337x failed: ${torrentResults1337x.error}`);
        } else {
            console.warn(`⚠️ 1337x returned no results`);
        }
        
        // Try TPB as fallback
        console.log('Attempting search on TPB as fallback...');
        sourcesAttempted.push('TPB');
        const torrentResultsTPB = await searchTPB(options);
        
        if (!torrentResultsTPB.error && torrentResultsTPB.results.length > 0) {
            console.log(`✅ TPB returned ${torrentResultsTPB.results.length} results`);
            return await enrichResultsWithTMDB(torrentResultsTPB, 'TPB', sourcesAttempted, 
                `Used TPB as fallback after 1337x failed`);
        }
        
        if (torrentResultsTPB.error) {
            lastError = torrentResultsTPB.error;
            console.warn(`❌ TPB failed: ${torrentResultsTPB.error}`);
        } else {
            console.warn(`⚠️ TPB returned no results`);
        }
        
        // Try YTS as final fallback (movies only)
        if (options.category === 'movies' || options.category === 'all') {
            console.log('Attempting search on YTS as final fallback...');
            sourcesAttempted.push('YTS');
            const torrentResultsYTS = await searchYTS(options);
            
            if (!torrentResultsYTS.error && torrentResultsYTS.results.length > 0) {
                console.log(`✅ YTS returned ${torrentResultsYTS.results.length} results`);
                return await enrichResultsWithTMDB(torrentResultsYTS, 'YTS', sourcesAttempted, 
                    `Used YTS as final fallback for movies`);
            }
            
            if (torrentResultsYTS.error) {
                lastError = torrentResultsYTS.error;
                console.warn(`❌ YTS failed: ${torrentResultsYTS.error}`);
            } else {
                console.warn(`⚠️ YTS returned no results`);
            }
        }
        
        // All sources failed or returned no results
        const isBlocked = lastError.includes('blocking') || lastError.includes('403') || lastError.includes('protection');
        
        return {
            results: [],
            totalResults: 0,
            page: 1,
            totalPages: 0,
            error: isBlocked ? 
                '🚫 All torrent sources are currently blocked' : 
                '🔍 No results found on any source',
            sourceUsed: 'none',
            sourcesAttempted,
            fallbackMessage: isBlocked ?
                '💡 **When sites are blocked:**\n' +
                '• Try again in 10-15 minutes\n' +
                '• Use `/addmagnet` with direct magnet links\n' +
                '• Search manually and copy magnet links' :
                '💡 **No results found. Try:**\n' +
                '• Different search terms\n' +
                '• Different category\n' +
                '• More specific or broader search terms'
        };
        
    } catch (error) {
        console.error('Error in multi-source search:', error);
        return {
            results: [],
            totalResults: 0,
            page: 1,
            totalPages: 0,
            error: '❌ Search service error. Please try again.',
            sourceUsed: 'unknown',
            sourcesAttempted,
            fallbackMessage: '💡 **If this persists:**\n' +
                '• Check your internet connection\n' +
                '• Verify TMDB_API_KEY is set correctly\n' +
                '• Try `/addmagnet` with a direct magnet link'
        };
    }
}

/**
 * Enrich torrent results with TMDB metadata
 */
async function enrichResultsWithTMDB(
    torrentResults: TorrentSearchResponse, 
    sourceUsed: string,
    sourcesAttempted: string[],
    fallbackMessage?: string
): Promise<EnrichedSearchResponse> {
    console.log(`Enriching ${torrentResults.results.length} results from ${sourceUsed} with TMDB...`);

    // Enrich results with TMDB metadata
    const enrichedResults: EnrichedTorrentResult[] = [];
    
    // Process results in batches to avoid overwhelming the APIs
    const batchSize = 5;
    for (let i = 0; i < torrentResults.results.length; i += batchSize) {
        const batch = torrentResults.results.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (torrent) => {
            const enriched: EnrichedTorrentResult = { ...torrent };
            
            try {
                // Find TMDB match with timeout
                const tmdbMatch = await Promise.race([
                    findBestTMDBMatch(torrent.title, torrent.category),
                    new Promise<null>((_, reject) => 
                        setTimeout(() => reject(new Error('TMDB timeout')), 5000)
                    )
                ]);
                
                if (tmdbMatch) {
                    enriched.tmdb = tmdbMatch;
                    
                    // Get poster and backdrop URLs with timeout
                    if (tmdbMatch.poster_path) {
                        try {
                            const posterUrl = await Promise.race([
                                getPosterUrl(tmdbMatch.poster_path),
                                new Promise<null>((_, reject) => 
                                    setTimeout(() => reject(new Error('Poster timeout')), 3000)
                                )
                            ]);
                            if (posterUrl) {
                                enriched.posterUrl = posterUrl;
                            }
                        } catch (error) {
                            console.warn(`Failed to get poster for ${torrent.title}:`, error);
                        }
                    }
                    
                    if (tmdbMatch.backdrop_path) {
                        try {
                            const backdropUrl = await Promise.race([
                                getBackdropUrl(tmdbMatch.backdrop_path),
                                new Promise<null>((_, reject) => 
                                    setTimeout(() => reject(new Error('Backdrop timeout')), 3000)
                                )
                            ]);
                            if (backdropUrl) {
                                enriched.backdropUrl = backdropUrl;
                            }
                        } catch (error) {
                            console.warn(`Failed to get backdrop for ${torrent.title}:`, error);
                        }
                    }
                }
            } catch (error) {
                console.warn(`Error enriching torrent ${torrent.title} with TMDB data:`, error);
                // Continue with the torrent even if TMDB enrichment fails
            }
            
            return enriched;
        });
        
        const batchResults = await Promise.all(batchPromises);
        enrichedResults.push(...batchResults);
        
        // Small delay between batches to be respectful to APIs
        if (i + batchSize < torrentResults.results.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    const enrichedCount = enrichedResults.filter(r => r.tmdb).length;
    console.log(`Successfully enriched ${enrichedCount}/${enrichedResults.length} results with TMDB metadata`);

    const successMessage = enrichedCount < enrichedResults.length ? 
        `📊 Enhanced ${enrichedCount} results with movie/TV metadata` : undefined;

    return {
        results: enrichedResults,
        totalResults: torrentResults.totalResults,
        page: torrentResults.page,
        totalPages: torrentResults.totalPages,
        sourceUsed,
        sourcesAttempted,
        fallbackMessage: fallbackMessage || successMessage
    };
}

/**
 * Get magnet link for a specific torrent result with retries and multi-source support
 */
export async function getMagnetLinkForTorrent(torrent: EnrichedTorrentResult): Promise<string | null> {
    try {
        if (torrent.magnetLink && torrent.magnetLink !== '' && torrent.magnetLink.startsWith('magnet:')) {
            return torrent.magnetLink;
        }
        
        console.log(`Attempting to fetch magnet link for: ${torrent.title} from ${torrent.site}`);
        
        // Choose the appropriate method based on the source site
        if (torrent.site === 'TPB') {
            return await getMagnetLinkTPB(torrent);
        } else if (torrent.site === 'YTS') {
            return await getMagnetLinkYTS(torrent);
        } else if (torrent.site === '1337x' && torrent.detailUrl) {
            // Try up to 3 times with exponential backoff for 1337x
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const magnetLink = await getMagnetLink1337x(torrent.detailUrl);
                    if (magnetLink) {
                        console.log(`Successfully retrieved magnet link on attempt ${attempt}`);
                        return magnetLink;
                    }
                } catch (error) {
                    console.warn(`Attempt ${attempt} failed to get magnet link:`, error);
                    
                    if (attempt < 3) {
                        // Exponential backoff: wait 2^attempt seconds
                        const delay = Math.pow(2, attempt) * 1000;
                        console.log(`Waiting ${delay}ms before retry...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                    }
                }
            }
            
            console.error(`Failed to retrieve magnet link after 3 attempts for: ${torrent.title}`);
        }
        
        return null;
    } catch (error) {
        console.error('Error getting magnet link:', error);
        return null;
    }
}

/**
 * Map torrent category to qBittorrent save category
 */
export function mapCategoryToSavePath(torrentCategory: string): string {
    const categoryLower = torrentCategory.toLowerCase();
    
    if (categoryLower.includes('movie')) {
        return 'movie';
    } else if (categoryLower.includes('tv') || categoryLower.includes('series')) {
        return 'series';
    } else if (categoryLower.includes('anime')) {
        return 'anime';
    }
    
    return 'series'; // Default fallback
} 