export interface StageConfig {
  stage: 'dev' | 'stage' | 'prod';
  region: string;
  allowedOrigins: string[];
  instanceBaseUrl: string;
}

const defaults: Record<string, StageConfig> = {
  dev: {
    stage: 'dev',
    region: 'eu-central-1',
    allowedOrigins: ['http://localhost:5173'],
    instanceBaseUrl: 'https://dev.example.peertube-serverless.com',
  },
  stage: {
    stage: 'stage',
    region: 'eu-central-1',
    allowedOrigins: ['https://stage.example.peertube-serverless.com'],
    instanceBaseUrl: 'https://stage.example.peertube-serverless.com',
  },
  prod: {
    stage: 'prod',
    region: 'eu-central-1',
    allowedOrigins: ['https://example.peertube-serverless.com'],
    instanceBaseUrl: 'https://example.peertube-serverless.com',
  },
};

export function resolveStageConfig(stageArg?: string, regionOverride?: string): StageConfig {
  const stage = (stageArg ?? 'dev') as StageConfig['stage'];
  const base = defaults[stage] ?? defaults.dev;

  return {
    ...base,
    region: regionOverride ?? base.region,
  };
}
