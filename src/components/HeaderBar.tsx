import { ExternalLink, Power, Sparkles } from 'lucide-react';
import { useMonsterStore } from '../store/useMonsterStore';
import type { WorkspaceTab } from '../types/monster';

const TABS: WorkspaceTab[] = [
  'CONVERSATION',
  'CACHE',
  'METRICS',
  'SERVICES',
  'PROMPTS',
  'TOOLS',
  'VISION',
  'ARCHITECTURE',
];

export function HeaderBar() {
  const connected = useMonsterStore((s) => s.connected);
  const activeTab = useMonsterStore((s) => s.activeTab);
  const rendererBackend = useMonsterStore((s) => s.rendererBackend);

  const setActiveTab = useMonsterStore((s) => s.setActiveTab);
  const connectAgent = useMonsterStore((s) => s.connectAgent);
  const disconnectAgent = useMonsterStore((s) => s.disconnectAgent);
  const wakeUpNewVisitors = useMonsterStore((s) => s.wakeUpNewVisitors);

  const openProjectorPopup = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('projector', '1');
    window.open(url.toString(), 'MonsterHouseProjector', 'width=1280,height=720,menubar=no,toolbar=no');
  };

  return (
    <>
      <header className="mh-header">
        <div className="mh-brand">
          <h1 className="mh-brand-title">Monster House Agent</h1>
          <span className="mh-brand-sub">100% In-Browser WebGPU</span>
        </div>

        <div className="mh-header-actions">
          <span className="mh-pill" title="3D WebGPU Stage Status">
            <span className="mh-dot live" />
            {rendererBackend} connected
          </span>

          <button
            type="button"
            className="mh-btn"
            onClick={openProjectorPopup}
            title="Open frameless garage-door projector window synced via BroadcastChannel"
          >
            <ExternalLink size={13} />
            Launch Projector
          </button>

          <button
            type="button"
            className="mh-btn"
            onClick={() => void wakeUpNewVisitors()}
            title="Trigger new trick-or-treater arrival greeting"
          >
            <Sparkles size={13} color="#91e000" />
            Wake up / new visitors
          </button>

          <button
            type="button"
            className={connected ? 'mh-btn mh-btn-danger' : 'mh-btn mh-btn-primary'}
            onClick={() => void (connected ? disconnectAgent() : connectAgent())}
          >
            <Power size={13} />
            {connected ? 'Disconnect' : 'Connect'}
          </button>
        </div>
      </header>

      <nav className="mh-tabbar" aria-label="MonsterHouse Control Desk Tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`mh-tab-btn ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'VISION' ? 'CAMERA VISION' : tab}
          </button>
        ))}
      </nav>
    </>
  );
}
