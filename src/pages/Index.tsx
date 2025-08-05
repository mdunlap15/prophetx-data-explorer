import { useState, useEffect } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { DataTreeView } from '@/components/DataTreeView';
import { prophetXAPI, TreeNode } from '@/services/prophetx-api';
import { selectionCache, flattenSelectionCache, SelectionRecord } from '@/services/selection-cache';
import { setOddsLadder, buildWagerPayload, generateExternalId, testOddsConversions } from '@/utils/betting-utils';
import { useWagerPolling } from '@/hooks/use-wager-polling';
import { toast } from 'sonner';
import { TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const Index = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(false);
  const [testWagerId, setTestWagerId] = useState<string | null>(null);
  const [selCache, setSelCache] = useState(selectionCache);
  const [activeSel, setActiveSel] = useState<SelectionRecord | null>(null);

  // Phase 1: Wager polling for testing
  const wagerPolling = useWagerPolling({
    enabled: isAuthenticated,
    pollInterval: 15000 // 15 seconds
  });

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

  // Phase 1: Test wager placement
  const handleTestWager = async () => {
    try {
      const all = flattenSelectionCache(selCache);
      const sel = activeSel ?? all[0];
      
      if (!sel) {
        toast.error('Pick a selection first');
        return;
      }

      // Build wager payload using the real line_id
      const payload = buildWagerPayload({
        line_id: sel.line_id,
        odds: 2.0, // Fixed test odds
        stake: 1   // Fixed test stake
      });

      console.log('📦 Wager payload:', payload);
      console.log('🧪 Testing with selection:', sel);

      const result = await prophetXAPI.placeWager(payload);
      console.log('✅ Wager result:', result);

      if (result.success && result.wager) {
        setTestWagerId(result.wager.external_id);
        toast.success(`✅ Test wager placed: ${result.wager.external_id}`);
        // Refresh wager list
        wagerPolling.refresh();
      } else {
        toast.error('❌ Failed to place test wager');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to place test wager';
      toast.error(`❌ ${errorMessage}`);
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
              onSelectSelection={(rec) => {
                setActiveSel({
                  line_id: rec.selectionId,
                  internalId: rec.selectionId,
                  name: rec.displayName,
                  odds: null,
                  stake: null,
                  line: rec.line,
                  eventId: '',
                  marketId: '',
                  lineKey: '',
                  rawData: {}
                });
              }}
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
                    disabled={!isAuthenticated || (!activeSel && flattenSelectionCache(selCache).length === 0)}
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
                  <div className="text-sm text-muted-foreground">
                    Selected: {activeSel.name} (ID: {activeSel.line_id})
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
