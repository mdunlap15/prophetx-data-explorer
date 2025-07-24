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
  selections: Array<Array<{
    line_id: string;
    name: string;
    odds: number;
    stake: number;
    line: number;
  }>>;
}

export interface TreeNode {
  id: string;
  name: string;
  type: 'tournament' | 'event' | 'market' | 'selection';
  children?: TreeNode[];
  data?: {
    scheduled?: string;
    odds?: number;
    stake?: number;
    status?: string;
    line?: number;
  };
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
    const response = await this.makeRequest<{ data: { markets: MMMarket[] } }>(`/mm/get_markets?event_id=${eventId}`);
    return response.data.markets;
  }

  async buildHierarchy(): Promise<TreeNode[]> {
    console.log('Fetching tournaments with active events...');
    const tournaments = await this.getTournaments();
    const treeNodes: TreeNode[] = [];

    // Limit to first 3 tournaments for demo
    const limitedTournaments = tournaments.slice(0, 3);

    for (const tournament of limitedTournaments) {
      console.log(`Fetching events for tournament: ${tournament.name}`);
      const events = await this.getEvents(tournament.id);
      
      // Limit to first 3 events per tournament
      const limitedEvents = events.slice(0, 3);
      
      const tournamentNode: TreeNode = {
        id: tournament.id.toString(),
        name: tournament.name,
        type: 'tournament',
        children: [],
      };

      for (const event of limitedEvents) {
        console.log(`Fetching markets for event: ${event.name}`);
        const markets = await this.getMarkets(event.event_id);
        
        const eventNode: TreeNode = {
          id: event.event_id.toString(),
          name: event.name,
          type: 'event',
          data: { scheduled: event.scheduled, status: event.status },
          children: [],
        };

        // Limit to first 5 markets per event
        const limitedMarkets = markets.slice(0, 5);

        for (const market of limitedMarkets) {
          console.log(`Processing market: ${market.name}`);
          
          const marketNode: TreeNode = {
            id: market.id.toString(),
            name: market.name,
            type: 'market',
            data: { status: market.status },
            children: [],
          };

          // Process selections from the market
          for (const selectionGroup of market.selections) {
            for (const selection of selectionGroup) {
              const selectionNode: TreeNode = {
                id: selection.line_id,
                name: selection.name,
                type: 'selection',
                data: {
                  odds: selection.odds,
                  stake: selection.stake,
                  line: selection.line,
                },
              };
              marketNode.children!.push(selectionNode);
            }
          }

          if (marketNode.children!.length > 0) {
            eventNode.children!.push(marketNode);
          }
        }

        if (eventNode.children!.length > 0) {
          tournamentNode.children!.push(eventNode);
        }
      }

      if (tournamentNode.children!.length > 0) {
        treeNodes.push(tournamentNode);
      }
    }

    return treeNodes;
  }
}

export const prophetXAPI = new ProphetXAPI();