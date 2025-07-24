export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
}

export interface Sport {
  id: string;
  name: string;
}

export interface Event {
  eventId: string;
  name: string;
  startTime: string;
}

export interface MarketCategory {
  code: string;
  name: string;
}

export interface Market {
  marketId: string;
  name: string;
  state: string;
}

export interface Selection {
  selectionId: string;
  name: string;
  oddsDecimal: number;
  availableLiquidity: number;
}

export interface TreeNode {
  id: string;
  name: string;
  type: 'sport' | 'event' | 'category' | 'market' | 'selection';
  children?: TreeNode[];
  data?: {
    startTime?: string;
    oddsDecimal?: number;
    availableLiquidity?: number;
    state?: string;
  };
}

const EDGE_FUNCTION_URL = 'https://wdknwmgqggtcayrdjvuu.supabase.co/functions/v1/prophetx-proxy';

class ProphetXAPI {
  private accessToken: string | null = null;
  private rateLimitRemaining: number = 100;

  async authenticate(accessKey: string, secretKey: string): Promise<string> {
    // Try different common authentication endpoints
    const endpoints = ['/v1/auth/token', '/v1/token', '/oauth/token', '/api/v1/token'];
    
    for (const endpoint of endpoints) {
      console.log(`Trying authentication endpoint: ${endpoint}`);
      
      const response = await fetch(EDGE_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          method: 'POST',
          endpoint,
          body: { accessKey, secretKey }
        }),
      });

      if (!response.ok) {
        console.log(`Endpoint ${endpoint} failed with status: ${response.status}`);
        continue;
      }

      const data = await response.json();
      
      // Check if the response contains an error (from our edge function)
      if (data.error) {
        console.log(`Endpoint ${endpoint} returned error: ${data.error}`);
        continue;
      }
      
      // Check if we got a valid token response
      if (data.accessToken) {
        console.log(`Authentication successful with endpoint: ${endpoint}`);
        this.accessToken = data.accessToken;
        this.updateRateLimit(response);
        return data.accessToken;
      }
      
      console.log(`Endpoint ${endpoint} didn't return accessToken:`, data);
    }
    
    throw new Error('Authentication failed: Unable to authenticate with any known endpoint. Please check your credentials.');
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

  async getSports(): Promise<Sport[]> {
    return this.makeRequest<Sport[]>('/v1/sports');
  }

  async getEvents(sportId: string): Promise<Event[]> {
    return this.makeRequest<Event[]>(`/v1/events?sportId=${sportId}&state=OPEN`);
  }

  async getMarketCategories(eventId: string): Promise<MarketCategory[]> {
    return this.makeRequest<MarketCategory[]>(`/v1/market-categories?eventId=${eventId}`);
  }

  async getMarkets(eventId: string, categoryCode: string): Promise<Market[]> {
    return this.makeRequest<Market[]>(`/v1/markets?eventId=${eventId}&category=${categoryCode}`);
  }

  async getSelections(marketId: string): Promise<Selection[]> {
    return this.makeRequest<Selection[]>(`/v1/selections?marketId=${marketId}`);
  }

  async buildHierarchy(): Promise<TreeNode[]> {
    const sports = await this.getSports();
    const treeNodes: TreeNode[] = [];

    for (const sport of sports) {
      console.log(`Fetching events for sport: ${sport.name}`);
      const events = await this.getEvents(sport.id);
      
      // Limit to first 3 OPEN events per sport
      const limitedEvents = events.slice(0, 3);
      
      const sportNode: TreeNode = {
        id: sport.id,
        name: sport.name,
        type: 'sport',
        children: [],
      };

      for (const event of limitedEvents) {
        console.log(`Fetching categories for event: ${event.name}`);
        const categories = await this.getMarketCategories(event.eventId);
        
        const eventNode: TreeNode = {
          id: event.eventId,
          name: event.name,
          type: 'event',
          data: { startTime: event.startTime },
          children: [],
        };

        for (const category of categories) {
          console.log(`Fetching markets for category: ${category.name} in event: ${event.name}`);
          const markets = await this.getMarkets(event.eventId, category.code);
          
          const categoryNode: TreeNode = {
            id: `${event.eventId}-${category.code}`,
            name: category.name,
            type: 'category',
            children: [],
          };

          for (const market of markets) {
            console.log(`Fetching selections for market: ${market.name}`);
            const selections = await this.getSelections(market.marketId);
            
            const marketNode: TreeNode = {
              id: market.marketId,
              name: market.name,
              type: 'market',
              data: { state: market.state },
              children: [],
            };

            for (const selection of selections) {
              const selectionNode: TreeNode = {
                id: selection.selectionId,
                name: selection.name,
                type: 'selection',
                data: {
                  oddsDecimal: selection.oddsDecimal,
                  availableLiquidity: selection.availableLiquidity,
                },
              };
              marketNode.children!.push(selectionNode);
            }

            if (marketNode.children!.length > 0) {
              categoryNode.children!.push(marketNode);
            }
          }

          if (categoryNode.children!.length > 0) {
            eventNode.children!.push(categoryNode);
          }
        }

        if (eventNode.children!.length > 0) {
          sportNode.children!.push(eventNode);
        }
      }

      if (sportNode.children!.length > 0) {
        treeNodes.push(sportNode);
      }
    }

    return treeNodes;
  }
}

export const prophetXAPI = new ProphetXAPI();