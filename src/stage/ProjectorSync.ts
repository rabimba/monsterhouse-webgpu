import type {
  BlendshapeWeights,
  KeystoneCorners,
  MoodTag,
  StageViewMode,
  VisualCueRule,
} from '../types/monster';

export type ProjectorMessage =
  | {
      type: 'FRAME_STATE';
      weights: BlendshapeWeights;
      mood: MoodTag;
      cueRule: VisualCueRule;
      viewMode: StageViewMode;
      keystone: KeystoneCorners;
    }
  | {
      type: 'CANDY_BARRAGE';
    };

const CHANNEL_NAME = 'monsterhouse-projector-v1';

export class ProjectorSyncBus {
  private channel: BroadcastChannel | null = null;

  constructor(onMessage?: (msg: ProjectorMessage) => void) {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      if (onMessage) {
        this.channel.onmessage = (ev: MessageEvent<ProjectorMessage>) => {
          if (ev.data && typeof ev.data === 'object') {
            onMessage(ev.data);
          }
        };
      }
    }
  }

  publish(msg: ProjectorMessage): void {
    this.channel?.postMessage(msg);
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
  }
}

export const DEFAULT_KEYSTONE: KeystoneCorners = {
  topLeft: [0, 0],
  topRight: [100, 0],
  bottomRight: [100, 100],
  bottomLeft: [0, 100],
};
