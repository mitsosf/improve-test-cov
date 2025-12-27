/**
 * Port for AI test generation providers
 * Infrastructure provides the adapter implementations (Claude, OpenAI, etc.)
 */

import { AiProvider as AiProviderType } from '../../domain/entities/Job';

export interface TestFileExample {
  path: string;
  content: string;
}

export interface TestGenerationContext {
  filePath: string;
  fileContent: string;
  uncoveredLines: number[];
  existingTestPath?: string;
  existingTestContent?: string;
  projectDir?: string;
  exampleTestFiles?: TestFileExample[];
}

export interface GeneratedTest {
  testContent: string;
  testFilePath: string;
}

export interface IAiProvider {
  readonly name: AiProviderType;

  /**
   * Generate or improve tests for a given file
   */
  generateTests(context: TestGenerationContext): Promise<GeneratedTest>;

  /**
   * Check if the provider is available (API key configured, CLI installed, etc.)
   */
  isAvailable(): Promise<boolean>;
}

export const AI_PROVIDER = Symbol('IAiProvider');
