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
    line?: number | null;
    display_odds?: string | null;
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

const EDGE_FUNCTION_URL = 'https://wdknwmgqggtcayrdjvuu.supabase.co/functions/v1/prophetx-proxy';

class ProphetXAPI {
  private accessToken: string | null = null;
  private rateLimitRemaining: number = 100;

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
      this.updateRateLimit(response);
      return data.data.access_token;
    }
    
    throw new Error('Authentication failed: No access token received');
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

  private async makeRequest<T>(endpoint: string): Promise<T> {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    await this.checkRateLimit();

    const response = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'GET',
        endpoint,
        accessToken: this.accessToken
      }),
    });

    this.updateRateLimit(response);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    return response.json();
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
   * Normalizes market selections from various shapes into grouped format
   * Handles: array of arrays, flat arrays, and dictionary formats
   */
  private normalizeSelections(market: MMMarket): NormalizedSelectionGroup[] {
    const s = market.selections;
    const groups: NormalizedSelectionGroup[] = [];
    if (!s) return groups;

    try {
      // Case A: DICTIONARY FIRST (Record<line, Selection[]>)
      if (typeof s === 'object' && !Array.isArray(s)) {
        for (const [k, arr] of Object.entries(s as Record<string, any[]>)) {
          if (Array.isArray(arr)) {
            const n = Number(k);
            groups.push({ line: Number.isNaN(n) ? k : n, selections: arr });
          }
        }
        return groups;
      }

      // Case B: ARRAY OF ARRAYS (Selection[][])
      if (Array.isArray(s) && s.length && Array.isArray((s as any)[0])) {
        (s as any[][]).forEach(group => {
          if (Array.isArray(group) && group.length) {
            // derive real line if present; NEVER use array index
            const ln = group.find(x => x && x.line != null)?.line ?? undefined;
            groups.push({ line: ln, selections: group as any[] });
          }
        });
        return groups;
      }

      // Case C: FLAT ARRAY (Selection[])
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
                
                // Add diagnostic for Game Lines markets
                if (categoryName === 'Game Lines' && /Moneyline|Run Line|Total/i.test(market.name)) {
                  const s = market.selections;
                  console.log('SELECTIONS TYPE', market.name, Array.isArray(s) ? 'array' : typeof s, !Array.isArray(s) && s ? Object.keys(s).slice(0,5) : undefined);
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

                      // Process selections using robust normalization
                      const normalizedGroups = this.normalizeSelections(market);
                      
                      if (normalizedGroups.length > 0) {
                        const isLineMarket = /Run Line|Totals?|Spread|Handicap|Over|Under|Puck Line/i.test(market.name);
                        const hasMeaningfulLine = (v: unknown) => v !== null && v !== undefined && !(typeof v === 'number' && v === 0);
                        const needsLineLayer =
                          normalizedGroups.length > 1 ||
                          (isLineMarket && normalizedGroups.some(g => hasMeaningfulLine(g.line)));

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
                                  id: selection.line_id || `${market.id}-${selection.name || 'unknown'}`,
                                  name: selection.display_name || selection.name || 'Unknown Selection',
                                  type: 'selection',
                                  data: {
                                    odds: selection.odds !== null && selection.odds !== undefined ? selection.odds : null,
                                    stake: selection.stake !== null && selection.stake !== undefined ? selection.stake : null,
                                    line: selection.line !== null && selection.line !== undefined ? selection.line : null,
                                    display_odds: selection.display_odds || null,
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
                          // For single-line markets (Moneyline), attach selections directly
                          for (const selection of normalizedGroups[0].selections) {
                            if (selection && (selection.line_id || selection.name || selection.display_name)) {
                              const selectionNode: TreeNode = {
                                id: selection.line_id || `${market.id}-${selection.name || 'unknown'}`,
                                name: selection.display_name || selection.name || 'Unknown Selection',
                                type: 'selection',
                                data: {
                                  odds: selection.odds !== null && selection.odds !== undefined ? selection.odds : null,
                                  stake: selection.stake !== null && selection.stake !== undefined ? selection.stake : null,
                                  line: selection.line !== null && selection.line !== undefined ? selection.line : null,
                                  display_odds: selection.display_odds || null,
                                },
                              };
                              marketNode.children!.push(selectionNode);
                            }
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