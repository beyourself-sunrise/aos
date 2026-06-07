/**
 * Report Trigger — implements AOS Trigger interface using cron + PG aggregate queries.
 *
 * Runs scheduled aggregate queries against PostgreSQL and detects anomalies
 * based on configurable thresholds. When an anomaly is detected, it triggers
 * the TriggerHandler.
 *
 * Reuses the CronTrigger framework (croner) for scheduling.
 */

import { Cron } from 'croner';
import { Client as PgClient } from 'pg';
import type { Trigger, TriggerHandler, TriggerEvent, ReportTriggerConfig } from '../../../interfaces/trigger';

export interface ReportTriggerOptions {
  /** Cron schedule expression */
  schedule: string;
  /** Timezone for cron (default: Asia/Taipei) */
  timezone?: string;
  /** PostgreSQL client for running queries */
  pgClient: PgClient;
  /** Report queries to run */
  queries: ReportQuery[];
  /** Default anomaly threshold multiplier (default: 2.0 = 2x baseline) */
  anomalyThreshold?: number;
}

export interface ReportQuery {
  /** Unique name for this report */
  name: string;
  /** SQL query returning a single numeric value */
  query: string;
  /** Baseline value to compare against */
  baseline: number;
  /** Anomaly threshold multiplier (value > baseline * threshold = anomaly) */
  threshold?: number;
  /** Description of what this report monitors */
  description?: string;
}

export class ReportTrigger implements Trigger {
  readonly type = 'report' as const;

  private cronJobs: Cron[] = [];
  private handler: TriggerHandler | null = null;
  private pgClient: PgClient;
  private queries: ReportQuery[];
  private defaultThreshold: number;
  private running = false;

  constructor(private config: ReportTriggerOptions) {
    this.pgClient = config.pgClient;
    this.queries = config.queries;
    this.defaultThreshold = config.anomalyThreshold ?? 2.0;
  }

  async start(handler: TriggerHandler): Promise<void> {
    if (this.running) {
      return;
    }
    this.handler = handler;
    this.running = true;

    // Create a cron job for each report query
    for (const query of this.queries) {
      const cron = new Cron(this.config.schedule, {
        timezone: this.config.timezone ?? 'Asia/Taipei',
      }, async () => {
        if (this.handler && this.running) {
          await this.runReport(query);
        }
      });
      this.cronJobs.push(cron);
    }

    console.log(`[ReportTrigger] Started with ${this.queries.length} queries on schedule ${this.config.schedule}`);
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const cron of this.cronJobs) {
      cron.stop();
    }
    this.cronJobs = [];
    console.log('[ReportTrigger] Stopped');
  }

  private async runReport(query: ReportQuery): Promise<void> {
    if (!this.handler) {
      return;
    }

    try {
      const result = await this.pgClient.query(query.query);
      const currentValue = result.rows.length > 0
        ? parseFloat(result.rows[0][Object.keys(result.rows[0])[0]] as string)
        : 0;

      const threshold = query.threshold ?? this.defaultThreshold;
      const anomalyThreshold = query.baseline * threshold;
      const isAnomaly = currentValue > anomalyThreshold;

      const event: TriggerEvent = {
        type: 'report',
        payload: {
          queryName: query.name,
          description: query.description,
          currentValue,
          baseline: query.baseline,
          threshold,
          anomalyThreshold,
          isAnomaly,
        },
        timestamp: new Date(),
        source: `report:${query.name}`,
      };

      if (isAnomaly) {
        console.log(`[ReportTrigger] Anomaly detected: ${query.name} (${currentValue} > ${anomalyThreshold})`);
        await this.handler.onTrigger(event);
      } else {
        console.log(`[ReportTrigger] Normal: ${query.name} (${currentValue} <= ${anomalyThreshold})`);
      }
    } catch (err) {
      console.error(`[ReportTrigger] Query error for ${query.name}:`, err);
    }
  }

  /**
   * Run all reports immediately (for testing)
   */
  async runAllNow(): Promise<void> {
    if (!this.handler) {
      throw new Error('ReportTrigger not started');
    }
    for (const query of this.queries) {
      await this.runReport(query);
    }
  }
}
