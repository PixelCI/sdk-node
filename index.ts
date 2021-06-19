// eslint-disable-next-line max-classes-per-file
import * as t from 'io-ts';
import { WebDriver } from 'selenium-webdriver';

import Client from './client';
import { getEnvConfig } from './envConfig';
import { gql, validateArgs } from './utils';

export const TagsType = t.dictionary(t.string, t.string);
export type Tags = t.TypeOf<typeof TagsType>;

export const SessionManagerConfigType = t.interface({
  apiKey: t.string,
  projectHandle: t.string,
  tags: t.union([TagsType, t.undefined]),
  clientId: t.union([t.string, t.undefined]),
  gitInfo: t.union([
    t.interface({
      commitSha: t.string,
      branch: t.string,
      pullRequestNumber: t.union([t.string, t.undefined]),
    }),
    t.undefined,
  ]),
});

export type SessionManagerConfig = t.TypeOf<typeof SessionManagerConfigType>;

export class SessionManager {
  protected client: Client;

  protected testSessionId: string | undefined;

  protected capturePromises: Array<Promise<any>> = [];

  config: SessionManagerConfig;

  constructor(config: Partial<SessionManagerConfig>) {
    this.config = this.loadOptions(config);
    this.client = new Client(this.config.apiKey);
  }

  loadOptions(opts: Partial<SessionManagerConfig>) {
    const envConfig = getEnvConfig();

    const computedOptions: Partial<SessionManagerConfig> = {
      apiKey: opts.apiKey || envConfig.apiKey,
      clientId: opts.clientId || envConfig.clientSessionId,
      projectHandle: opts.projectHandle || envConfig.projectHandle,
      gitInfo:
        opts.gitInfo ||
        (envConfig.commitSha && envConfig.branch
          ? {
              branch: envConfig.branch,
              commitSha: envConfig.commitSha,
              pullRequestNumber: envConfig.pullRequestNumber,
            }
          : undefined),
      tags: opts.tags,
    };

    validateArgs({
      config: [SessionManagerConfigType, computedOptions],
    });

    return (computedOptions as unknown) as SessionManagerConfig;
  }

  async open() {
    const [tenantSlug, projectSlug] = this.config.projectHandle.split('/');
    const { project } = await this.client.request(
      gql`
        query($tenantSlug: String!, $projectSlug: String!) {
          project: projectBySlug(
            tenantSlug: $tenantSlug
            projectSlug: $projectSlug
          ) {
            id
          }
        }
      `,
      { tenantSlug, projectSlug },
    );

    if (!project) {
      throw new Error(`couldn't find project "${this.config.projectHandle}"`);
    }

    const { openSession } = await this.client.request(
      gql`
        mutation($input: OpenSessionInput!) {
          openSession(input: $input) {
            testSession {
              id
            }
          }
        }
      `,
      {
        input: {
          projectId: project.id,
          tags: this.config.tags || {},
          clientId: this.config.clientId,
          gitInfo: this.config.gitInfo,
        },
      },
    );

    this.testSessionId = openSession.testSession.id;
  }

  async close() {
    await Promise.all(this.capturePromises);
    this.capturePromises = [];
  }

  createCheck(imageData: Buffer, name: string) {
    validateArgs({
      imageData: [t.object, imageData],
      name: [t.string, name],
    });

    if (!this.testSessionId) throw new Error('`.open` must be called first');

    this.capturePromises.push(
      this.client.request(
        gql`
          mutation($input: CreateImageCheckInput!) {
            createImageCheck(input: $input) {
              imageCheck {
                name
              }
            }
          }
        `,
        {
          input: {
            testSessionId: this.testSessionId,
            data: imageData.toString('base64'),
            name,
          },
        },
      ),
    );
  }
}

export class SeleniumSessionManager extends SessionManager {
  private browser: WebDriver;

  constructor({
    browser,
    ...config
  }: SessionManagerConfig & { browser: any }) {
    super(config);
    validateArgs({
      browser: [t.object, browser],
    });
    this.browser = browser;
  }

  async getSeleniumTags(): Promise<Tags> {
    const capabilities = await this.browser.getCapabilities();
    return {
      browser: capabilities.get('browserName'),
      platform: capabilities.get('platform'),
    };
  }

  async open() {
    this.config.tags = {
      ...(await this.getSeleniumTags()),
      ...this.config.tags,
    };
    await super.open();
  }

  async capture(name: string) {
    validateArgs({
      name: [t.string, name],
    });

    const imageData = await this.browser.takeScreenshot();
    this.createCheck(Buffer.from(imageData, 'base64'), name);
  }
}
