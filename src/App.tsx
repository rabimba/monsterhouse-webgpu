import { HeaderBar } from './components/HeaderBar';
import { LeftSidebar } from './components/LeftSidebar';
import { RightSidebar } from './components/RightSidebar';
import { StageViewport } from './components/StageViewport';
import { ArchitectureTab } from './components/tabs/ArchitectureTab';
import { CacheTab } from './components/tabs/CacheTab';
import { CameraVisionTab } from './components/tabs/CameraVisionTab';
import { ConversationTab } from './components/tabs/ConversationTab';
import { MetricsTab } from './components/tabs/MetricsTab';
import { PromptsTab } from './components/tabs/PromptsTab';
import { ServicesTab } from './components/tabs/ServicesTab';
import { ToolsTab } from './components/tabs/ToolsTab';
import { useMonsterStore } from './store/useMonsterStore';

export function App() {
  const activeTab = useMonsterStore((s) => s.activeTab);
  const isProjectorPopup =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('projector') === '1';

  if (isProjectorPopup) {
    return <StageViewport isProjectorPopup />;
  }

  const renderCenterWorkspace = () => {
    switch (activeTab) {
      case 'CONVERSATION':
        return <ConversationTab />;
      case 'CACHE':
        return <CacheTab />;
      case 'METRICS':
        return <MetricsTab />;
      case 'SERVICES':
        return <ServicesTab />;
      case 'PROMPTS':
        return <PromptsTab />;
      case 'TOOLS':
        return <ToolsTab />;
      case 'VISION':
        return (
          <div className="mh-vision-span">
            <CameraVisionTab />
          </div>
        );
      case 'ARCHITECTURE':
        return <ArchitectureTab />;
    }
  };

  return (
    <div className="mh-app">
      <HeaderBar />
      <StageViewport />
      <main className="mh-desk-grid">
        <LeftSidebar />
        {renderCenterWorkspace()}
        {activeTab !== 'VISION' && <RightSidebar />}
      </main>
    </div>
  );
}

export default App;
