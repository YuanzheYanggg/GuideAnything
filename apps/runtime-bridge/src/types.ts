import type {
  BridgeEventV1,
  BridgeModelRoleV1,
} from '@guideanything/contracts';

export type RuntimeHealthStatus = 'READY' | 'DEGRADED';

export interface ModelRoleHealth {
  readonly ready: boolean;
  readonly model: string | null;
  readonly requiredEffort: 'MEDIUM' | 'HIGH';
  readonly supportedEfforts: readonly string[];
}

export interface RuntimeHealth {
  readonly status: RuntimeHealthStatus;
  readonly version: string;
  readonly roles: Readonly<Record<BridgeModelRoleV1, ModelRoleHealth>>;
  readonly counters: {
    readonly instructionSources: number;
    readonly mcpStartups: number;
    readonly unexpectedCapabilities: number;
    readonly maxInputTokens: number;
  };
  readonly reasonCodes: readonly string[];
}

export interface CodexRunHandle {
  readonly requestId: string;
  readonly runId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly events: AsyncIterable<BridgeEventV1>;
  readonly planVersion: number;
  cancel(): Promise<void>;
  steer(planVersion: number, instruction: string): Promise<void>;
}
