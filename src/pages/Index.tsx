import { useState } from 'react';
import { AuthForm } from '@/components/AuthForm';
import { DataTreeView } from '@/components/DataTreeView';
import { prophetXAPI, TreeNode } from '@/services/prophetx-api';
import { toast } from 'sonner';
import { TrendingUp } from 'lucide-react';

const Index = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(false);

  const handleAuthentication = async (accessKey: string, secretKey: string) => {
    setIsLoading(true);
    setAuthError(null);
    
    try {
      await prophetXAPI.authenticate(accessKey, secretKey);
      setIsAuthenticated(true);
      toast.success('Authentication successful');
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
      
      if (data.length > 0) {
        toast.success(`✅ Loaded ${data.length} tournaments with market data`);
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
            />
          </div>
        </div>

        {treeData.length > 0 && (
          <div className="mt-6">
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
                  <span className="font-medium">Selections:</span>{' '}
                  <span className="text-muted-foreground">
                    {treeData.reduce((acc, tournament) => 
                      acc + (tournament.children?.reduce((eventAcc, event) => 
                        eventAcc + (event.children?.reduce((marketAcc, market) => 
                          marketAcc + (market.children?.length || 0), 0) || 0), 0) || 0), 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Index;
