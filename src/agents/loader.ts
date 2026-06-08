/**
 * Agent Loader — loads persona YAML configs and initializes Agent instances.
 *
 * Reads YAML files from the agents/ directory, parses persona configuration,
 * and creates Agent instances with the appropriate tools, triggers, and memory policy.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { Agent, ToolDefinition } from '../interfaces/agent';
import type { Trigger, TriggerType } from '../interfaces/trigger';
import type { Audit } from '../interfaces/audit';
import { PiAgentAdapter } from '../adapters/agent/pi-agent-adapter';
import { AuditEventBridge } from '../adapters/audit/audit-event-bridge';

/** Parsed persona configuration from YAML. */
export interface PersonaConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  triggers: PersonaTriggerConfig[];
  memoryPolicy: MemoryPolicy;
}

export interface PersonaTriggerConfig {
  type: TriggerType;
  config: Record<string, unknown>;
}

export interface MemoryPolicy {
  writeOn: string[];
  recallScope: 'agent' | 'global';
  topK: number;
}

/**
 * AgentLoader — loads persona YAML configs and creates Agent instances.
 */
export class AgentLoader {
  private agents: Map<string, Agent> = new Map();
  private configs: Map<string, PersonaConfig> = new Map();

  constructor(
    private agentsDir: string,
    private audit: Audit,
  ) {}

  /**
   * Load all persona YAML configs from the agents directory.
   */
  async loadAll(): Promise<Map<string, PersonaConfig>> {
    const files = fs.readdirSync(this.agentsDir)
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    for (const file of files) {
      const config = this.loadFile(path.join(this.agentsDir, file));
      this.configs.set(config.id, config);
    }

    return this.configs;
  }

  /**
   * Load a single persona YAML config by file path.
   */
  loadFile(filePath: string): PersonaConfig {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown>;

    const config: PersonaConfig = {
      id: parsed.id as string,
      name: parsed.name as string,
      description: parsed.description as string,
      systemPrompt: parsed.systemPrompt as string,
      tools: (parsed.tools ?? []) as ToolDefinition[],
      triggers: (parsed.triggers ?? []) as PersonaTriggerConfig[],
      memoryPolicy: parsed.memoryPolicy as MemoryPolicy,
    };

    // Resolve environment variables in trigger secrets
    this.resolveEnvVars(config);

    return config;
  }

  /**
   * Initialize an Agent instance from a persona config.
   */
  async initAgent(config: PersonaConfig): Promise<Agent> {
    const agent = new PiAgentAdapter({
      id: config.id,
      name: config.name,
      description: config.description,
      systemPrompt: config.systemPrompt,
      tools: config.tools,
    });

    this.agents.set(config.id, agent);

    // Log persona initialization
    await this.audit.log({
      id: crypto.randomUUID(),
      type: 'aos.persona.initialized',
      actor: config.id,
      payload: {
        name: config.name,
        tools: config.tools.map((t) => t.name),
        triggers: config.triggers.map((t) => t.type),
      },
    });

    return agent;
  }

  /**
   * Get a loaded Agent by ID.
   */
  getAgent(id: string): Agent | undefined {
    return this.agents.get(id);
  }

  /**
   * Get a persona config by ID.
   */
  getConfig(id: string): PersonaConfig | undefined {
    return this.configs.get(id);
  }

  /**
   * List all loaded persona IDs.
   */
  listPersonas(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Resolve ${ENV_VAR} placeholders in config values.
   */
  private resolveEnvVars(config: PersonaConfig): void {
    for (const trigger of config.triggers) {
      this.resolveInObject(trigger.config);
    }
  }

  private resolveInObject(obj: Record<string, unknown>): void {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (typeof val === 'string') {
        obj[key] = val.replace(/\$\{(\w+)\}/g, (_, envVar) => {
          return process.env[envVar] ?? `_${envVar}_not_set_`;
        });
      } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        this.resolveInObject(val as Record<string, unknown>);
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'object' && item !== null) {
            this.resolveInObject(item as Record<string, unknown>);
          }
        }
      }
    }
  }
}
