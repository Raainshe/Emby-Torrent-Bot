import { search1337x, getMagnetLink1337x } from '../torrent-sites/1337x.js';
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
}

/**
 * Search for torrents with TMDB metadata enrichment and fallback strategies
 */
export async function searchTorrentsWithMetadata(options: SearchOptions): Promise<EnrichedSearchResponse> {
    try {
        console.log(`Starting search for: ${options.query} in category: ${options.category}`);
        
        // Try 1337x first
        const torrentResults = await search1337x(options);
        
        // If 1337x is blocked or failed, provide helpful guidance
        if (torrentResults.error) {
            console.warn(`1337x search failed: ${torrentResults.error}`);
            
            // Check if it's a Cloudflare/bot protection issue
            if (torrentResults.error.includes('blocking') || torrentResults.error.includes('403') || torrentResults.error.includes('protection')) {
                return {
                    results: [],
                    totalResults: 0,
                    page: 1,
                    totalPages: 0,
                    error: '🚫 Search temporarily unavailable due to site protection',
                    sourceUsed: '1337x (blocked)',
                    fallbackMessage: '💡 **Alternative options:**\n' +
                        '• Try searching again in a few minutes\n' +
                        '• Use `/addmagnet` directly if you have a magnet link\n' +
                        '• Search manually on torrent sites and copy the magnet link'
                };
            }
            
            return {
                results: [],
                totalResults: 0,
                page: 1,
                totalPages: 0,
                error: torrentResults.error,
                sourceUsed: '1337x (failed)'
            };
        }

        if (torrentResults.results.length === 0) {
            return {
                results: [],
                totalResults: 0,
                page: 1,
                totalPages: 0,
                sourceUsed: '1337x',
                fallbackMessage: '💡 **No results found. Try:**\n' +
                    '• Different search terms\n' +
                    '• Different category\n' +
                    '• More specific or less specific search'
            };
        }

        console.log(`Found ${torrentResults.results.length} results from 1337x, enriching with TMDB...`);

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

        return {
            results: enrichedResults,
            totalResults: torrentResults.totalResults,
            page: torrentResults.page,
            totalPages: torrentResults.totalPages,
            sourceUsed: '1337x',
            fallbackMessage: enrichedCount < enrichedResults.length ? 
                `📊 Enhanced ${enrichedCount} results with movie/TV metadata` : undefined
        };
        
    } catch (error) {
        console.error('Error in searchTorrentsWithMetadata:', error);
        return {
            results: [],
            totalResults: 0,
            page: 1,
            totalPages: 0,
            error: '❌ Search service error. Please try again.',
            sourceUsed: 'unknown',
            fallbackMessage: '💡 **If this persists:**\n' +
                '• Check your internet connection\n' +
                '• Verify TMDB_API_KEY is set correctly\n' +
                '• Try `/addmagnet` with a direct magnet link'
        };
    }
}

/**
 * Get magnet link for a specific torrent result with retries
 */
export async function getMagnetLinkForTorrent(torrent: EnrichedTorrentResult): Promise<string | null> {
    try {
        if (torrent.magnetLink && torrent.magnetLink !== '') {
            return torrent.magnetLink;
        }
        
        // If no magnet link cached, fetch from detail page with retries
        if (torrent.detailUrl && torrent.site === '1337x') {
            console.log(`Attempting to fetch magnet link for: ${torrent.title}`);
            
            // Try up to 3 times with exponential backoff
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