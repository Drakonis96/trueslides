import { PromptFieldKey } from "@/lib/types";
import {
  AIProvider,
  ImageLayout,
  ImageSearchSpeedOptions,
  ImageSourceId,
  ImageVerificationConfig,
  LayoutMode,
  OutputLanguage,
  SlideLayoutId,
} from "@/lib/types";

export interface GenerateFullRequest {
  jobId: string;
  provider: AIProvider;
  modelId: string;
  slideCount: number;
  textDensity: number;
  outputLanguage?: OutputLanguage;
  prompts: Record<PromptFieldKey, string>;
  sourceText: string;
  imageLayout: ImageLayout;
  layoutMode?: LayoutMode;
  slideLayout: SlideLayoutId;
  enabledSources?: ImageSourceId[];
  slideAccentColor?: string;
  speedOptions?: ImageSearchSpeedOptions;
  imageVerification?: ImageVerificationConfig;
}

export interface ResolvedAiConfig {
  provider: AIProvider;
  modelId: string;
  apiKey: string;
}

export interface ResolvedVerificationConfig {
  descriptorProvider: AIProvider;
  descriptorModelId: string;
  descriptorApiKey: string;
  orchestratorProvider: AIProvider;
  orchestratorModelId: string;
  orchestratorApiKey: string;
}