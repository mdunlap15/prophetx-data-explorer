export interface AuthResponse {
  data: {
    access_token: string;
    access_expire_time: number;
    refresh_token: string;
    refresh_expire_time: number;
  };
}

export interface Tournament {
  id: number;
  name: string;
  sport: {
    id: number;
    name: string;
  };
}

export interface SportEvent {
  event_id: number;
  name: string;
  scheduled: string;
  status: string;
  competitors: Array<{
    id: number;
    name: string;
    side: string;
  }>;
}

export interface MMMarket {
  id: number;
  name: string;
  type: string;
  status: string;
  category_name?: string;
  sub_type?: string;
  player_id?: number;
  selections: any; // More flexible to handle different selection shapes
}

export interface TreeNode {
  id: string;
  name: string;
  type: 'tournament' | 'event' | 'category' | 'market' | 'selection';
  children?: TreeNode[];
  data?: {
    scheduled?: string;
    odds?: number | null;
    stake?: number | null;
    status?: string;
    line?: number | string | null;
    display_odds?: string | null;
    /** API line_id for wager placement - only present on selections */
    line_id?: string;
  };
}

interface NormalizedSelectionGroup {
  line?: number | string;
  selections: Array<{
    line_id?: string;
    name?: string;
    display_name?: string;
    odds?: number | null;
    stake?: number | null;
    line?: number | null;
    display_odds?: string | null;
  }>;
}

const LINE_MARKET_RE = /Run Line|Totals?|Total Runs|Spread|Handicap|Over|Under|Puck Line/i;

const EDGE_FUNCTION_URL = 'https://wdknwmgqggtcayrdjvuu.supabase.co/functions/v1/prophetx-proxy';

// Phase 1: Wager API Types (from ProphetX OpenAPI spec)
export interface PlaceWagerRequest {
  line_id: string;
  odds: number;
  stake: number;
  external_id: string;
  wager_strategy?: 'fillOrKill';
}

export interface CancelWagerRequest {
  wager_id?: string;
  external_id?: string;
}

export interface WagerHistory {
  wager_id: string;
  external_id: string;
  line_id: string;
  odds: number;
  stake: number;
  matched_stake: number;
  unmatched_stake: number;
  matching_status: 'unmatched' | 'fully_matched' | 'partially_matched';
  status: 'void' | 'closed' | 'canceled' | 'manually_settled' | 'inactive' | 'wiped' | 'open' | 'invalid' | 'settled';
  winning_status: 'lost' | 'won' | 'no_result' | 'tbd' | 'manually_lost' | 'manually_won' | 'draw' | 'push';
  profit: number;
  sport_event_id: number;
  market_id: number;
  outcome_id: number;
  line: number;
  created_at: string;
  updated_at: string;
  settled_at: string;
  user_id: string;
}

export interface ProphetXError {
  error: string;
  message: string;
}

// Request Queue for rate limiting and concurrency control
class RequestQueue {
  private queue: Array<() => Promise<any>> = [];
  private running = 0;
  private readonly maxConcurrency = 3;

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.running >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    this.running++;
    const task = this.queue.shift()!;

    try {
      await task();
    } finally {
      this.running--;
      this.process();
    }
  }
}

class ProphetXAPI {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private accessExpireTime: number | null = null;
  private rateLimitRemaining: number = 100;
  private requestQueue = new RequestQueue();
  private refreshLock = false;

  async authenticate(accessKey: string, secretKey: string): Promise<string> {
    console.log('Attempting authentication with ProphetX API...');
    
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'POST',
        endpoint: '/auth/login',
        body: { 
          access_key: accessKey, 
          secret_key: secretKey 
        }
      }),
    });

    if (!response.ok) {
      throw new Error(`Authentication request failed: ${response.status} ${response.statusText}`);
    }

    const data: AuthResponse = await response.json();
    
    // Check if the response contains an error (from our edge function)
    if ('error' in data) {
      throw new Error(`Authentication failed: ${(data as any).error}`);
    }
    
    // Check if we got a valid token response
    if (data.data?.access_token) {
      console.log('Authentication successful');
      this.accessToken = data.data.access_token;
      this.refreshToken = data.data.refresh_token;
      this.accessExpireTime = data.data.access_expire_time;
      this.updateRateLimit(response);
      this.startProactiveRefresh();
      return data.data.access_token;
    }
    
    throw new Error('Authentication failed: No access token received');
  }

  /**
   * Starts proactive token refresh 60 seconds before expiry
   */
  private startProactiveRefresh(): void {
    if (!this.accessExpireTime) return;

    const now = Math.floor(Date.now() / 1000);
    const timeUntilRefresh = (this.accessExpireTime - now - 60) * 1000; // 60s before expiry

    if (timeUntilRefresh > 0) {
      setTimeout(() => {
        this.proactiveRefreshToken();
      }, timeUntilRefresh);
      console.log(`🔄 Proactive refresh scheduled in ${Math.round(timeUntilRefresh / 1000)}s`);
    }
  }

  /**
   * Proactively refreshes the access token
   */
  private async proactiveRefreshToken(): Promise<void> {
    if (this.refreshLock || !this.refreshToken) return;

    try {
      this.refreshLock = true;
      console.log('🔄 Proactively refreshing access token...');
      await this.refreshAccessToken();
    } catch (error) {
      console.error('❌ Proactive refresh failed:', error);
    } finally {
      this.refreshLock = false;
    }
  }

  private updateRateLimit(response: Response): void {
    const remaining = response.headers.get('X-RateLimit-Remaining');
    if (remaining) {
      this.rateLimitRemaining = parseInt(remaining, 10);
    }
  }

  private async checkRateLimit(): Promise<void> {
    if (this.rateLimitRemaining < 2) {
      console.log('Rate limit approaching, sleeping for 1 second...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  private async makeRequest<T>(endpoint: string, method: string = 'GET', body?: any): Promise<T> {
    return this.requestQueue.add(async () => {
      if (!this.accessToken) {
        throw new Error('Not authenticated. Please authenticate first.');
      }

      await this.checkRateLimit();

      const requestBody: any = {
        method,
        endpoint,
        accessToken: this.accessToken
      };

      if (body && method !== 'GET') {
        requestBody.body = body;
      }

      let attempt = 0;
      const maxAttempts = 3;

      while (attempt < maxAttempts) {
        try {
          const response = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          });

          this.updateRateLimit(response);

          // Handle rate limiting with jittered backoff
          if (response.status === 429) {
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
            console.log(`⏳ Rate limited, retrying in ${Math.round(delay)}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt++;
            continue;
          }

          if (response.status === 401 && !this.refreshLock) {
            // Try to refresh token
            try {
              await this.refreshAccessToken();
              requestBody.accessToken = this.accessToken;
              attempt++;
              continue;
            } catch (refreshError) {
              throw new Error('Authentication expired and refresh failed');
            }
          }

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`API request failed: ${response.status} ${response.statusText}${errorData.error ? ` - ${errorData.error}` : ''}`);
          }

          return response.json();
        } catch (error) {
          if (attempt === maxAttempts - 1) throw error;
          
          const delay = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          console.log(`⚠️ Request failed, retrying in ${Math.round(delay)}ms...`, error);
          await new Promise(resolve => setTimeout(resolve, delay));
          attempt++;
        }
      }

      throw new Error('Max retry attempts exceeded');
    });
  }

  async getTournaments(): Promise<Tournament[]> {
    const response = await this.makeRequest<{ data: { tournaments: Tournament[] } }>('/mm/get_tournaments?has_active_events=true');
    return response.data.tournaments;
  }

  async getEvents(tournamentId: number): Promise<SportEvent[]> {
    const response = await this.makeRequest<{ data: { sport_events: SportEvent[] } }>(`/mm/get_sport_events?tournament_id=${tournamentId}`);
    return response.data.sport_events;
  }

  async getMarkets(eventId: number): Promise<MMMarket[]> {
    try {
      const response = await this.makeRequest<{ data: { markets: MMMarket[] | null } }>(`/v2/mm/get_markets?event_id=${eventId}`);
      
      // Handle null markets response
      if (!response.data.markets) {
        console.log(`No markets found for event ${eventId}`);
        return [];
      }
      
      return response.data.markets;
    } catch (error) {
      console.error(`Failed to get markets for event ${eventId}:`, error);
      return [];
    }
  }

  /**
   * RefreshToken API
   * POST /partner/auth/refresh
   * Request: { "refresh_token": string }
   * Response: { "data": { "access_token": string, "access_expire_time": number } }
   */
  async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    console.log('🔄 Refreshing access token...');
    
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'POST',
        endpoint: '/auth/refresh',
        body: { refresh_token: this.refreshToken }
      }),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (data.data?.access_token) {
      this.accessToken = data.data.access_token;
      this.accessExpireTime = data.data.access_expire_time;
      this.startProactiveRefresh();
      console.log('✅ Access token refreshed successfully');
    } else {
      throw new Error('Token refresh failed: No access token received');
    }
  }

  /**
   * GetOddsLadder API
   * GET /partner/mm/get_odds_ladder
   * Response: { "data": { "odds": number[] } }
   */
  async getOddsLadder(): Promise<number[]> {
    try {
      const response = await this.makeRequest<{ data: { odds: number[] } }>('/mm/get_odds_ladder');
      return response.data?.odds || [];
    } catch (error) {
      console.error('❌ Failed to get odds ladder:', error);
      return [];
    }
  }

  /**
   * PlaceWager API
   * POST /partner/mm/place_wager
   * Request: PlaceWagerRequest
   * Response: { "data": { "success": boolean, "wager": Wager } }
   */
  async placeWager(request: PlaceWagerRequest): Promise<{ success: boolean; wager: any }> {
    console.log('🎯 Placing wager:', request);
    
    try {
      const response = await this.makeRequest<{ data: { success: boolean; wager: any } }>(
        '/mm/place_wager',
        'POST',
        request
      );
      
      console.log('✅ Wager placed successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Wager placement failed:', error);
      
      // Parse structured error response from ProphetX
      if (error instanceof Error) {
        let enhancedError = error;
        try {
          // Try to extract more detailed error info
          const errorStr = error.message;
          if (errorStr.includes('API request failed:') && errorStr.includes('-')) {
            const parts = errorStr.split('-');
            if (parts.length > 1) {
              const errorBody = parts.slice(1).join('-').trim();
              enhancedError = new Error(errorBody);
              enhancedError.name = 'ProphetXAPIError';
            }
          }
        } catch (parseErr) {
          // Fall back to original error
        }
        throw this.enhanceError(enhancedError);
      }
      
      throw this.enhanceError(error);
    }
  }

  /**
   * CancelWager API
   * POST /partner/mm/cancel_wager
   * Request: CancelWagerRequest
   * Response: { "data": { "Success": boolean } }
   */
  async cancelWager(request: CancelWagerRequest): Promise<{ success: boolean }> {
    console.log('❌ Canceling wager:', request);
    
    try {
      const response = await this.makeRequest<{ data: { Success: boolean } }>(
        '/mm/cancel_wager',
        'POST',
        request
      );
      
      console.log('✅ Wager canceled successfully:', response.data);
      return { success: response.data.Success };
    } catch (error) {
      console.error('❌ Wager cancellation failed:', error);
      throw this.enhanceError(error);
    }
  }

  /**
   * GetWagerHistories API (v2 with cursor pagination)
   * GET /partner/v2/mm/get_wager_histories
   * Response: { "data": { "wagers": WagerHistory[], "next_cursor": string }, "last_synced_at": string }
   */
  async getMyWagers(filters?: {
    event_id?: string;
    market_id?: string;
    matching_status?: 'unmatched' | 'fully_matched' | 'partially_matched';
    status?: string;
    from?: number;
    to?: number;
    limit?: number;
  }): Promise<WagerHistory[]> {
    const all: WagerHistory[] = [];
    let cursor: string | undefined;
    
    do {
      const params: any = { ...(filters || {}) };
      if (cursor) params.cursor = cursor;
      
      const queryParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, String(value));
        }
      });

      const endpoint = `/v2/mm/get_wager_histories?${queryParams.toString()}`;
      
      try {
        const response = await this.makeRequest<{ 
          data: { wagers: WagerHistory[]; next_cursor?: string }; 
          last_synced_at: string 
        }>(endpoint);
        
        all.push(...(response.data?.wagers || []));
        cursor = response.data?.next_cursor;
      } catch (error) {
        console.error('❌ Failed to get wager histories:', error);
        throw this.enhanceError(error);
      }
    } while (cursor);
    
    return all;
  }

  /**
   * Normalizes market selections from various shapes into grouped format
   * Handles: dictionary (Record<line, Selection[]>), array of arrays, and flat arrays.
   * Never uses array index as a fallback line.
   */
  private normalizeSelections(market: MMMarket): NormalizedSelectionGroup[] {
    const s = market.selections;
    const groups: NormalizedSelectionGroup[] = [];
    if (!s) return groups;

    try {
      // A) DICTIONARY FIRST: Record<line, Selection[]>
      if (typeof s === 'object' && !Array.isArray(s)) {
        for (const [k, arr] of Object.entries(s as Record<string, any[]>)) {
          if (Array.isArray(arr)) {
            const n = Number(k);
            groups.push({ line: Number.isNaN(n) ? k : n, selections: arr });
          }
        }
        return groups;
      }

      // B) ARRAY OF ARRAYS: Selection[][]
      if (Array.isArray(s) && s.length && Array.isArray((s as any)[0])) {
        (s as any[][]).forEach(group => {
          if (Array.isArray(group) && group.length) {
            const ln = group.find(x => x && x.line != null)?.line ?? undefined; // no index fallback
            groups.push({ line: ln, selections: group as any[] });
          }
        });
        return groups;
      }

      // C) FLAT ARRAY: Selection[]
      if (Array.isArray(s)) {
        const byLine = new Map<string, any[]>();
        (s as any[]).forEach(sel => {
          if (sel && typeof sel === 'object') {
            const key = String(sel.line ?? '__default__');
            if (!byLine.has(key)) byLine.set(key, []);
            byLine.get(key)!.push(sel);
          }
        });
        for (const [k, arr] of byLine) {
          const n = Number(k);
          groups.push({
            line: k === '__default__' ? undefined : (Number.isNaN(n) ? k : n),
            selections: arr,
          });
        }
      }

      return groups;
    } catch (e) {
      console.error(`normalizeSelections error for ${market.name}`, e);
      return [];
    }
  }

  // Treat undefined and 0 as the same "default" for non-line markets (e.g., Moneyline).
  private normalizeLineKeyForMarket(marketName: string, line: unknown): string {
    const isLineMarket = LINE_MARKET_RE.test(marketName);
    if (!isLineMarket) return '__default__';
    if (line === null || line === undefined) return '__default__';
    return String(line);
  }

  private mergeGroupsForMarket(marketName: string, groups: NormalizedSelectionGroup[]): NormalizedSelectionGroup[] {
    const merged = new Map<string, NormalizedSelectionGroup>();
    for (const g of groups) {
      const key = this.normalizeLineKeyForMarket(marketName, g.line);
      if (!merged.has(key)) merged.set(key, { line: key === '__default__' ? undefined : g.line, selections: [] });
      merged.get(key)!.selections.push(...g.selections);
    }
    return Array.from(merged.values());
  }

  /**
   * Enhances error messages with ProphetX-specific error codes and hints
   */
  private enhanceError(error: any): Error {
    if (error instanceof Error) {
      const message = error.message;
      const errorCodeMatch = message.match(/"error":\s*"([^"]+)"/);
      const errorMsgMatch = message.match(/"message":\s*"([^"]+)"/);
      
      if (errorCodeMatch) {
        const code = errorCodeMatch[1];
        const apiMessage = errorMsgMatch ? errorMsgMatch[1] : message;
        const hint = this.getErrorHint(code);
        
        return new Error(`${code}: ${apiMessage}${hint ? ` (${hint})` : ''}`);
      }
    }
    
    return error instanceof Error ? error : new Error(String(error));
  }

  /**
   * Maps ProphetX error codes to user-friendly hints
   */
  private getErrorHint(code: string): string | null {
    const hints: Record<string, string> = {
      'invalid_line_id': 'The selection may no longer be available',
      'insufficient_amount': 'Check your account balance',
      'wager_limit_exceeded': 'Maximum 20 wagers per batch',
      'invalid_stake': 'Stake must be positive and within limits',
      'wager_invalid_odds': 'Odds must be greater than 1.0',
      'event_not_available': 'Event is no longer accepting bets',
      'rate_limit_reached': 'Too many requests, will retry automatically',
      'wager_external_id_existed': 'External ID already used, generate new one',
      'wager_already_matched': 'Cannot cancel matched wager',
      'wager_already_cancelled': 'Wager was already cancelled',
      'unauthorized': 'Authentication expired, will refresh automatically'
    };
    
    return hints[code] || null;
  }

  private normalizeFromMarketLines(market: any): NormalizedSelectionGroup[] {
    const ml = market?.market_lines;
    const out: NormalizedSelectionGroup[] = [];
    if (!ml) return out;

    const asLine = (v: any) => v == null ? undefined : (isNaN(Number(v)) ? v : Number(v));

    const extractSelections = (item: any): any[] => {
      // common array keys
      if (Array.isArray(item?.selections)) return item.selections;
      if (Array.isArray(item?.options)) return item.options;
      if (Array.isArray(item?.selections_for_line)) return item.selections_for_line;
      if (Array.isArray(item?.participants)) return item.participants;
      if (Array.isArray(item?.sides)) return item.sides;

      // object-keyed sides
      const sideKeys = ['home', 'away', 'over', 'under', 'h', 'a', 'o', 'u'];
      const sides = sideKeys.map(k => item?.[k]).filter(v => v && typeof v === 'object');
      return sides.length ? sides : [];
    };

    // Case 1: array of line objects
    if (Array.isArray(ml)) {
      for (const item of ml) {
        const lineVal = asLine(item?.line ?? item?.total ?? item?.points ?? item?.handicap);
        const sels = extractSelections(item);
        if (sels.length) out.push({ line: lineVal, selections: sels });
      }
      return out;
    }

    // Case 2: dictionary keyed by line
    if (typeof ml === 'object') {
      for (const [k, v] of Object.entries(ml)) {
        const lineVal = asLine(k);
        if (Array.isArray(v)) {
          out.push({ line: lineVal, selections: v as any[] });
        } else if (v && typeof v === 'object') {
          const sels = extractSelections(v);
          if (sels.length) out.push({ line: lineVal, selections: sels });
        }
      }
    }

    return out;
  }

  async buildHierarchy(): Promise<TreeNode[]> {
    try {
      console.log('🚀 Starting buildHierarchy...');
      const tournaments = await this.getTournaments();
      console.log(`✅ Fetched ${tournaments.length} tournaments`);
      const treeNodes: TreeNode[] = [];

      for (const tournament of tournaments) {
        try {
          console.log(`📊 Processing tournament: ${tournament.name}`);
          
          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
          
          const events = await this.getEvents(tournament.id);
          
          // Handle case where events might be null or undefined
          if (!events || !Array.isArray(events)) {
            console.log(`❌ No events found for tournament: ${tournament.name}`);
            continue;
          }
          
          console.log(`✅ Found ${events.length} events for tournament: ${tournament.name}`);
          
          const tournamentNode: TreeNode = {
            id: tournament.id.toString(),
            name: tournament.name,
            type: 'tournament',
            children: [],
          };

          for (const event of events) {
            try {
              console.log(`Fetching markets for event: ${event.name}`);
              
              // Add small delay to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 100));
              
              const markets = await this.getMarkets(event.event_id);
              
              const eventNode: TreeNode = {
                id: event.event_id.toString(),
                name: event.name,
                type: 'event',
                data: { scheduled: event.scheduled, status: event.status },
                children: [],
              };

              // Handle case where markets might be null or undefined
              if (!markets || !Array.isArray(markets)) {
                console.log(`No markets found for event: ${event.name}`);
                // Still add the event node even without markets
                tournamentNode.children!.push(eventNode);
                continue;
              }

              // Group markets by category_name
              const categorizedMarkets = new Map<string, MMMarket[]>();
              
              for (const market of markets) {
                const categoryName = market.category_name || 'Other';
                if (!categorizedMarkets.has(categoryName)) {
                  categorizedMarkets.set(categoryName, []);
                }
                categorizedMarkets.get(categoryName)!.push(market);
                
                // ML SHAPE diagnostics for market_lines
                if (categoryName === 'Game Lines' && /Run Line|Total/i.test(market.name)) {
                  console.log('ML SHAPE', market.name, Array.isArray((market as any).market_lines) ? 'array' : typeof (market as any).market_lines);
                  console.log('ML RAW', market.name, JSON.stringify((market as any).market_lines).slice(0, 1500));
                }
              }

              // Create category nodes
              for (const [categoryName, categoryMarkets] of categorizedMarkets) {
                try {
                  const categoryNode: TreeNode = {
                    id: `${event.event_id}-${categoryName}`,
                    name: categoryName,
                    type: 'category',
                    children: [],
                  };

                  // Process all markets in this category
                  for (const market of categoryMarkets) {
                    try {
                      console.log(`Processing market: ${market.name} in category: ${categoryName}`);
                      
                      const marketNode: TreeNode = {
                        id: market.id.toString(),
                        name: market.name,
                        type: 'market',
                        data: { status: market.status },
                        children: [],
                      };

                      // Diagnose selections shape for spread/total markets
                      if (/Run Line|Total/i.test(market.name)) {
                        console.log(`🔍 DIAGNOSING MARKET: ${market.name}`);
                        console.log(`Raw market JSON (first 2k chars):`, JSON.stringify(market, null, 2).substring(0, 2000));
                        
                        const hasSelections = !!(market.selections && Array.isArray(market.selections) && market.selections.length > 0);
                        let selectionShape = 'none';
                        let lineExamples: any[] = [];
                        
                        if (hasSelections) {
                          // Detect selection shape
                          const firstGroup = market.selections[0];
                          if (Array.isArray(firstGroup)) {
                            selectionShape = 'arrayOfArrays';
                            lineExamples = market.selections.map((group: any[], idx: number) => ({
                              groupIndex: idx,
                              count: group.length,
                              sample: group[0]
                            }));
                          } else if (typeof firstGroup === 'object' && firstGroup !== null) {
                            if ('line' in firstGroup || 'line_id' in firstGroup) {
                              selectionShape = 'flatArray';
                              lineExamples = market.selections.slice(0, 3);
                            } else {
                              selectionShape = 'lineDict';
                              lineExamples = Object.keys(market.selections).slice(0, 3);
                            }
                          }
                        }
                        
                        console.log(`📊 MARKET SUMMARY: { marketName: "${market.name}", hasSelections: ${hasSelections}, selectionShape: "${selectionShape}", lineExamples:`, lineExamples, '}');
                      }

                      // Process selections from both sources
                      const fromSelections = this.normalizeSelections(market);
                      const fromMarketLines = this.normalizeFromMarketLines(market);
                      let normalizedGroups = this.mergeGroupsForMarket(market.name, [...fromSelections, ...fromMarketLines]);

                      // Add diagnostics after merging groups
                      console.log('GROUPS FINAL', market.name, normalizedGroups.map(g => ({ line: g.line, count: g.selections.length })));

                      // De-duplicate selections inside each group
                      const selKey = (s:any) => s?.line_id ?? `${s?.name ?? ''}|${s?.display_name ?? ''}|${s?.odds ?? ''}|${s?.line ?? ''}`;
                      for (const g of normalizedGroups) {
                        g.selections = Array.from(new Map(g.selections.map(s => [selKey(s), s])).values());
                      }

                      // Only show a line sub-layer when there are MULTIPLE unique lines
                      const needsLineLayer = normalizedGroups.length > 1;
                      
                      if (normalizedGroups.length > 0) {
                        if (needsLineLayer) {
                          for (const group of normalizedGroups) {
                            const lineNode: TreeNode = {
                              id: `${market.id}-line-${group.line || 'default'}`,
                              name: group.line !== undefined && group.line !== null ? `Line ${group.line}` : 'Default Line',
                              type: 'category',
                              children: [],
                            };
                            
                            for (const selection of group.selections) {
                              if (selection && (selection.line_id || selection.name || selection.display_name)) {
                                const selectionNode: TreeNode = {
                                  id: selection.line_id || `${market.id}-${selection.name || selection.display_name || 'unknown'}`,
                                  name: selection.display_name || selection.name || 'Unknown Selection',
                                  type: 'selection',
                                  data: {
                                    odds: selection.odds ?? null,
                                    stake: selection.stake ?? null,
                                    line: selection.line ?? group.line ?? null,
                                    display_odds: selection.display_odds || null,
                                    line_id: selection.line_id || undefined,
                                  },
                                };
                                lineNode.children!.push(selectionNode);
                              }
                            }
                            
                            if (lineNode.children!.length > 0) {
                              marketNode.children!.push(lineNode);
                            }
                          }
                        } else {
                          // NO sub-layer → selections directly, strip line
                          for (const selection of normalizedGroups.flatMap(g => g.selections)) {
                            if (!selection) continue;
                                const selectionNode: TreeNode = {
                              id: selection.line_id || `${market.id}-${selection.name || selection.display_name || 'unknown'}`,
                              name: selection.display_name || selection.name || 'Unknown Selection',
                              type: 'selection',
                               data: {
                                 odds: selection.odds ?? null,
                                 stake: selection.stake ?? null,
                                 line: undefined,                // prevent "Line: 0"
                                 display_odds: selection.display_odds || null,
                                 line_id: selection.line_id || undefined,
                               },
                            };
                            marketNode.children!.push(selectionNode);
                          }
                        }
                      } else {
                        console.log(`❌ Market ${market.name} has no normalized selections`);
                      }

                      // Add market even if it has no selections for visibility
                      categoryNode.children!.push(marketNode);
                    } catch (error) {
                      console.error(`Error processing market ${market.name}:`, error);
                      // Continue with next market
                    }
                  }

                  // Add category if it has markets
                  if (categoryNode.children!.length > 0) {
                    eventNode.children!.push(categoryNode);
                  }
                } catch (error) {
                  console.error(`Error processing category ${categoryName}:`, error);
                  // Continue with next category
                }
              }

              if (eventNode.children!.length > 0) {
                tournamentNode.children!.push(eventNode);
              }
            } catch (error) {
              console.error(`Error processing event ${event.name}:`, error);
              // Continue with next event
            }
          }

          if (tournamentNode.children!.length > 0) {
            treeNodes.push(tournamentNode);
          }
        } catch (error) {
          console.error(`Error processing tournament ${tournament.name}:`, error);
          // Continue with next tournament
        }
      }

      console.log(`🎯 Final result: ${treeNodes.length} tournaments with data`);
      console.log('Tree structure:', treeNodes.map(t => ({ 
        name: t.name, 
        events: t.children?.length || 0,
        totalCategories: t.children?.reduce((sum, event) => sum + (event.children?.length || 0), 0) || 0
      })));
      
      return treeNodes;
    } catch (error) {
      console.error('💥 Error building hierarchy:', error);
      return [];
    }
  }
}

export const prophetXAPI = new ProphetXAPI();