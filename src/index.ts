import * as t from 'io-ts'
// tslint:disable-next-line:no-implicit-dependencies
import { WebDriver } from 'selenium-webdriver'
import Client from './client'
import { gql, validateArgs } from './utils'

export const TagsType = t.dictionary(t.string, t.string)
export type Tags = t.TypeOf<typeof TagsType>

export const SessionManagerConfigType = t.interface({
  apiKey: t.string,
  projectSlug: t.string,
  tags: t.union([TagsType, t.undefined]),
})
export type SessionManagerConfig = t.TypeOf<typeof SessionManagerConfigType>

export class SessionManager {
  protected client: Client
  protected testSessionId: string
  protected capturePromises: Array<Promise<any>> = []

  constructor(protected config: SessionManagerConfig) {
    validateArgs({
      config: [SessionManagerConfigType, config],
    })

    this.client = new Client(config.apiKey)
  }

  async open() {
    const [tenantSlug, projectSlug] = this.config.projectSlug.split('/')
    const { project } = await this.client.request(
      gql`
        query($tenantSlug: String!, $projectSlug: String!) {
          project: projectBySlug(tenantSlug: $tenantSlug, projectSlug: $projectSlug) {
            id
          }
        }
      `,
      { tenantSlug, projectSlug },
    )

    if (!project) {
      throw new Error(`couldn't find project "${this.config.projectSlug}"`)
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
        },
      },
    )

    this.testSessionId = openSession.testSession.id
  }

  async close() {
    if (!this.testSessionId) return

    try {
      await Promise.all(this.capturePromises)
    } finally {
      await this.client.request(
        gql`
          mutation($input: CloseSessionInput!) {
            closeSession(input: $input) {
              __typename
            }
          }
        `,
        {
          input: {
            id: this.testSessionId,
          },
        },
      )
    }
  }

  createCheck(imageData: Buffer, name: string) {
    validateArgs({
      imageData: [t.object, imageData],
      name: [t.string, name],
    })

    t.string.decode(name)
    if (!this.testSessionId) throw new Error('`.open` must be called first')

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
    )
  }
}

export class SeleniumSessionManager extends SessionManager {
  private browser: WebDriver

  constructor({ browser, ...config }: SessionManagerConfig & { browser: any }) {
    super(config)
    validateArgs({
      browser: [t.object, browser],
    })
    this.browser = browser
  }

  async getSeleniumTags(): Promise<Tags> {
    const capabilities = await this.browser.getCapabilities()
    return {
      browser: capabilities.get('browserName'),
      platform: capabilities.get('platform'),
    }
  }

  async open() {
    this.config.tags = {
      ...(await this.getSeleniumTags()),
      ...this.config.tags,
    }
    await super.open()
  }

  async capture(name: string) {
    validateArgs({
      name: [t.string, name],
    })

    const imageData = await this.browser.takeScreenshot()
    this.createCheck(new Buffer(imageData, 'base64'), name)
  }
}
