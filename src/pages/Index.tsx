import { useState, useEffect } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { DataTreeView } from '@/components/DataTreeView';
import { prophetXAPI, TreeNode } from '@/services/prophetx-api';
import { selectionCache, flattenSelectionCache, SelectionRecord } from '@/services/selection-cache';
import { setOddsLadder, buildWagerPayload, generateExternalId, testOddsConversions, americanToDecimal, decimalToAmerican, clampToLadder, parseDisplayOdds, parseAmericanString } from '@/utils/betting-utils';
import { useWagerPolling } from '@/hooks/use-wager-polling';
import { toast } from 'sonner';
import { TrendingUp, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const Index = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [testWagerId, setTestWagerId] = useState<string | null>(null);
  const [selCache, setSelCache] = useState(selectionCache);
  const [activeSel, setActiveSel] = useState<SelectionRecord | null>(null);
  
  // Wager Composer State
  const [oddsMode, setOddsMode] = useState<'american' | 'decimal'>('american');
  const [oddsInput, setOddsInput] = useState<string>('');
  const [stakeInput, setStakeInput] = useState<string>('10');
  const [oddsLadder, setOddsLadder] = useState<number[]>([]);

  // Phase 1: Wager polling for testing
  const wagerPolling = useWagerPolling({
    enabled: isAuthenticated,
    pollInterval: 15000 // 15 seconds
  });

  // Load odds ladder when authenticated
  useEffect(() => {
    const loadOddsLadder = async () => {
      console.log('🔍 useEffect triggered - isAuthenticated:', isAuthenticated, 'oddsLadder.length:', oddsLadder.length);
      
      if (isAuthenticated && oddsLadder.length === 0) {
        try {
          console.log('📊 Loading odds ladder...');
          const ladder = await prophetXAPI.getOddsLadder();
          console.log('📊 Raw ladder response:', ladder);
          setOddsLadder(ladder);
          console.log(`✅ Odds ladder loaded: ${ladder.length} ticks`);
        } catch (error) {
          console.warn('⚠️ Failed to load odds ladder:', error);
        }
      } else {
        console.log('🔍 Skipping odds ladder load - isAuthenticated:', isAuthenticated, 'oddsLadder.length:', oddsLadder.length);
      }
    };

    loadOddsLadder();
  }, [isAuthenticated, oddsLadder.length]);

  const handleAuthentication = async (accessKey: string, secretKey: string) => {
    setIsLoading(true);
    setAuthError(null);
    
    try {
      await prophetXAPI.authenticate(accessKey, secretKey);
      setIsAuthenticated(true);
      toast.success('Authentication successful');
      
      // Phase 1: Load odds ladder and run self-tests
      try {
        console.log('📊 Loading odds ladder...');
        const ladder = await prophetXAPI.getOddsLadder();
        setOddsLadder(ladder);
        console.log(`✅ Odds ladder loaded: ${ladder.length} ticks`);
        
        // Run self-tests
        testOddsConversions();
      } catch (ladderError) {
        console.warn('⚠️ Failed to load odds ladder:', ladderError);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      setAuthError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadData = async () => {
    console.log('🔄 Starting data load...');
    setIsDataLoading(true);
    setTreeData([]);
    
    try {
      const data = await prophetXAPI.buildHierarchy();
      console.log('📦 Received data in Index.tsx:', data.length, 'tournaments');
      console.log('Data structure:', data);
      setTreeData(data);
      
      // Phase 1: Build selection cache from tree data
      selectionCache.buildFromTreeData(data);
      setSelCache(selectionCache);
      const cacheStats = selectionCache.getStats();
      console.log('📊 Selection cache stats:', cacheStats);
      
      if (data.length > 0) {
        toast.success(`✅ Loaded ${data.length} tournaments with ${cacheStats.selections} wager-eligible selections`);
      } else {
        toast.warning('⚠️ No tournament data was loaded');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load data';
      toast.error(`❌ ${errorMessage}`);
      console.error('💥 Data loading error:', error);
    } finally {
      setIsDataLoading(false);
      console.log('✅ Data loading completed');
    }
  };

  // Compute decimal odds for API with proper parsing
  const computeDecimalOdds = (): { decimalRaw: number; decimalSnapped: number } => {
    try {
      const decimalRaw = oddsMode === 'american'
        ? americanToDecimal(parseAmericanString(oddsInput))
        : Number(oddsInput);
      const decimalSnapped = clampToLadder(decimalRaw, oddsLadder);
      return { decimalRaw, decimalSnapped };
    } catch {
      return { decimalRaw: 2.0, decimalSnapped: 2.0 }; // fallback
    }
  };

  // Toggle odds mode with conversion
  const handleOddsToggle = () => {
    try {
      if (oddsMode === 'american') {
        // American → Decimal
        const american = parseAmericanString(oddsInput);
        const decimal = americanToDecimal(american);
        setOddsInput(decimal.toFixed(2));
        setOddsMode('decimal');
      } else {
        // Decimal → American
        const decimal = Number(oddsInput);
        const american = decimalToAmerican(decimal);
        setOddsInput(String(american));
        setOddsMode('american');
      }
    } catch (error) {
      console.warn('Odds conversion failed:', error);
    }
  };

  // Handle selection change - prefill odds with sign preservation
  const handleSelectionChange = (rec: SelectionRecord) => {
    setActiveSel(rec);

    // Pre-fill odds from selection data
    const node = findSelectionNode(rec.line_id);
    if (node?.data?.display_odds) {
      // Use the exact display_odds string (e.g., "-146", "+150")
      setOddsInput(node.data.display_odds.replace(/[^\d.-]/g, ''));
      setOddsMode('american');
      return;
    }
    
    if (node?.data?.odds) {
      try {
        const american = decimalToAmerican(node.data.odds);
        setOddsInput(String(american)); // Keep the sign!
        setOddsMode('american');
      } catch {
        setOddsInput(node.data.odds.toFixed(2));
        setOddsMode('decimal');
      }
    } else {
      // Default odds
      setOddsInput(oddsMode === 'american' ? '-110' : '1.91');
    }
  };

  // Find selection node by ID
  const findSelectionNode = (selectionId: string): TreeNode | null => {
    const search = (nodes: TreeNode[]): TreeNode | null => {
      for (const node of nodes) {
        if (node.type === 'selection' && (node.data?.line_id === selectionId || node.id === selectionId)) {
          return node;
        }
        if (node.children) {
          const found = search(node.children);
          if (found) return found;
        }
      }
      return null;
    };
    return search(treeData);
  };

  // Phase 1: Test wager placement with composer
  const handleTestWager = async () => {
    try {
      if (!activeSel?.line_id) {
        toast.error('Pick a selection first');
        return;
      }

      const stake = Number(stakeInput);
      if (!(stake > 0)) {
        toast.error('Enter a stake > 0');
        return;
      }

      if (!oddsInput.trim()) {
        toast.error('Enter valid odds');
        return;
      }

      const { decimalSnapped } = computeDecimalOdds();
      
      // Build wager payload using the real line_id and clamped decimal odds
      const payload = {
        line_id: activeSel.line_id,
        odds: decimalSnapped,
        stake: stake,
        external_id: `test_${Date.now()}`
      };

      console.log('PLACE_WAGER_PAYLOAD', payload);
      console.log('🧪 Testing with selection:', activeSel);

      const result = await prophetXAPI.placeWager(payload);
      console.log('✅ Wager result:', result);

      if (result.success && result.wager) {
        setTestWagerId(result.wager.external_id);
        toast.success(`✅ Test wager placed: ${result.wager.external_id}`);
        wagerPolling.refresh();
      } else {
        toast.error('❌ Failed to place test wager');
      }
    } catch (error: any) {
      const msg = error?.message || error?.details || 'Unknown error';
      const code = error?.code || error?.status || '';
      toast.error(`Place wager failed: ${code} ${msg}`);
      console.error('💥 Test wager error:', error);
    }
  };

  // Phase 1: Test wager cancellation
  const handleTestCancel = async () => {
    if (!testWagerId) {
      toast.error('No test wager to cancel');
      return;
    }

    try {
      const result = await prophetXAPI.cancelWager({ wager_id: testWagerId });
      
      if (result.success) {
        toast.success('✅ Test wager canceled successfully');
        setTestWagerId(null);
        wagerPolling.refresh();
      } else {
        toast.error('❌ Failed to cancel test wager');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to cancel test wager';
      toast.error(`❌ ${errorMessage}`);
      console.error('💥 Test cancel error:', error);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center space-x-2">
            <TrendingUp className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">ProphetX Data Proof Tool</h1>
          </div>
          <p className="text-muted-foreground">
            Milestone #1: Authenticate and fetch the complete sports betting hierarchy
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
          <div className="flex flex-col justify-start">
            <AuthForm
              onAuthenticated={handleAuthentication}
              isLoading={isLoading}
              error={authError}
            />
          </div>
          
          <div className="lg:col-span-1">
            <DataTreeView
              data={treeData}
              onLoadData={handleLoadData}
              isLoading={isDataLoading}
              isAuthenticated={isAuthenticated}
              onSelectSelection={handleSelectionChange}
            />
          </div>
        </div>

        {treeData.length > 0 && (
          <div className="mt-6 space-y-6">
            <div className="bg-card border rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-2">Data Summary</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="font-medium">Tournaments:</span>{' '}
                  <span className="text-muted-foreground">{treeData.length}</span>
                </div>
                <div>
                  <span className="font-medium">Events:</span>{' '}
                  <span className="text-muted-foreground">
                    {treeData.reduce((acc, tournament) => acc + (tournament.children?.length || 0), 0)}
                  </span>
                </div>
                <div>
                  <span className="font-medium">Markets:</span>{' '}
                  <span className="text-muted-foreground">
                    {treeData.reduce((acc, tournament) => 
                      acc + (tournament.children?.reduce((eventAcc, event) => 
                        eventAcc + (event.children?.length || 0), 0) || 0), 0)}
                  </span>
                </div>
                <div>
                  <span className="font-medium">Wager-Eligible:</span>{' '}
                  <span className="text-muted-foreground">
                    {flattenSelectionCache(selCache).length}
                  </span>
                </div>
              </div>
            </div>

            {/* Phase 1: Test Controls */}
            <Card>
              <CardHeader>
                <CardTitle>Phase 1: Wager Testing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Button 
                    onClick={handleTestWager}
                    disabled={!isAuthenticated || !activeSel?.line_id || Number(stakeInput) <= 0 || !oddsInput.trim() || oddsLadder.length === 0}
                    variant="outline"
                  >
                    Place Test Wager
                  </Button>
                  <Button 
                    onClick={handleTestCancel}
                    disabled={!testWagerId}
                    variant="destructive"
                  >
                    Cancel Test Wager
                  </Button>
                </div>
                
                {testWagerId && (
                  <div className="text-sm text-muted-foreground">
                    Test Wager ID: {testWagerId}
                  </div>
                )}
                {activeSel && (
                  <div className="space-y-3">
                    <div className="text-sm text-muted-foreground">
                      Selected: {activeSel.name} (ID: {activeSel.line_id})
                    </div>
                    
                    {/* Wager Composer */}
                    <div className="border rounded-lg p-3 bg-muted/50">
                      <h5 className="font-medium text-sm mb-2">Wager Composer</h5>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="odds" className="text-xs">
                            Odds
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="ml-2 h-5 px-1 text-xs"
                              onClick={handleOddsToggle}
                            >
                              {oddsMode === 'american' ? (
                                <>American <ToggleLeft className="h-3 w-3 ml-1" /></>
                              ) : (
                                <>Decimal <ToggleRight className="h-3 w-3 ml-1" /></>
                              )}
                            </Button>
                          </Label>
                          <Input
                            id="odds"
                            type="text"
                            value={oddsInput}
                            onChange={(e) => setOddsInput(e.target.value)}
                            placeholder={oddsMode === 'american' ? '-110' : '1.91'}
                            className="h-8 text-sm"
                          />
                        </div>
                        
                        <div>
                          <Label htmlFor="stake" className="text-xs">Stake</Label>
                          <Input
                            id="stake"
                            type="number"
                            value={stakeInput}
                            onChange={(e) => setStakeInput(e.target.value)}
                            placeholder="10"
                            min="0.01"
                            step="0.01"
                            className="h-8 text-sm"
                          />
                        </div>
                      </div>
                      
                      <div className="text-xs text-muted-foreground mt-2">
                        {(() => {
                          const { decimalRaw, decimalSnapped } = computeDecimalOdds();
                          return decimalSnapped !== decimalRaw ? (
                            <>
                              Decimal to send: <span className="font-mono">{decimalSnapped.toFixed(4)}</span>
                              <span className="text-yellow-600"> (snapped from {decimalRaw.toFixed(4)})</span>
                            </>
                          ) : (
                            <>Decimal to send: <span className="font-mono">{decimalRaw.toFixed(4)}</span></>
                          );
                        })()}
                        {oddsLadder.length === 0 && (
                          <span className="ml-2 text-orange-600">Loading odds ladder...</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="border rounded-lg p-3">
                  <h4 className="font-medium mb-2">My Wagers ({wagerPolling.wagers.length})</h4>
                  {wagerPolling.isLoading && <div className="text-sm text-muted-foreground">Loading...</div>}
                  {wagerPolling.error && <div className="text-sm text-red-600">Error: {wagerPolling.error}</div>}
                  {wagerPolling.wagers.length === 0 && !wagerPolling.isLoading && (
                    <div className="text-sm text-muted-foreground">No wagers found</div>
                  )}
                  <div className="max-h-64 overflow-y-auto">
                    {wagerPolling.wagers.map(wager => (
                      <div key={wager.wager_id} className="text-xs bg-muted p-2 rounded mb-1">
                        <div>ID: {wager.external_id}</div>
                        <div>Status: {wager.status} | Matching: {wager.matching_status}</div>
                        <div>Stake: {wager.stake} | Odds: {wager.odds}</div>
                      </div>
                    ))}
                  </div>
                  {wagerPolling.hasMore && (
                    <Button 
                      onClick={wagerPolling.loadMore} 
                      variant="ghost" 
                      size="sm"
                      className="mt-2"
                    >
                      Load More
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
